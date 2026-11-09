import { describe, expect, it } from "vitest";
import {
  bidVelocity,
  dealEconomics,
  DEFAULT_COST_MODEL,
  landedCost,
  maxHammerForRoi,
  projectFinalPrice,
  scoreAuction,
  snipeAt,
  type DealEconomics,
} from "@bstock/analytics";
import type { BidRecord } from "@bstock/client";

const cost = { ...DEFAULT_COST_MODEL };

describe("landed cost", () => {
  it("adds premium, tax on hammer+premium, freight and fees", () => {
    const c = landedCost(1000, { buyerPremiumPct: 0.125, taxPct: 0.08, shipping: 250, otherFees: 50 });
    expect(c.buyerPremium).toBe(125);
    expect(c.tax).toBe(90); // 8% of 1125
    expect(c.landed).toBe(1515);
  });

  it("never returns negative components", () => {
    const c = landedCost(-500, cost);
    expect(c.landed).toBe(cost.shipping + cost.otherFees);
  });
});

describe("deal economics", () => {
  it("computes ROI and per-pallet cost", () => {
    const e = dealEconomics({ hammer: 2000, retail: 10000, units: 200, pallets: 10, recoveryPct: 0.4, cost });
    expect(e.cost.landed).toBe(2250); // 2000 + 12.5%
    expect(e.resaleValue).toBe(4000);
    expect(e.profit).toBe(1750);
    expect(e.roi).toBeCloseTo(1750 / 2250, 6);
    expect(e.costPerPallet).toBe(225);
    expect(e.costPerUnit).toBe(11.25);
    expect(e.costToRetail).toBeCloseTo(0.225, 6);
  });
});

describe("max hammer inversion", () => {
  it("round-trips through the cost model at the target ROI", () => {
    const retail = 25_000;
    const recoveryPct = 0.45;
    const targetRoi = 0.3;
    const model = { buyerPremiumPct: 0.125, taxPct: 0.07, shipping: 400, otherFees: 100 };
    const hammer = maxHammerForRoi({ retail, recoveryPct, targetRoi, cost: model });
    // Buying at that hammer must land exactly on the target ROI.
    const e: DealEconomics = dealEconomics({ hammer, retail, units: 100, pallets: 5, recoveryPct, cost: model });
    expect(e.roi).toBeCloseTo(targetRoi, 3);
  });

  it("never suggests bidding above the floor when the deal cannot work", () => {
    const hammer = maxHammerForRoi({ retail: 100, recoveryPct: 0.05, targetRoi: 1, cost: { ...cost, shipping: 500 } }, 25);
    expect(hammer).toBe(25);
  });
});

describe("projection", () => {
  const now = new Date("2026-11-08T18:00:00.000Z");

  it("assumes a modest lift for a cold auction", () => {
    const p = projectFinalPrice({ currentBid: 1000, startPrice: 1000, bids: 0, endsAt: "2026-11-12T18:00:00.000Z", now });
    expect(p.method).toBe("cold");
    expect(p.projected).toBe(1250);
  });

  it("damps hot auctions and caps at 45% of retail", () => {
    const p = projectFinalPrice({
      currentBid: 5000,
      startPrice: 500,
      bids: 60,
      endsAt: "2026-11-09T00:00:00.000Z",
      now,
      retail: 8000,
    });
    expect(p.method).toBe("velocity");
    expect(p.projected).toBeGreaterThan(5000);
    expect(p.projected).toBeLessThanOrEqual(8000 * 0.65 + 0.01);
  });

  it("returns the observed bid rate when start time is known", () => {
    const short = projectFinalPrice({
      currentBid: 1000,
      startPrice: 100,
      bids: 12,
      endsAt: "2026-11-08T20:00:00.000Z",
      startedAt: "2026-11-08T06:00:00.000Z",
      now,
    });
    const long = projectFinalPrice({
      currentBid: 1000,
      startPrice: 100,
      bids: 12,
      endsAt: "2026-11-08T20:00:00.000Z",
      startedAt: "2026-10-20T06:00:00.000Z",
      now,
    });
    expect(short.projected).toBeGreaterThan(long.projected);
  });
});

