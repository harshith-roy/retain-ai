// @vitest-environment node
// Checks firestore.rules.proposed (NOT published). Runs only with the emulator.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";

describe.skipIf(!process.env["FIRESTORE_EMULATOR_HOST"])(
  "Proposed rules: server-only onboarding",
  () => {
    let env: RulesTestEnvironment;
    beforeAll(async () => {
      env = await initializeTestEnvironment({
        projectId: "demo-retain-ai-proposed",
        firestore: {
          host: "127.0.0.1",
          port: 8085,
          rules: readFileSync("firestore.rules.proposed", "utf8"),
        },
      });
    });
    afterAll(async () => {
      await env?.cleanup();
    });
    beforeEach(async () => {
      await env.clearFirestore();
      await env.withSecurityRulesDisabled(async (c) => {
        const db = c.firestore();
        await setDoc(doc(db, "merchants", "alice"), {
          ownerUid: "alice",
          name: "A",
          createdAt: new Date(),
        });
        await setDoc(doc(db, "merchantUsers", "alice"), {
          uid: "alice",
          merchantId: "alice",
          role: "owner",
          displayName: "A",
          email: "a@x.io",
          photoURL: "",
          createdAt: new Date(),
        });
        await setDoc(doc(db, "merchantUsers", "bob"), {
          uid: "bob",
          merchantId: "alice",
          role: "approver",
          displayName: "B",
          email: "b@x.io",
          photoURL: "",
          createdAt: new Date(),
        });
        await setDoc(doc(db, "merchants", "alice", "approvals", "ap1"), { status: "pending" });
      });
    });
    const db = (uid: string) => env.authenticatedContext(uid, { email: `${uid}@x.io` }).firestore();

    it("denies a browser creating its own workspace (no open sign-up)", async () => {
      const d = db("mallory");
      const b = writeBatch(d);
      b.set(doc(d, "merchants", "mallory"), {
        ownerUid: "mallory",
        name: "M",
        createdAt: serverTimestamp(),
      });
      b.set(doc(d, "merchantUsers", "mallory"), {
        uid: "mallory",
        merchantId: "mallory",
        role: "owner",
        displayName: "M",
        email: "mallory@x.io",
        photoURL: "",
        createdAt: serverTimestamp(),
      });
      await assertFails(b.commit());
    });
    it("denies a browser joining someone else's workspace", async () => {
      await assertFails(
        setDoc(doc(db("mallory"), "merchantUsers", "mallory"), {
          uid: "mallory",
          merchantId: "alice",
          role: "approver",
          displayName: "M",
          email: "mallory@x.io",
          photoURL: "",
          createdAt: serverTimestamp(),
        }),
      );
    });
    it("lets existing owner and invited approver read their workspace", async () => {
      await assertSucceeds(getDoc(doc(db("alice"), "merchants", "alice")));
      await assertSucceeds(getDoc(doc(db("bob"), "merchants", "alice")));
      await assertSucceeds(getDoc(doc(db("bob"), "merchants", "alice", "approvals", "ap1")));
    });
    it("still blocks browser approval writes and invite/rate-limit records", async () => {
      await assertFails(
        setDoc(doc(db("bob"), "merchants", "alice", "approvals", "ap1"), { status: "approved" }),
      );
      await assertFails(getDoc(doc(db("alice"), "merchantInvites", "x")));
      await assertFails(getDoc(doc(db("alice"), "rateLimits", "x")));
      await assertFails(getDoc(doc(db("alice"), "merchants", "alice", "settings", "team")));
    });
  },
);
