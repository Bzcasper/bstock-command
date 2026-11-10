/**
 * Advanced Mathematical Funnel & Pattern Engine for Liquidation Pallets.
 *
 * Implements algebraic boundary invariants, elasticity analysis,
 * bidder entropy, hyperbolic time decay, pallet density modeling,
 * Bayesian uncertainty discounts, and a 4-stage auction evaluation funnel.
 */
import { landedCost, maxHammerForRoi, } from "./index.ts";
const clamp01 = (n) => Math.max(0, Math.min(1, n));
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
/**
 * Algebraic Boundary & Elasticity Analysis:
 * Computes the exact invariant max hammer price, break-even point,
 * and the marginal sensitivity (elasticity) of ROI per dollar increment.
 */
export function analyzeAlgebraicBoundaries(currentHammer, retail, recoveryPct, targetRoi, cost) {
    const safeRetail = Math.max(0, retail);
    const safeHammer = Math.max(0, currentHammer);
    const resaleValue = round2(safeRetail * recoveryPct);
    const costBreakdown = landedCost(safeHammer, cost);
    const projectedLanded = costBreakdown.landed;
    const expectedProfit = round2(resaleValue - projectedLanded);
    const expectedRoi = projectedLanded > 0 ? expectedProfit / projectedLanded : 0;
    const costToRetail = safeRetail > 0 ? projectedLanded / safeRetail : 1;
    // Exact maximum hammer for target ROI
    const maxHammer = maxHammerForRoi({
        retail: safeRetail,
        recoveryPct,
        targetRoi,
        cost,
    });
    // Break-even hammer (0% ROI)
    const breakEvenHammer = maxHammerForRoi({
        retail: safeRetail,
        recoveryPct,
        targetRoi: 0,
        cost,
    });
    // Elasticity of ROI with respect to Hammer Price:
    // d(ROI)/dH = -Resale * (1 + beta) * (1 + tau) / Landed^2
    const multiplier = (1 + cost.buyerPremiumPct) * (1 + cost.taxPct);
    let roiElasticity = 0;
    if (projectedLanded > 0 && Math.abs(expectedRoi) > 0.001) {
        const dRoi_dH = -(resaleValue * multiplier) / (projectedLanded * projectedLanded);
        roiElasticity = round2(Math.abs(dRoi_dH * (safeHammer / expectedRoi)));
    }
    return {
        maxHammer,
        costBreakdown,
        projectedLanded,
        resaleValue,
        expectedProfit,
        expectedRoi,
        roiElasticity,
        costToRetail: round2(costToRetail),
        breakEvenHammer,
    };
}
/**
 * Pallet Density & Unit Economics Modeling:
 * Measures volumetric concentration of value to minimize logistics drag.
 */
export function computePalletDensity(retail, landedCostAmount, pallets, units) {
    const p = Math.max(1, pallets ?? 1);
    const u = Math.max(1, units ?? 1);
    const r = Math.max(0, retail);
    const c = Math.max(0, landedCostAmount);
    const retailPerPallet = round2(r / p);
    const costPerPallet = round2(c / p);
    const retailPerUnit = round2(r / u);
    const costPerUnit = round2(c / u);
    const unitsPerPallet = round2(u / p);
    // Density index normalized: $0 to $30,000 retail/pallet -> 0..1
    const densityIndex = clamp01(retailPerPallet / 25_000);
    return {
        retailPerPallet,
        costPerPallet,
        retailPerUnit,
        costPerUnit,
        unitsPerPallet,
        densityIndex,
    };
}
/**
 * Pattern Dynamics: Bidding Velocity, Bidder Shannon Entropy & Sniper Pressure:
 * Quantifies organic interest vs irrational two-party bidding wars.
 */