describe("bid velocity", () => {
  const now = new Date("2026-11-08T18:00:00.000Z");
  const bids: BidRecord[] = [
    { createdAt: "2026-11-08T17:00:00.000Z", bidAmount: 1000, uniqueId: "a", winning: false, userBid: false, currency: "USD" },
    { createdAt: "2026-11-08T17:30:00.000Z", bidAmount: 1100, uniqueId: "b", winning: false, userBid: false, currency: "USD" },
    { createdAt: "2026-11-08T17:45:00.000Z", bidAmount: 1250, uniqueId: "a", winning: true, userBid: false, currency: "USD" },
    { createdAt: "2026-11-01T10:00:00.000Z", bidAmount: 900, uniqueId: "c", winning: false, userBid: false, currency: "USD" },
  ];

  it("counts unique bidders and recent rate", () => {
    const v = bidVelocity(bids, now, 24);
    expect(v.uniqueBidders).toBe(3);
    expect(v.bidsInWindow).toBe(3);
    expect(v.bidsPerHour).toBeCloseTo(0.13, 6);
    expect(v.averageIncrement).toBeCloseTo(116.67, 1);
    expect(v.minutesSinceLastBid).toBe(15);
  });
});

describe("scoring", () => {
  const now = new Date("2026-11-08T18:00:00.000Z");
  const base = {
    listingId: "l1",
    retailPrice: 40_000,
    units: 400,
    palletCount: 20,
    numberOfBids: 4,
    endTime: "2026-11-10T18:00:00.000Z",
    problemFreeOrderRate: 0.95,
    manifest: true,
    listingType: "SPOT" as const,
    bidBasis: "PRICE" as const,
    siteAbb: "TMP",
    title: "Pallet lot",
    condition: ["Used Good"],
  };

  const evaluate = (hammer: number, retail: number, bids: number) => {
    const economics = dealEconomics({ hammer, retail, units: 400, pallets: 20, recoveryPct: 0.42, cost });
    const velocity = bidVelocity([], now);
    const projected = projectFinalPrice({
      currentBid: hammer,
      startPrice: hammer,
      bids,
      endsAt: base.endTime,
      now,
      retail,
    });
    return scoreAuction({
      listing: { ...base, retailPrice: retail, numberOfBids: bids },
      economics,
      velocity,
      projected,
      now,
      costModel: cost,
    });
  };

  it("prefers a cheaper lot with the same retail", () => {
    const cheap = evaluate(2_000, 40_000, 3);
    const dear = evaluate(9_000, 40_000, 30);
    expect(cheap.score).toBeGreaterThan(dear.score);
    expect(cheap.reasons.length).toBeGreaterThan(0);
  });

  it("flags missing manifests and thin problem-free rates", () => {
    const economics = dealEconomics({ hammer: 3000, retail: 30_000, units: 100, pallets: 5, recoveryPct: 0.4, cost });
    const result = scoreAuction({
      listing: { ...base, manifest: false, problemFreeOrderRate: 0.5 },
      economics,
      velocity: bidVelocity([], now),
      projected: projectFinalPrice({ currentBid: 3000, startPrice: 500, bids: 4, endsAt: base.endTime, now, retail: 30_000 }),
      now,
      costModel: cost,
    });
    expect(result.risks.join(" ")).toMatch(/manifest/i);
    expect(result.risks.join(" ")).toMatch(/problem-free/i);
  });
});

describe("snipe timing", () => {
  it("fires before the close and never in the past", () => {
    const now = new Date("2026-11-08T18:00:00.000Z");
    const s = snipeAt("2026-11-08T18:10:00.000Z", now, 25);
    expect(s.at).toBe("2026-11-08T18:09:35.000Z");
    expect(s.secondsUntilFire).toBe(575);
    const past = snipeAt("2026-11-08T17:00:00.000Z", now, 25);
    expect(past.secondsUntilFire).toBe(0);
  });
});
