/**
 * Trusted Firestore access for server functions (Cloudflare Worker runtime).
 * Uses a Firebase service account (FIREBASE_SERVICE_ACCOUNT_JSON, server-only
 * secret) to mint a Google OAuth token with WebCrypto, then calls the
 * Firestore REST API. Writes bypass Security Rules, so every caller must first
 * verify the Firebase user and derive merchant access from merchantUsers/{uid}.
 */
interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Value = Record<string, unknown>;

let cached: { token: string; exp: number } | null = null;

function account(): ServiceAccount {
  const raw = process.env["FIREBASE_SERVICE_ACCOUNT_JSON"];
  if (!raw) throw new Error("Workspace storage is not configured on the server.");
  const sa = JSON.parse(raw) as ServiceAccount;
  if (!sa.private_key || !sa.client_email || !sa.project_id)
    throw new Error("Workspace storage credentials are incomplete.");
  return sa;
}

const b64url = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes =
    typeof b === "string"
      ? new TextEncoder().encode(b)
      : b instanceof Uint8Array
        ? b
        : new Uint8Array(b);
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function accessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 60 > now) return cached.token;
  const sa = account();
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/cloud-platform", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }))}`;
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${unsigned}.${b64url(sig)}`,
  });
  if (!res.ok) {
    console.error(`Google token failed [${res.status}]: ${await res.text()}`);
    throw new Error("Workspace storage authentication failed.");
  }
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, exp: now + j.expires_in };
  return j.access_token;
}

// --- value encoding ---
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
export function encode(v: unknown): Value {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number")
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return ISO.test(v) ? { timestampValue: v } : { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  return { mapValue: { fields: encodeFields(v as Record<string, unknown>) } };
}
export const encodeFields = (o: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(o)
      .filter(([, x]) => x !== undefined)
      .map(([k, x]) => [k, encode(x)]),
  );
export function decode(v: Value): Json {
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v["booleanValue"] as boolean;
  if ("integerValue" in v) return Number(v["integerValue"]);
  if ("doubleValue" in v) return v["doubleValue"] as number;
  if ("timestampValue" in v) return v["timestampValue"] as string;
  if ("stringValue" in v) return v["stringValue"] as string;
  if ("arrayValue" in v)
    return ((v["arrayValue"] as { values?: Value[] }).values ?? []).map(decode);
  if ("mapValue" in v)
    return decodeFields((v["mapValue"] as { fields?: Record<string, Value> }).fields ?? {});
  return null;
}
export const decodeFields = (f: Record<string, Value>) =>
  Object.fromEntries(Object.entries(f).map(([k, x]) => [k, decode(x)])) as Record<string, Json>;

// --- REST ---
const root = () => `projects/${account().project_id}/databases/(default)/documents`;
const api = () => `https://firestore.googleapis.com/v1/${root()}`;

function safePath(path: string) {
  const parts = path.split("/");
  if (
    parts.length % 2 !== 0 ||
    parts.some((p) => !p || p.length > 200 || p === "." || p === ".." || /[^\w\-.:@]/.test(p))
  )
    throw new Error("Invalid document path.");
  return path;
}

export async function getDoc(path: string): Promise<Record<string, Json> | null> {
  const res = await fetch(`${api()}/${safePath(path)}`, {
    headers: { Authorization: `Bearer ${await accessToken()}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    console.error(`Firestore get failed [${res.status}]: ${await res.text()}`);
    throw new Error("Workspace storage read failed.");
  }
  const d = (await res.json()) as { fields?: Record<string, Value> };
  return decodeFields(d.fields ?? {});
}

export type Write =
  | { op: "create"; path: string; data: Record<string, unknown> } // fails if the document exists
  | { op: "set"; path: string; data: Record<string, unknown> }
  | {
      op: "merge";
      path: string;
      data: Record<string, unknown>;
      append?: Record<string, unknown[]> | undefined;
    };

/** Atomic multi-document commit. Returns false when a `create` hit an existing document. */
export async function commit(writes: Write[]): Promise<boolean> {
  const body = {
    writes: writes.map((w) => {
      const name = `${root()}/${safePath(w.path)}`;
      const base: Record<string, unknown> = { update: { name, fields: encodeFields(w.data) } };
      if (w.op === "create") base["currentDocument"] = { exists: false };
      if (w.op === "merge") {
        base["updateMask"] = { fieldPaths: Object.keys(w.data).map((k) => `\`${k}\``) };
        if (w.append)
          base["updateTransforms"] = Object.entries(w.append).map(([fieldPath, vals]) => ({
            fieldPath,
            appendMissingElements: { values: vals.map(encode) },
          }));
      }
      return base;
    }),
  };
  const res = await fetch(`${api()}:commit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return true;
  const text = await res.text();
  if (res.status === 409 || /ALREADY_EXISTS|FAILED_PRECONDITION/.test(text)) return false;
  console.error(`Firestore commit failed [${res.status}]: ${text}`);
  throw new Error("Workspace storage write failed.");
}

/** Atomically increment counters; returns each document's new value. */
export async function increment(
  paths: string[],
  field = "count",
  extra: Record<string, unknown> = {},
): Promise<number[]> {
  const body = {
    writes: paths.map((p) => ({
      update: { name: `${root()}/${safePath(p)}`, fields: encodeFields(extra) },
      updateMask: { fieldPaths: Object.keys(extra).map((k) => `\`${k}\``) },
      updateTransforms: [{ fieldPath: field, increment: { integerValue: "1" } }],
    })),
  };
  const res = await fetch(`${api()}:commit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`Firestore increment failed [${res.status}]: ${await res.text()}`);
    throw new Error("Usage limit check failed.");
  }
  const j = (await res.json()) as { writeResults?: { transformResults?: Value[] }[] };
  return (j.writeResults ?? []).map((w) =>
    Number(decode(w.transformResults?.[0] ?? { integerValue: "0" })),
  );
}