export function analyzeBiddingPatterns(bids, bidCount, startTime, endTime, now, currentHammer, resaleValue) {
    const nowMs = now.getTime();
    const endMs = Date.parse(endTime);
    const hoursRemaining = Math.max(0, (endMs - nowMs) / 3600_000);
    const startMs = startTime ? Date.parse(startTime) : Number.NaN;
    const elapsedHours = Number.isFinite(startMs)
        ? Math.max(0.5, (nowMs - startMs) / 3600_000)
        : 24;
    const bidsPerHour = round2(bidCount / elapsedHours);
    // Shannon entropy of bidders
    let bidderEntropy = 1.0;
    let uniqueBidderCount = 1;
    if (bids && bids.length > 0) {
        const counts = new Map();
        for (const b of bids) {
            counts.set(b.uniqueId, (counts.get(b.uniqueId) ?? 0) + 1);
        }
        uniqueBidderCount = counts.size;
        const total = bids.length;
        let entropy = 0;
        for (const count of counts.values()) {
            const p = count / total;
            if (p > 0)
                entropy -= p * Math.log2(p);
        }
        const maxEntropy = Math.log2(Math.max(2, uniqueBidderCount));
        bidderEntropy = maxEntropy > 0 ? round2(entropy / maxEntropy) : 1.0;
    }
    else {
        uniqueBidderCount = Math.min(bidCount, Math.max(1, Math.round(bidCount * 0.4)));
    }
    // Bidding war anomaly: low entropy (<0.5) with high bids (>15)
    // implies 2 bidders driving price up in a stubborn duel
    const isBiddingWar = (bidCount >= 14 && bidderEntropy < 0.5) || bidsPerHour > 4.5;
    // Sleeper anomaly: auction ending within 36 hours with <= 3 bids and current price < 35% resale
    const isSleeper = hoursRemaining <= 36 && bidCount <= 3 && (resaleValue <= 0 || currentHammer < resaleValue * 0.4);
    // Sniping urgency index (logistic curve as time expires)
    const snipePressureIndex = clamp01(1 / (1 + Math.exp(0.12 * (hoursRemaining - 6))));
    return {
        bidsPerHour,
        bidderCount: uniqueBidderCount,
        bidderEntropy,
        isBiddingWar,
        isSleeper,
        snipePressureIndex: round2(snipePressureIndex),
        hoursRemaining: round2(hoursRemaining),
    };
}
/**
 * 4-Stage Auction Funnel Evaluator:
 * Ingests a pallet listing and passes it through strict algebraic gates,
 * pattern recognition filters, and alpha optimization scoring.
 */
export function evaluateListingFunnel(listing, settings, now = new Date()) {
    const currentHammer = listing.winningBidAmount ?? listing.currentBid ?? listing.nextMinBidAmount ?? 0;
    const retail = listing.retailPrice ?? 0;
    const recoveryPct = settings.recoveryPctDefault;
    const targetRoi = settings.targetRoiDefault;
    // 1. Algebraic analysis
    const algebraic = analyzeAlgebraicBoundaries(currentHammer, retail, recoveryPct, targetRoi, settings.cost);
    // 2. Pallet density
    const density = computePalletDensity(retail, algebraic.projectedLanded, listing.palletCount, listing.units);
    // 3. Pattern dynamics
    const pattern = analyzeBiddingPatterns(listing.bidsHistory, listing.numberOfBids ?? 0, listing.biddingStartTime ?? listing.startTime, listing.endTime, now, currentHammer, algebraic.resaleValue);
    const reasons = [];
    const risks = [];
    // STAGE 1: Algebraic Viability Gate
    let passedStage1Viable = true;
    if (retail <= 0) {
        passedStage1Viable = false;
        risks.push("Missing retail value; valuation cannot be guaranteed.");
    }
    if (currentHammer > algebraic.maxHammer) {
        passedStage1Viable = false;
        risks.push(`Current bid $${currentHammer.toLocaleString()} exceeds max hammer budget of $${algebraic.maxHammer.toLocaleString()}.`);
    }
    if (algebraic.expectedRoi < settings.minRoi) {
        passedStage1Viable = false;
        risks.push(`Projected ROI ${(algebraic.expectedRoi * 100).toFixed(1)}% is below minimum threshold ${(settings.minRoi * 100).toFixed(0)}%.`);
    }
    if (settings.requireManifest && !listing.manifest) {
        passedStage1Viable = false;
        risks.push("Manifest required by trading rules but absent on this lot.");
    }
    const pfr = listing.problemFreeOrderRate ?? 0.9;
    if (pfr < 0.75) {
        passedStage1Viable = false;
        risks.push(`Seller problem-free rate ${(pfr * 100).toFixed(0)}% is below 75% security line.`);
    }
    // STAGE 2: Pattern Approval Gate
    let passedStage2Pattern = passedStage1Viable;
    if (passedStage1Viable) {
        if (pattern.isBiddingWar) {
            passedStage2Pattern = false;
            risks.push(`Overheated bidding war: low bidder entropy (${pattern.bidderEntropy.toFixed(2)}) indicating irrational duel.`);
        }
    }
    // STAGE 3: Alpha Scoring & Tier Assignment
    // Multidimensional composite scoring using normalized factors
    const roiFactor = clamp01((algebraic.expectedRoi - 0.1) / 0.7); // 10% to 80% ROI
    const discountFactor = clamp01(1 - algebraic.costToRetail / 0.5); // discount vs 50% retail
    const densityFactor = density.densityIndex;
    const manifestCertainty = listing.manifest ? 1.0 : 0.65;
    const competitionFactor = clamp01(1 - (listing.numberOfBids ?? 0) / 35);
    const sleeperBonus = pattern.isSleeper ? 0.15 : 0;
    const sellerQuality = clamp01(pfr);
    const rawScore = 0.30 * roiFactor +
        0.22 * discountFactor +
        0.16 * densityFactor +
        0.14 * competitionFactor +
        0.10 * manifestCertainty +
        0.08 * sellerQuality +
        sleeperBonus;
    const score = round2(clamp01(rawScore) * 100);
    // Kelly-criterion capital allocation sizing
    // win probability approximation based on current vs max hammer and competition
    const pWin = clamp01(0.85 - (listing.numberOfBids ?? 0) * 0.02 - (currentHammer / (algebraic.maxHammer + 1)) * 0.25);
    const payoffOdds = Math.max(0.01, algebraic.expectedRoi);
    const kellyFraction = round2(clamp01((pWin * payoffOdds - (1 - pWin)) / payoffOdds));
    // Determine Funnel Stage & Tier
    let stage = "ingested";
    let tier = "AVOID";
    if (!passedStage1Viable) {
        stage = "ingested";
        tier = "AVOID";
    }
    else if (!passedStage2Pattern) {
        stage = "viable";
        tier = "SPECULATIVE";
    }
    else {
        // Both Stage 1 and Stage 2 passed
        stage = "alpha_ranked";
        if (score >= 72 && algebraic.expectedRoi >= 0.35 && (listing.manifest || pfr >= 0.9) && density.retailPerPallet >= 2500) {
            tier = "ALPHA_GEM";
            reasons.push(`Top Alpha Gem: ${(algebraic.expectedRoi * 100).toFixed(1)}% ROI, dense pallet value $${density.retailPerPallet.toLocaleString()}/pallet.`);
        }
        else if (pattern.isSleeper) {
            tier = "SLEEPER_SNIPE";
            reasons.push(`Sleeper Pallet: only ${listing.numberOfBids ?? 0} bid(s) closing in ${pattern.hoursRemaining.toFixed(1)} hours.`);
        }
        else if (score >= 55 && algebraic.expectedRoi >= 0.22) {
            tier = "SOLID_VALUE";
            reasons.push(`Solid Value: ${(algebraic.expectedRoi * 100).toFixed(1)}% ROI at ${(algebraic.costToRetail * 100).toFixed(1)}% cost-to-retail.`);
        }
        else {
            tier = "SPECULATIVE";
            reasons.push(`Positive expectation with score ${score}/100.`);
        }
    }
    if (listing.manifest) {
        reasons.push("Itemized manifest verified — zero blind-lot penalty.");
    }
    if (density.retailPerPallet > 5000) {
        reasons.push(`High density pallet: $${density.retailPerPallet.toLocaleString()} retail per pallet minimizes freight drag.`);
    }
    // Recommended bid: snipe price just below maxHammer
    const recommendedBid = round2(Math.min(algebraic.maxHammer, currentHammer * 1.15 + 25));
    return {
        listingId: listing.listingId,
        stage,
        tier,
        passedStage1Viable,
        passedStage2Pattern,
        score,
        algebraic,
        density,
        pattern,
        reasons,
        risks,
        recommendedBid,
        kellyFraction,
    };
}
/**
 * Funnel Engine Runner:
 * Processes an entire batch of listings through the 4-stage funnel,
 * returning summary metrics, tier distributions, and ranked top opportunities.
 */
