// @vitest-environment node
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  writeBatch,
  serverTimestamp,
  collection,
  getDocs,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import { ensureMerchantProfile } from "@/lib/firebase/merchants";

describe.skipIf(!process.env["FIRESTORE_EMULATOR_HOST"])(
  "Merchant isolation security rules",
  () => {
    let env: RulesTestEnvironment;
    beforeAll(async () => {
      env = await initializeTestEnvironment({
        projectId: "demo-retain-ai",
        firestore: {
          host: "127.0.0.1",
          port: 8085,
          rules: readFileSync("firestore.rules", "utf8"),
        },
      });
    });
    afterAll(async () => {
      await env?.cleanup();
    });
    beforeEach(async () => {
      await env.clearFirestore();
    });

    function userDb(uid: string) {
      return env.authenticatedContext(uid, { email: `${uid}@example.test` }).firestore();
    }
    // Workspaces are created only by the trusted server, so seed them with rules disabled (emulator only).
    async function provision(uid: string) {
      await env.withSecurityRulesDisabled(async (c) => {
        const db = c.firestore();
        await setDoc(doc(db, "merchants", uid), {
          ownerUid: uid,
          name: "Test workspace",
          createdAt: new Date(),
        });
        await setDoc(doc(db, "merchantUsers", uid), {
          uid,
          merchantId: uid,
          role: "owner",
          displayName: "Merchant",
          email: `${uid}@example.test`,
          photoURL: "",
          createdAt: new Date(),
        });
      });
    }
    async function addMember(uid: string, merchantId: string, role = "approver") {
      await env.withSecurityRulesDisabled(async (c) => {
        await setDoc(doc(c.firestore(), "merchantUsers", uid), {
          uid,
          merchantId,
          role,
          displayName: "Member",
          email: `${uid}@example.test`,
          photoURL: "",
          createdAt: new Date(),
        });
      });
    }
    it("denies browser-side merchant workspace creation", async () => {
      await assertFails(
        setDoc(doc(userDb("alice"), "merchants", "alice"), {
          ownerUid: "alice",
          name: "Workspace",
          createdAt: serverTimestamp(),
        }),
      );
      const db = userDb("alice");
      const batch = writeBatch(db);
      batch.set(doc(db, "merchants", "alice"), {
        ownerUid: "alice",
        name: "Workspace",
        createdAt: serverTimestamp(),
      });
      batch.set(doc(db, "merchantUsers", "alice"), {
        uid: "alice",
        merchantId: "alice",
        role: "owner",
        displayName: "Alice",
        email: "alice@example.test",
        photoURL: "",
        createdAt: serverTimestamp(),
      });
      await assertFails(batch.commit());
    });
    it("denies browser-side merchant membership creation", async () => {
      await provision("alice");
      await assertFails(
        setDoc(doc(userDb("mallory"), "merchantUsers", "mallory"), {
          uid: "mallory",
          merchantId: "alice",
          role: "approver",
          displayName: "M",
          email: "mallory@example.test",
          photoURL: "",
          createdAt: serverTimestamp(),
        }),
      );
      await assertFails(
        setDoc(doc(userDb("mallory"), "merchantUsers", "mallory"), {
          uid: "mallory",
          merchantId: "mallory",
          role: "owner",
          displayName: "M",
          email: "mallory@example.test",
          photoURL: "",
          createdAt: serverTimestamp(),
        }),
      );
    });
    it("denies the legacy browser first-sign-in transaction", async () => {
      const user = {
        uid: "carol",
        email: "carol@example.test",
        displayName: "Carol",
        photoURL: null,
      } as unknown as User;
      await assertFails(ensureMerchantProfile(userDb("carol") as unknown as Firestore, user));
    });
    it("lets an existing owner read their own workspace and profile", async () => {
      await provision("alice");
      const result = await assertSucceeds(getDoc(doc(userDb("alice"), "merchants", "alice")));
      expect(result.data()?.["ownerUid"]).toBe("alice");
      await assertSucceeds(getDoc(doc(userDb("alice"), "merchantUsers", "alice")));
    });
    it("lets an existing member read their permitted workspace data only", async () => {
      await provision("alice");
      await addMember("bob", "alice");
      await env.withSecurityRulesDisabled(async (c) => {
        await setDoc(doc(c.firestore(), "merchants", "alice", "approvals", "ap1"), {
          status: "pending",
        });
      });
      await assertSucceeds(getDoc(doc(userDb("bob"), "merchants", "alice")));
      await assertSucceeds(getDoc(doc(userDb("bob"), "merchantUsers", "bob")));
      await assertSucceeds(getDoc(doc(userDb("bob"), "merchants", "alice", "approvals", "ap1")));
      await assertFails(getDoc(doc(userDb("bob"), "merchantUsers", "alice")));
      await assertFails(
        updateDoc(doc(userDb("bob"), "merchants", "alice"), { name: "Member rename" }),
      );
      await assertFails(
        setDoc(doc(userDb("bob"), "merchants", "alice", "approvals", "ap1"), {
          status: "approved",
        }),
      );
    });
    it("denies another merchant reading or changing a workspace", async () => {
      await provision("alice");
      await provision("bob");
      await assertFails(getDoc(doc(userDb("bob"), "merchants", "alice")));
      await assertFails(updateDoc(doc(userDb("bob"), "merchants", "alice"), { name: "Stolen" }));
      await assertFails(getDoc(doc(userDb("bob"), "merchantUsers", "alice")));
    });
    it("denies unauthenticated merchant and profile access", async () => {
      await provision("alice");
      const db = env.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, "merchants", "alice")));
      await assertFails(getDoc(doc(db, "merchantUsers", "alice")));
    });
    it("prevents membership reassignment and role escalation", async () => {
      await provision("alice");
      await assertFails(
        updateDoc(doc(userDb("alice"), "merchantUsers", "alice"), { merchantId: "bob" }),
      );
      await assertFails(
        updateDoc(doc(userDb("alice"), "merchantUsers", "alice"), { role: "admin" }),
      );
    });
    it("denies cross-workspace access for owners and members", async () => {
      await provision("alice");
      await provision("bob");
      await addMember("dave", "bob");
      await env.withSecurityRulesDisabled(async (c) => {
        await setDoc(doc(c.firestore(), "merchants", "alice", "customers", "c1"), { name: "X" });
      });
      await assertFails(getDoc(doc(userDb("dave"), "merchants", "alice")));
      await assertFails(getDoc(doc(userDb("dave"), "merchants", "alice", "customers", "c1")));
      await assertFails(getDocs(collection(userDb("dave"), "merchants", "alice", "customers")));
      await assertFails(getDoc(doc(userDb("bob"), "merchants", "alice", "customers", "c1")));
    });
    it.each(["customers", "subscriptions", "retentionSessions", "approvals"])(
      "isolates %s and denies sensitive client writes",
      async (name) => {
        await provision("alice");
        await provision("bob");
        await env.withSecurityRulesDisabled(async (context) => {
          await setDoc(doc(context.firestore(), "merchants", "alice", name, "record"), {
            amount: 100,
          });
        });
        await assertSucceeds(getDoc(doc(userDb("alice"), "merchants", "alice", name, "record")));
        await assertSucceeds(getDocs(collection(userDb("alice"), "merchants", "alice", name)));
        await assertFails(getDoc(doc(userDb("bob"), "merchants", "alice", name, "record")));
        await assertFails(
          setDoc(doc(userDb("alice"), "merchants", "alice", name, "new"), { amount: 999 }),
        );
      },
    );
    it("allows owner name edits but denies ownerUid changes", async () => {
      await provision("alice");
      await assertSucceeds(
        updateDoc(doc(userDb("alice"), "merchants", "alice"), { name: "New workspace" }),
      );
      await assertFails(updateDoc(doc(userDb("alice"), "merchants", "alice"), { ownerUid: "bob" }));
    });
    it("denies global merchant enumeration and unknown collections", async () => {
      await provision("alice");
      await assertFails(getDocs(collection(userDb("alice"), "merchants")));
      await assertFails(getDoc(doc(userDb("alice"), "secrets", "record")));
    });
  },
);
