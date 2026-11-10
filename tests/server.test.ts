import { describe, expect, it } from "vitest";
import { startHarness } from "./helpers.ts";

describe("server end-to-end", () => {
  it("syncs, ranks and exposes listings", async () => {
    const h = await startHarness({ mode: "dry-run" });
    try {
      const report = await h.collector.sync({ pages: 2, pageSize: 20, withBidsFor: 6 });
      expect(report.listingsUpserted).toBeGreaterThan(30);
      expect(report.metricsComputed).toBe(report.listingsUpserted);

      const res = await h.app.inject({ method: "GET", url: "/api/listings?limit=5&sort=score" });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { listings: Array<{ listingId: string; score: number; maxHammer: number }> };
      expect(body.listings).toHaveLength(5);
      expect(body.listings[0].score).toBeGreaterThanOrEqual(body.listings[4].score);

      const detailRes = await h.app.inject({ method: "GET", url: `/api/listings/${body.listings[0].listingId}` });
      expect(detailRes.statusCode).toBe(200);
      const detail = detailRes.json() as { economics: { costToRetail: number } };
      expect(detail.economics.costToRetail).toBeGreaterThan(0);
    } finally {
      await h.close();
    }
  });

  it("plans and dry-runs a bid, then blocks a non-armed live attempt", async () => {
    const h = await startHarness({ mode: "live", liveEnabled: true });
    try {
      await h.collector.sync({ pages: 1, pageSize: 40, withBidsFor: 0 });
      await h.client.login({ loginId: "demo@example.com", password: "demo-password" });

      const top = await h.app.inject({ method: "GET", url: "/api/listings?limit=1&sort=score" });
      const listingId = (top.json() as { listings: Array<{ listingId: string }> }).listings[0].listingId;

      const planRes = await h.app.inject({ method: "POST", url: "/api/bid/plan", payload: { listingId } });
      expect(planRes.statusCode).toBe(200);
      const { planToken, payload } = planRes.json() as { planToken: string; payload: { maxAmount: number } };

      const dryRun = await h.app.inject({
        method: "POST",
        url: "/api/bid/execute",
        payload: { listingId, planToken, amount: payload.maxAmount, armed: true, dryRun: true, idempotencyKey: "dry-1" },
      });
      expect(dryRun.statusCode).toBe(200);
      expect(dryRun.json()).toMatchObject({ status: "dry-run" });

      const blocked = await h.app.inject({
        method: "POST",
        url: "/api/bid/execute",
        payload: { listingId, planToken, amount: payload.maxAmount, armed: false, dryRun: false, idempotencyKey: "blocked-1" },
      });
      expect(blocked.json()).toMatchObject({ status: "blocked" });
      const blockers = (blocked.json() as { guard: { blockers: string[] } }).guard.blockers;
      expect(blockers.join(" ")).toMatch(/armed/);
    } finally {
      await h.close();
    }
  });

  it("places a live bid and rejects a duplicate idempotency key", async () => {
    const h = await startHarness({ mode: "live", liveEnabled: true });
    try {
      await h.collector.sync({ pages: 1, pageSize: 40, withBidsFor: 0 });
      await h.client.login({ loginId: "demo@example.com", password: "demo-password" });

      const top = await h.app.inject({ method: "GET", url: "/api/listings?limit=1&sort=score" });
      const listingId = (top.json() as { listings: Array<{ listingId: string }> }).listings[0].listingId;

      const planRes = await h.app.inject({ method: "POST", url: "/api/bid/plan", payload: { listingId } });
      const { planToken, payload } = planRes.json() as { planToken: string; payload: { maxAmount: number } };

      const placed = await h.app.inject({
        method: "POST",
        url: "/api/bid/execute",
        payload: { listingId, planToken, amount: payload.maxAmount, armed: true, dryRun: false, idempotencyKey: "live-1" },
      });
      expect(placed.statusCode).toBe(200);
      expect(placed.json()).toMatchObject({ status: "placed" });

      // Re-issue a new plan for the same listing and try to replay the old idempotency key.
      const plan2 = await h.app.inject({ method: "POST", url: "/api/bid/plan", payload: { listingId } });
      const { planToken: planToken2, payload: payload2 } = plan2.json() as { planToken: string; payload: { maxAmount: number } };
      const dup = await h.app.inject({
        method: "POST",
        url: "/api/bid/execute",
        payload: { listingId, planToken: planToken2, amount: payload2.maxAmount, armed: true, dryRun: false, idempotencyKey: "live-1" },
      });
      expect(dup.json()).toMatchObject({ status: "duplicate" });

      const attempts = await h.app.inject({ method: "GET", url: "/api/bids" });
      expect((attempts.json() as { attempts: unknown[] }).attempts.length).toBeGreaterThanOrEqual(1);
    } finally {
      await h.close();
    }
  });

  it("exports CSV and recompute changes nothing when settings unchanged", async () => {
    const h = await startHarness({ mode: "dry-run" });
    try {
      await h.collector.sync({ pages: 1, pageSize: 20, withBidsFor: 0 });
      const csv = await h.app.inject({ method: "GET", url: "/api/export.csv" });
      expect(csv.statusCode).toBe(200);
      expect(csv.headers["content-type"]).toContain("text/csv");
      expect(csv.body.split("\n").length).toBeGreaterThan(20);
      const before = (await h.app.inject({ method: "GET", url: "/api/status" })).json() as { stats: { listings: number } };
      h.collector.recompute();
      const after = (await h.app.inject({ method: "GET", url: "/api/status" })).json() as { stats: { listings: number } };
      expect(after.stats.listings).toBe(before.stats.listings);
    } finally {
      await h.close();
    }
  });

  it("serves mobile-optimized endpoints, gzip compression, and 304 conditional validation", async () => {
    const h = await startHarness({ mode: "dry-run" });
    try {
      await h.collector.sync({ pages: 1, pageSize: 20, withBidsFor: 0 });

      // 1. Verify Gzip compression
      const compRes = await h.app.inject({
        method: "GET",
        url: "/api/listings?limit=10",
        headers: { "accept-encoding": "gzip" },
      });
      expect(compRes.statusCode).toBe(200);
      expect(compRes.headers["content-encoding"]).toBe("gzip");
      expect(compRes.headers["etag"]).toBeDefined();

      // 2. Verify 304 Not Modified with ETag
      const etag = compRes.headers["etag"] as string;
      const notModRes = await h.app.inject({
        method: "GET",
        url: "/api/listings?limit=10",
        headers: { "if-none-match": etag },
      });
      expect(notModRes.statusCode).toBe(304);
      expect(notModRes.body).toBe("");

      // 3. Verify mobile compact listings payload
      const compactRes = await h.app.inject({
        method: "GET",
        url: "/api/listings?limit=5&compact=1",
      });
      expect(compactRes.statusCode).toBe(200);
      const compactJson = compactRes.json() as { compact: boolean; listings: Array<{ listingId: string; opportunityTier: string }> };
      expect(compactJson.compact).toBe(true);
      expect(compactJson.listings.length).toBeGreaterThan(0);
      expect(compactJson.listings[0].opportunityTier).toBeDefined();

      // 4. Verify dedicated /api/mobile/feed endpoint
      const feedRes = await h.app.inject({
        method: "GET",
        url: "/api/mobile/feed",
      });
      expect(feedRes.statusCode).toBe(200);
      const feedJson = feedRes.json() as { stats: unknown; topGems: unknown[]; closingSoon: unknown[] };
      expect(feedJson.stats).toBeDefined();
      expect(Array.isArray(feedJson.topGems)).toBe(true);
      expect(Array.isArray(feedJson.closingSoon)).toBe(true);
    } finally {
      await h.close();
    }
  });
});
