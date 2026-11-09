import { describe, expect, it } from "vitest";
import { evaluateBid } from "../apps/server/src/bids.ts";
import { DEFAULT_SETTINGS } from "../apps/server/src/collector.ts";
import type { ListingRow } from "../apps/server/src/db.ts";

const baseListing: Pick<ListingRow, "listing_id" | "site_abb" | "category" | "ends_at" | "next_min_cents" | "current_cents" | "retail_cents" | "units" | "pallets" | "manifest"> = {
  listing_id: "l1",
  site_abb: "TMP",
  category: "Mixed Lots",
  ends_at: "2026-11-10T18:00:00.000Z",
  next_min_cents: 10000,
  current_cents: 10000,
  retail_cents: 500000,
  units: 200,
  pallets: 10,
  manifest: 1,
};

const now = new Date("2026-11-08T18:00:00.000Z");
const settings = { ...DEFAULT_SETTINGS, mode: "live" as const, minRoi: 0.15 };

describe("bid guard", () => {
  it("blocks when not armed", () => {
    const r = evaluateBid({
      settings,
      liveEnabled: true,
      hasToken: true,
      hasClearance: true,
      now,
      listing: baseListing,
      amount: 100,
      armed: false,
      dryRun: false,
      dailyExposure: 0,
      score: 80,
      plan: { listingId: "l1", auctionId: "a1", amount: 100, maxAmount: 100, expiresAt: now.getTime() + 60_000, nonce: "n" },
      idempotencyKey: "k",
      duplicateKey: false,
      nonceUsed: false,
    });
    expect(r.allowed).toBe(false);
    expect(r.blockers.join(" ")).toMatch(/armed/);
  });

  it("blocks amounts over the per-bid cap", () => {
    const r = evaluateBid({
      settings: { ...settings, perBidCap: 50 },
      liveEnabled: true,
      hasToken: true,
      hasClearance: true,
      now,
      listing: baseListing,
      amount: 100,
      armed: true,
      dryRun: false,
      dailyExposure: 0,
      score: 80,
      plan: { listingId: "l1", auctionId: "a1", amount: 100, maxAmount: 100, expiresAt: now.getTime() + 60_000, nonce: "n" },
      idempotencyKey: "k",
      duplicateKey: false,
      nonceUsed: false,
    });
    expect(r.blockers.join(" ")).toMatch(/per-bid-cap/);
  });

  it("blocks duplicate idempotency keys", () => {
    const r = evaluateBid({
      settings,
      liveEnabled: true,
      hasToken: true,
      hasClearance: true,
      now,
      listing: baseListing,
      amount: 100,
      armed: true,
      dryRun: false,
      dailyExposure: 0,
      score: 80,
      plan: { listingId: "l1", auctionId: "a1", amount: 100, maxAmount: 100, expiresAt: now.getTime() + 60_000, nonce: "n" },
      idempotencyKey: "k",
      duplicateKey: true,
      nonceUsed: false,
    });
    expect(r.blockers.join(" ")).toMatch(/idempotency/);
  });

  it("passes a fully valid live bid", () => {
    const r = evaluateBid({
      settings,
      liveEnabled: true,
      hasToken: true,
      hasClearance: true,
      now,
      listing: baseListing,
      amount: 100,
      armed: true,
      dryRun: false,
      dailyExposure: 0,
      score: 80,
      plan: { listingId: "l1", auctionId: "a1", amount: 100, maxAmount: 100, expiresAt: now.getTime() + 60_000, nonce: "n" },
      idempotencyKey: "k",
      duplicateKey: false,
      nonceUsed: false,
    });
    expect(r.allowed).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it("allows a dry-run request even in live mode", () => {
    const r = evaluateBid({
      settings,
      liveEnabled: true,
      hasToken: true,
      hasClearance: true,
      now,
      listing: baseListing,
      amount: 100,
      armed: false,
      dryRun: true,
      dailyExposure: 0,
      score: 80,
      plan: { listingId: "l1", auctionId: "a1", amount: 100, maxAmount: 100, expiresAt: now.getTime() + 60_000, nonce: "n" },
      idempotencyKey: "k",
      duplicateKey: false,
      nonceUsed: false,
    });
    expect(r.allowed).toBe(true);
  });
});
