const FIRECRAWL = "https://api.firecrawl.dev/v2";
const GROQ = "https://api.groq.com/openai/v1/chat/completions";
export const GROQ_MODEL = "openai/gpt-oss-120b";

/** Verify a Firebase ID token via Identity Toolkit; returns the UID or throws. */
export async function verifyFirebaseUser(idToken: string): Promise<string> {
  return (await verifyFirebaseIdentity(idToken)).uid;
}

/** Verified identity (UID, email, display name) from a Firebase ID token. */
export async function verifyFirebaseIdentity(
  idToken: string,
): Promise<{ uid: string; email: string; name: string; emailVerified: boolean }> {
  const key = (import.meta.env ?? {})["VITE_FIREBASE_API_KEY"] as string | undefined;
  if (!key) throw new Error("Firebase is not configured on the server.");
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    },
  );
  if (!res.ok) throw new Error("Your session has expired. Please sign in again.");
  const body = (await res.json()) as {
    users?: {
      localId?: string;
      email?: string;
      displayName?: string;
      emailVerified?: boolean;
      disabled?: boolean;
    }[];
  };
  const u = body.users?.[0];
  if (!u?.localId) throw new Error("Your session could not be verified.");
  if (u.disabled) throw new Error("This account has been disabled.");
  return {
    uid: u.localId,
    email: u.email ?? "",
    name: (u.displayName || u.email || "Customer").slice(0, 120),
    emailVerified: u.emailVerified === true,
  };
}

export async function firecrawlScrape(url: string) {
  const key = process.env["FIRECRAWL_API_KEY"];
  if (!key) throw new Error("Website analysis is not configured.");

  const res = await fetch(`${FIRECRAWL}/scrape`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
    }),
  });

  if (!res.ok) {
    console.error(`Firecrawl failed [${res.status}]: ${(await res.text()).slice(0, 500)}`);
    throw new Error(`Website analysis failed (${res.status}).`);
  }

  const json = (await res.json()) as {
    data?: {
      markdown?: string;
      metadata?: { title?: string; description?: string };
    };
    markdown?: string;
  };

  const markdown = json.data?.markdown ?? json.markdown ?? "";

  return {
    markdown,
    title: json.data?.metadata?.title ?? "",
    description: json.data?.metadata?.description ?? "",
  };
}
export async function groqJson(system: string, user: string): Promise<string> {
  const key = process.env["GROQ_API_KEY"];
  if (!key) throw new Error("The AI engine is not configured.");
  const res = await fetch(GROQ, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    console.error(`Groq failed [${res.status}]: ${await res.text()}`);
    throw new Error(`AI engine request failed (${res.status}).`);
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content ?? "";
}
