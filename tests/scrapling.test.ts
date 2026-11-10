import { describe, expect, it } from "vitest";
import { startHarness } from "./helpers.ts";

describe("scrapling and funnel server endpoints", () => {
  it("exposes /api/scraper/status", async () => {
    const h = await startHarness();
    try {
      const res = await h.app.inject({ method: "GET", url: "/api/scraper/status" });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { ready: boolean; venvExists: boolean };
      expect(body).toHaveProperty("ready");
      expect(body).toHaveProperty("venvExists");
    } finally {
      await h.close();
    }
  });

  it("exposes /api/funnel/listings and returns funnel summary", async () => {
    const h = await startHarness();
    try {
      // Sync mock listings
      await h.app.inject({ method: "POST", url: "/api/sync" });

      const res = await h.app.inject({ method: "GET", url: "/api/funnel/listings" });
      expect(res.statusCode).toBe(200);
      const summary = res.json() as {
        totalIngested: number;
        stage1Viable: number;
        stage2PatternApproved: number;
        stage3AlphaRanked: number;
        tierCounts: Record<string, number>;
        topOpportunities: Array<{
          listingId: string;
          tier: string;
          score: number;
          algebraic: { maxHammer: number; expectedRoi: number };
          density: { retailPerPallet: number };
          pattern: { isSleeper: boolean };
        }>;
      };

      expect(summary.totalIngested).toBeGreaterThan(0);
      expect(summary.tierCounts).toBeDefined();
      expect(summary.topOpportunities.length).toBeGreaterThan(0);
      const top = summary.topOpportunities[0];
      expect(top).toHaveProperty("tier");
      expect(top).toHaveProperty("score");
      expect(top).toHaveProperty("algebraic");
      expect(top).toHaveProperty("density");
      expect(top).toHaveProperty("pattern");
    } finally {
      await h.close();
    }
  });

  it("includes scraper in /api/status", async () => {
    const h = await startHarness();
    try {
      const res = await h.app.inject({ method: "GET", url: "/api/status" });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { scraper?: { ready: boolean; venvExists: boolean } };
      expect(body.scraper).toBeDefined();
      expect(typeof body.scraper?.ready).toBe("boolean");
    } finally {
      await h.close();
    }
  });
});
