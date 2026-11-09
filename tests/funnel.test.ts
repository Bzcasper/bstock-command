import { describe, expect, it } from "vitest";
import {
  analyzeAlgebraicBoundaries,
  computePalletDensity,
  analyzeBiddingPatterns,
  evaluateListingFunnel,
  runAuctionFunnel,
  type CostModel,
} from "@bstock/analytics";
import type { Listing, BidRecord } from "@bstock/client";

const testCostModel: CostModel = {
  buyerPremiumPct: 0.10,
  taxPct: 0.05,
  shipping: 200,
  otherFees: 50,
};

describe("mathematical funnel & algebraic invariants", () => {
  it("computes exact algebraic boundary and elasticity", () => {
    const analysis = analyzeAlgebraicBoundaries(
      1000,   // current hammer
      10000,  // retail
      0.40,   // 40% recovery
      0.30,   // 30% target ROI
      testCostModel,
    );

    // Resale = 10,000 * 0.40 = 4,000
    expect(analysis.resaleValue).toBe(4000);
    // Landed = 1000 * 1.10 * 1.05 + 200 + 50 = 1155 + 250 = 1405
    expect(analysis.projectedLanded).toBe(1405);
    // Profit = 4000 - 1405 = 2595
    expect(analysis.expectedProfit).toBe(2595);
    expect(analysis.expectedRoi).toBeGreaterThan(1.5);
    // Max hammer for 30% ROI:
    // budget = 4000 / 1.30 - 250 = 3076.92 - 250 = 2826.92
    // maxHammer = 2826.92 / (1.10 * 1.05) = 2826.92 / 1.155 = ~2447.55
    expect(analysis.maxHammer).toBeCloseTo(2447.55, 0);
    // ROI elasticity should be positive
    expect(analysis.roiElasticity).toBeGreaterThan(0);
    expect(analysis.breakEvenHammer).toBeGreaterThan(analysis.maxHammer);
  });

  it("calculates pallet density metrics accurately", () => {
    const density = computePalletDensity(20_000, 2_000, 2, 100);
    expect(density.retailPerPallet).toBe(10_000);
    expect(density.costPerPallet).toBe(1_000);
    expect(density.retailPerUnit).toBe(200);
    expect(density.costPerUnit).toBe(20);
    expect(density.unitsPerPallet).toBe(50);
    expect(density.densityIndex).toBeGreaterThan(0.3);
  });

  it("detects bidding war vs sleeper anomaly from bidder entropy", () => {
    const now = new Date("2026-11-08T18:00:00Z");
    const closesSoon = "2026-11-08T22:00:00Z";

    // Sleeper: 1 bid, closes in 4 hours
    const sleeperPattern = analyzeBiddingPatterns(
      [],
      1,
      "2026-11-07T12:00:00Z",
      closesSoon,
      now,
      500,
      3000,
    );
    expect(sleeperPattern.isSleeper).toBe(true);
    expect(sleeperPattern.isBiddingWar).toBe(false);
    expect(sleeperPattern.snipePressureIndex).toBeGreaterThan(0.5);

    // Bidding war: 2 bidders dueling for 20 bids
    const duelingBids: BidRecord[] = [];
    for (let i = 0; i < 20; i++) {
      duelingBids.push({
        uniqueId: i % 2 === 0 ? "bidder-A" : "bidder-B",
        bidAmount: 100 + i * 50,
        createdAt: new Date(Date.now() - (20 - i) * 60000).toISOString(),
        winning: i === 19,
        userBid: false,
        currency: "USD",
      });
    }

    const warPattern = analyzeBiddingPatterns(
      duelingBids,
      20,
      "2026-11-08T16:00:00Z",
      closesSoon,
      now,
      1100,
      2000,
    );
    expect(warPattern.isBiddingWar).toBe(true);
    expect(warPattern.isSleeper).toBe(false);
  });

  it("funnels listings through 4 stages and assigns ALPHA_GEM tier", () => {
    const now = new Date("2026-11-08T18:00:00Z");

    const gemListing = {
      listingId: "lot-gem-1",
      lotId: "lot-1",
      siteAbb: "target",
      title: "Target High Density Electronics Pallet",
      retailPrice: 15_000,
      palletCount: 1,
      units: 75,
      numberOfBids: 2,
      currentBid: 800,
      endTime: "2026-11-09T12:00:00Z",
      biddingStartTime: "2026-11-08T08:00:00Z",
      manifest: true,
      problemFreeOrderRate: 0.95,
      currency: "USD",
    } as unknown as Listing;

    const evalResult = evaluateListingFunnel(
      gemListing,
      {
        minRoi: 0.20,
        targetRoiDefault: 0.30,
        recoveryPctDefault: 0.45,
        requireManifest: true,
        cost: testCostModel,
      },
      now,
    );

    expect(evalResult.passedStage1Viable).toBe(true);
    expect(evalResult.passedStage2Pattern).toBe(true);
    expect(evalResult.stage).toBe("alpha_ranked");
    expect(evalResult.tier).toBe("ALPHA_GEM");
    expect(evalResult.score).toBeGreaterThanOrEqual(70);
    expect(evalResult.recommendedBid).toBeGreaterThan(800);
    expect(evalResult.kellyFraction).toBeGreaterThan(0);
  });

  it("filters out overbid auctions and flags as AVOID in Stage 1", () => {
    const now = new Date("2026-11-08T18:00:00Z");

    const badListing = {
      listingId: "lot-bad-1",
      lotId: "lot-2",
      siteAbb: "amazon",
      title: "Overpriced Mystery Box Pallet",
      retailPrice: 2000,
      palletCount: 2,
      units: 20,
      numberOfBids: 18,
      currentBid: 1800, // overbid vs 2000 retail
      endTime: "2026-11-09T12:00:00Z",
      biddingStartTime: "2026-11-08T08:00:00Z",
      manifest: false,
      problemFreeOrderRate: 0.60, // bad seller
      currency: "USD",
    } as unknown as Listing;

    const evalResult = evaluateListingFunnel(
      badListing,
      {
        minRoi: 0.20,
        targetRoiDefault: 0.30,
        recoveryPctDefault: 0.40,
        requireManifest: false,
        cost: testCostModel,
      },
      now,
    );

    expect(evalResult.passedStage1Viable).toBe(false);
    expect(evalResult.tier).toBe("AVOID");
    expect(evalResult.risks.length).toBeGreaterThan(0);
  });

  it("processes a batch of listings and produces FunnelSummary", () => {
    const now = new Date("2026-11-08T18:00:00Z");

    const listings = [
      {
        listingId: "1",
        lotId: "lot-1",
        siteAbb: "walmart",
        title: "Walmart Pallet 1",
        retailPrice: 12000,
        palletCount: 1,
        units: 50,
        numberOfBids: 1,
        currentBid: 400,
        endTime: "2026-11-09T02:00:00Z", // Sleeper
        manifest: true,
        problemFreeOrderRate: 0.92,
        currency: "USD",
      },
      {
        listingId: "2",
        lotId: "lot-2",
        siteAbb: "costco",
        title: "Costco Pallet 2",
        retailPrice: 18000,
        palletCount: 2,
        units: 120,
        numberOfBids: 3,
        currentBid: 1000,
        endTime: "2026-11-10T12:00:00Z",
        manifest: true,
        problemFreeOrderRate: 0.96,
        currency: "USD",
      },
    ] as unknown as Listing[];

    const summary = runAuctionFunnel(
      listings,
      {
        minRoi: 0.15,
        targetRoiDefault: 0.30,
        recoveryPctDefault: 0.40,
        requireManifest: false,
        cost: testCostModel,
      },
      now,
    );

    expect(summary.totalIngested).toBe(2);
    expect(summary.stage1Viable).toBe(2);
    expect(summary.stage2PatternApproved).toBe(2);
    expect(summary.stage3AlphaRanked).toBe(2);
    expect(summary.topOpportunities.length).toBe(2);
    expect(summary.topOpportunities[0].score).toBeGreaterThan(0);
  });
});
