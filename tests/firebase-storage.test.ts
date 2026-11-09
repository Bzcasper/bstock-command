import { describe, expect, it } from "vitest";
import { FirebaseStorageService, pushDbToFirebase, pullFirebaseToLocalDb } from "@bstock/storage-firebase";
import { startHarness } from "./helpers.ts";
import { Db } from "../apps/server/src/db.ts";

describe("firebase storage integration", () => {
  it("initializes storage service and reports status", () => {
    const service = new FirebaseStorageService({
      projectId: "test-bstock-project",
      storageBucket: "test-bstock-project.appspot.com",
      enabled: true,
    });

    const status = service.getStatus();
    expect(status.enabled).toBe(true);
    expect(status.projectId).toBe("test-bstock-project");
    expect(status.storageBucket).toBe("test-bstock-project.appspot.com");
  });

  it("handles disabled storage gracefully", () => {
    const service = new FirebaseStorageService({ enabled: false });
    expect(service.init()).toBe(false);
    expect(service.getStatus().enabled).toBe(false);
    expect(service.getStatus().initialized).toBe(false);
  });

  it("exposes /api/storage/status on server", async () => {
    const h = await startHarness();
    try {
      const res = await h.app.inject({ method: "GET", url: "/api/storage/status" });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { enabled: boolean; initialized: boolean };
      expect(body).toHaveProperty("enabled");
      expect(body).toHaveProperty("initialized");
    } finally {
      await h.close();
    }
  });

  it("includes storage status in /api/status response", async () => {
    const h = await startHarness();
    try {
      const res = await h.app.inject({ method: "GET", url: "/api/status" });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { storage?: { enabled: boolean } };
      expect(body.storage).toBeDefined();
      expect(body.storage).toHaveProperty("enabled");
    } finally {
      await h.close();
    }
  });

  it("reports sync status cleanly when service is not initialized", async () => {
    const db = new Db(":memory:");
    const service = new FirebaseStorageService({ enabled: false });
    const report = await pushDbToFirebase(db, service);
    expect(report.errors).toContain("Firebase is not initialized or disabled");
    expect(report.listingsSynced).toBe(0);
    db.close();
  });

  it("pulls remote changes cleanly with empty or uninitialized remote", async () => {
    const db = new Db(":memory:");
    const service = new FirebaseStorageService({ enabled: false });
    const result = await pullFirebaseToLocalDb(db, service);
    expect(result.errors).toContain("Firebase not initialized");
    db.close();
  });
});
