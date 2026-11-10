/**
 * Buying intelligence for liquidation pallets.
 *
 * All functions are pure and deterministic (time is injected) so a decision can
 * be replayed and audited later. Money is in whole currency units here; the
 * database stores cents and converts at the edges.
 */
export const DEFAULT_COST_MODEL = {
    buyerPremiumPct: 0.125,
    shipping: 0,
    taxPct: 0,
    otherFees: 0,
};
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export function landedCost(hammer, model) {
    const h = Math.max(0, hammer);
    const buyerPremium = round2(h * model.buyerPremiumPct);
    const tax = round2((h + buyerPremium) * model.taxPct);
    const shipping = round2(model.shipping);
    const otherFees = round2(model.otherFees);
    return {
        hammer: round2(h),
        buyerPremium,
        tax,
        shipping,
        otherFees,
        landed: round2(h + buyerPremium + tax + shipping + otherFees),
    };
}
export function dealEconomics(input) {
    const { hammer, retail, units, pallets, recoveryPct, cost } = input;
    const breakdown = landedCost(hammer, cost);
    const resaleValue = round2((retail ?? 0) * recoveryPct);
    const profit = round2(resaleValue - breakdown.landed);
    const roi = breakdown.landed > 0 ? profit / breakdown.landed : 0;
    const margin = resaleValue > 0 ? profit / resaleValue : 0;
    return {
        cost: breakdown,
        recoveryPct,
        resaleValue,
        profit,
        roi,
        margin,
        costPerPallet: pallets && pallets > 0 ? round2(breakdown.landed / pallets) : null,
        costPerUnit: units && units > 0 ? round2(breakdown.landed / units) : null,
        retailPerPallet: retail && pallets && pallets > 0 ? round2(retail / pallets) : null,
        retailPerUnit: retail && units && units > 0 ? round2(retail / units) : null,
        costToRetail: retail && retail > 0 ? breakdown.landed / retail : null,
    };
}
/**
 * Invert the landed-cost equation: the highest hammer price that still hits a
 * target ROI at the given recovery assumption. This is the number that belongs
 * on a bid ticket.
 */
export function maxHammerForRoi(input, floor = 0) {
    const { retail, recoveryPct, targetRoi, cost } = input;
    if (!retail || retail <= 0)
        return round2(floor);
    const resale = retail * recoveryPct;
    const multiplier = (1 + cost.buyerPremiumPct) * (1 + cost.taxPct);
    const budget = resale / (1 + targetRoi) - cost.shipping - cost.otherFees;
    if (budget <= 0)
        return round2(floor);
    return round2(Math.max(floor, budget / multiplier));
}
export function bidVelocity(bids, now, windowHours = 24) {
    const cutoff = now.getTime() - windowHours * 3600_000;
    const inWindow = bids.filter((b) => {
        const t = Date.parse(b.createdAt);
        return Number.isFinite(t) && t >= cutoff;
    });
    const sorted = [...bids].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    let increments = 0;
    let incrementCount = 0;
    for (let i = 1; i < sorted.length; i += 1) {
        const step = sorted[i].bidAmount - sorted[i - 1].bidAmount;
        if (step > 0) {
            increments += step;
            incrementCount += 1;
        }
    }
    const last = sorted.at(-1) ?? null;
    return {
        bidsInWindow: inWindow.length,
        uniqueBidders: new Set(bids.map((b) => b.uniqueId)).size,
        windowHours,
        bidsPerHour: round2(inWindow.length / windowHours),
        averageIncrement: incrementCount > 0 ? round2(increments / incrementCount) : 0,
        lastBidAt: last?.createdAt ?? null,
        minutesSinceLastBid: last ? Math.max(0, Math.round((now.getTime() - Date.parse(last.createdAt)) / 60000)) : null,
    };
}
/**
 * Conservative close-price projection. Deliberately simple and explainable:
 * a cold auction is assumed to move 25–40% off its current price, a contested
 * one is extrapolated from its own bid velocity but damped and capped by retail.
 */
