import { describe, it, expect } from "vitest";
import { readFirebaseConfig, validateFirebaseConfig } from "@/lib/firebase/config";
import { merchantCollection } from "@/lib/firebase/data";

describe("Firebase configuration", () => {
  it("uses the supplied Firebase web app identifiers", () => {
    expect(readFirebaseConfig()).toMatchObject({
      authDomain: "fir-4700f.firebaseapp.com",
      projectId: "fir-4700f",
      storageBucket: "fir-4700f.firebasestorage.app",
      messagingSenderId: "285826170923",
      appId: "1:285826170923:web:50b5db9f7ce12a2dc52a6e",
    });
  });
  it("does not initialize with only the project ID", () => {
    expect(validateFirebaseConfig({ projectId: "fir-4700f" })).toBe(
      "Missing Firebase web settings: apiKey, authDomain, appId.",
    );
  });
  it("requires the user's fir-4700f project", () => {
    expect(
      validateFirebaseConfig({
        apiKey: "public-test-key",
        authDomain: "example.test",
        appId: "test-app",
        projectId: "another-project",
      }),
    ).toBe("Firebase project must be fir-4700f.");
  });
  it("accepts complete web configuration for the requested project", () => {
    expect(
      validateFirebaseConfig({
        apiKey: "public-test-key",
        authDomain: "example.test",
        appId: "test-app",
        projectId: "fir-4700f",
      }),
    ).toBeNull();
  });
  it("rejects paths in merchant IDs before constructing collections", () => {
    expect(() =>
      merchantCollection(
        {} as Parameters<typeof merchantCollection>[0],
        "merchant/another",
        "customers",
      ),
    ).toThrow("Invalid merchant ID.");
  });
});