export function runAuctionFunnel(listings, settings, now = new Date()) {
    const evaluations = listings.map((l) => evaluateListingFunnel(l, settings, now));
    const tierCounts = {
        ALPHA_GEM: 0,
        SOLID_VALUE: 0,
        SLEEPER_SNIPE: 0,
        SPECULATIVE: 0,
        AVOID: 0,
    };
    let stage1Viable = 0;
    let stage2PatternApproved = 0;
    let stage3AlphaRanked = 0;
    for (const e of evaluations) {
        tierCounts[e.tier] += 1;
        if (e.passedStage1Viable)
            stage1Viable += 1;
        if (e.passedStage2Pattern)
            stage2PatternApproved += 1;
        if (e.stage === "alpha_ranked")
            stage3AlphaRanked += 1;
    }
    // Sort by score descending
    const sorted = [...evaluations].sort((a, b) => {
        // Priority order: ALPHA_GEM > SLEEPER_SNIPE > SOLID_VALUE > SPECULATIVE > AVOID
        const tierWeight = {
            ALPHA_GEM: 500,
            SLEEPER_SNIPE: 400,
            SOLID_VALUE: 300,
            SPECULATIVE: 200,
            AVOID: 0,
        };
        const diff = (tierWeight[b.tier] + b.score) - (tierWeight[a.tier] + a.score);
        return diff !== 0 ? diff : b.algebraic.expectedRoi - a.algebraic.expectedRoi;
    });
    return {
        totalIngested: listings.length,
        stage1Viable,
        stage2PatternApproved,
        stage3AlphaRanked,
        tierCounts,
        topOpportunities: sorted,
    };
}