export function projectFinalPrice(input) {
    const ends = Date.parse(input.endsAt);
    const remainingHours = Math.max(0, (ends - input.now.getTime()) / 3600_000);
    const current = Math.max(0, input.currentBid);
    if (input.bids === 0 || current === 0) {
        const base = Math.max(current, input.startPrice);
        const projected = round2(base * 1.25);
        return {
            projected,
            remainingHours: round2(remainingHours),
            low: round2(base),
            high: round2(base * 1.6),
            method: "cold",
            rationale: "No bids yet; assuming a 25% lift over the reserve/start.",
        };
    }
    const startedMs = input.startedAt ? Date.parse(input.startedAt) : Number.NaN;
    const observedSpanHours = Number.isFinite(startedMs)
        ? Math.max(0.25, (input.now.getTime() - startedMs) / 3600_000)
        : 24;
    const bidsPerHour = input.bids / observedSpanHours;
    const contestedLift = current * Math.min(0.4, bidsPerHour * remainingHours * 0.12 + 0.05);
    let projected = current + contestedLift;
    if (input.retail && input.retail > 0)
        projected = Math.min(projected, input.retail * 0.65);
    projected = Math.min(projected, current * 2);
    projected = Math.max(projected, current);
    return {
        projected: round2(projected),
        remainingHours: round2(remainingHours),
        low: round2(current),
        high: round2(Math.min(projected * 1.25, (input.retail ?? projected * 1.25) * 0.6)),
        method: "velocity",
        rationale: `Extrapolated ${round2(bidsPerHour)} bids/h over ${round2(remainingHours)}h remaining, damped and capped at 45% of retail.`,
    };
}
export const DEFAULT_WEIGHTS = {
    roi: 0.34,
    discount: 0.24,
    competition: 0.16,
    quality: 0.12,
    urgency: 0.06,
    density: 0.08,
};
const clamp01 = (n) => Math.max(0, Math.min(1, n));
export function scoreAuction(input) {
    const w = input.weights ?? DEFAULT_WEIGHTS;
    const { listing, economics, velocity, projected, now } = input;
    const projectedEconomics = dealEconomics({
        hammer: projected.projected,
        retail: listing.retailPrice ?? null,
        units: listing.units ?? null,
        pallets: listing.palletCount ?? null,
        recoveryPct: economics.recoveryPct,
        cost: input.costModel ?? {
            buyerPremiumPct: economics.cost.hammer > 0 ? economics.cost.buyerPremium / economics.cost.hammer : 0,
            shipping: economics.cost.shipping,
            taxPct: economics.cost.hammer + economics.cost.buyerPremium > 0
                ? economics.cost.tax / (economics.cost.hammer + economics.cost.buyerPremium)
                : 0,
            otherFees: economics.cost.otherFees,
        },
    });
    const roiScore = clamp01((projectedEconomics.roi + 0.25) / 1.25);
    const discountScore = clamp01(1 - (projectedEconomics.costToRetail ?? 0.6) / 0.6);
    const bidPressure = listing.numberOfBids + velocity.uniqueBidders * 2;
    const competitionScore = clamp01(1 - bidPressure / 60);
    const qualityScore = clamp01((listing.problemFreeOrderRate ?? 0.9) / 1);
    const hoursLeft = Math.max(0, (Date.parse(listing.endTime) - now.getTime()) / 3600_000);
    const urgencyScore = clamp01(1 - Math.min(hoursLeft, 72) / 72);
    const density = listing.retailPrice && listing.palletCount ? listing.retailPrice / listing.palletCount : 0;
    const densityScore = clamp01(density / 40_000);
    const components = {
        roi: roiScore,
        discount: discountScore,
        competition: competitionScore,
        quality: qualityScore,
        urgency: urgencyScore,
        density: densityScore,
    };
    const score = round2(100 *
        (components.roi * w.roi +
            components.discount * w.discount +
            components.competition * w.competition +
            components.quality * w.quality +
            components.urgency * w.urgency +
            components.density * w.density));
    const reasons = [];
    const risks = [];
    reasons.push(`Projected close ${projected.projected.toLocaleString()} → ${(projectedEconomics.roi * 100).toFixed(1)}% ROI at ${(projectedEconomics.costToRetail * 100).toFixed(1)}% of retail.`);
    if (projectedEconomics.costPerPallet)
        reasons.push(`All-in ${projectedEconomics.costPerPallet.toLocaleString()}/pallet.`);
    if (velocity.uniqueBidders <= 2)
        reasons.push(`Only ${velocity.uniqueBidders} bidder(s) so far.`);
    if (listing.manifest)
        reasons.push("Manifest available — line-item verification before bidding.");
    if (!listing.manifest)
        risks.push("No manifest: unit mix is unverified.");
    if ((listing.problemFreeOrderRate ?? 1) < 0.8) {
        risks.push(`Problem-free order rate ${(listing.problemFreeOrderRate * 100).toFixed(0)}%.`);
    }
    if (hoursLeft < 2)
        risks.push(`Closes in ${Math.round(hoursLeft * 60)} minutes — snipe window.`);
    if (listing.bidBasis === "UNIT")
        risks.push("Priced per unit: total exposure depends on final quantity.");
    if ((projectedEconomics.roi ?? 0) < 0)
        risks.push("Negative ROI at the projected close price.");
    return { score, components, reasons, risks };
}
/** Timestamp to fire a bid so it lands inside the closing window without sitting exposed. */
export function snipeAt(endsAt, now, leadSeconds = 25) {
    const target = Date.parse(endsAt) - leadSeconds * 1000;
    return {
        at: new Date(target).toISOString(),
        secondsUntilFire: Math.max(0, Math.round((target - now.getTime()) / 1000)),
    };
}
export function formatMoney(n, currency = "USD") {
    if (n === null || n === undefined || !Number.isFinite(n))
        return "—";
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}
export * from "./funnel.ts";
export * from "./manifest.ts";
