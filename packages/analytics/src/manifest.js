/**
 * Manifest Comp & Secondary Market Valuation Engine.
 *
 * Evaluates line-item manifests using brand equity tiers, condition degradation
 * curves, and category comp multipliers to derive mathematically grounded
 * resale value rather than relying on uncalibrated flat retail recovery rates.
 */
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const clamp = (min, max, n) => Math.max(min, Math.min(max, n));
const TIER_1_BRANDS = new Set([
    "apple", "sony", "samsung", "dyson", "milwaukee", "dewalt", "bose", "nintendo",
    "microsoft", "lego", "google", "meta", "playstation", "xbox", "canon", "nikon",
    "rolex", "louis vuitton", "gucci", "prada", "patagonia", "arcteryx", "shimano",
    "traeger", "breville", "vitamix", "sonos", "garmin", "panasonic", "lg"
]);
const TIER_2_BRANDS = new Set([
    "anker", "philips", "logitech", "kitchenaid", "cuisinart", "shark", "ninja",
    "jbl", "hp", "dell", "asus", "lenovo", "makita", "ryobi", "craftsman", "stanley",
    "black & decker", "irobot", "ring", "nest", "tplink", "tp-link", "netgear",
    "corsair", "razer", "steelseries", "belkin", "fitbit", "skullcandy", "keen",
    "columbia", "the north face", "carhartt", "under armour", "nike", "adidas",
    "puma", "new balance", "casio", "seiko", "citizen", "yeti", "hydro flask"
]);
const TIER_3_BRANDS = new Set([
    "amazon basics", "amazonbasics", "mainstays", "onn", "kirkland", "insignia",
    "great value", "up & up", "member's mark", "members mark", "amazon", "target",
    "walmart", "brentwood", "ge", "whirlpool", "honeywell", "sunbeam", "oster",
    "hamilton beach", "black+decker", "crock-pot", "bella", "farberware"
]);
/**
 * Classifies brand into equity tiers:
 * Tier 1: 0.65 multiplier (high resale liquidity, premium secondary pricing)
 * Tier 2: 0.48 multiplier (strong demand, steady turnover)
 * Tier 3: 0.30 multiplier (mass market, moderate clearance recovery)
 * Tier 4: 0.18 multiplier (unbranded / unknown private label / high retail markup)
 */
export function classifyBrand(brandName) {
    if (!brandName)
        return { tier: 4, multiplier: 0.18 };
    const clean = brandName.trim().toLowerCase();
    if (!clean || clean === "generic" || clean === "unknown" || clean === "unbranded" || clean === "n/a") {
        return { tier: 4, multiplier: 0.18 };
    }
    for (const b of TIER_1_BRANDS) {
        if (clean === b || clean.startsWith(`${b} `) || clean.endsWith(` ${b}`)) {
            return { tier: 1, multiplier: 0.65 };
        }
    }
    for (const b of TIER_2_BRANDS) {
        if (clean === b || clean.startsWith(`${b} `) || clean.endsWith(` ${b}`)) {
            return { tier: 2, multiplier: 0.48 };
        }
    }
    for (const b of TIER_3_BRANDS) {
        if (clean === b || clean.startsWith(`${b} `) || clean.endsWith(` ${b}`)) {
            return { tier: 3, multiplier: 0.30 };
        }
    }
    return { tier: 4, multiplier: 0.20 };
}
/**
 * Maps condition strings to secondary recovery degradation factors.
 */
export function classifyConditionMultiplier(condition) {
    if (!condition)
        return 0.65;
    const c = condition.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    if (c.includes("NEW") && !c.includes("LIKE") && !c.includes("OTHER"))
        return 1.00;
    if (c.includes("SEALED") || c.includes("BRAND_NEW"))
        return 1.00;
    if (c.includes("LIKE_NEW") || c.includes("OPEN_BOX") || c.includes("GRADE_A"))
        return 0.85;
    if (c.includes("USED_GOOD") || c.includes("REFURBISHED") || c.includes("GRADE_B") || c.includes("CUSTOMER_RETURNS"))
        return 0.65;
    if (c.includes("USED_FAIR") || c.includes("GRADE_C") || c.includes("SCRATCH"))
        return 0.45;
    if (c.includes("SALVAGE") || c.includes("DEFECTIVE") || c.includes("PARTS") || c.includes("GRADE_D"))
        return 0.15;
    return 0.60;
}
/**
 * Standardizes a single raw manifest line item.
 */
export function standardizeManifestItem(raw, idx) {
    const attr = raw.attributes || raw;
    const brand = attr.brandName || attr.brand || raw.brand || "Generic";
    const title = attr.description || attr.title || raw.title || raw.description || `Item #${idx + 1}`;
    const condition = raw.itemCondition || attr.condition || raw.condition || "USED_GOOD";
    const quantity = Math.max(1, Number(raw.quantity ?? attr.quantity ?? 1));
    let unitRetail = Number(attr.unitRetail ?? raw.unitRetail ?? 0);
    let extRetail = Number(attr.extRetail ?? raw.extRetail ?? 0);
    // B-Stock's API represents prices in cents when currencyCode is present in attributes
    if (attr.currencyCode && Number.isInteger(unitRetail) && unitRetail > 0) {
        unitRetail = unitRetail / 100;
        extRetail = extRetail > 0 ? extRetail / 100 : unitRetail * quantity;
    }
    else {
        if (!extRetail && unitRetail)
            extRetail = unitRetail * quantity;
        if (!unitRetail && extRetail && quantity)
            unitRetail = extRetail / quantity;
    }
    const { tier, multiplier: brandMultiplier } = classifyBrand(brand);
    const condMultiplier = classifyConditionMultiplier(condition);
    const estimatedUnitResale = round2(unitRetail * brandMultiplier * condMultiplier);
    const estimatedExtResale = round2(estimatedUnitResale * quantity);
    const ids = attr.ids || {};
    const asin = ids.asin?.[0] || attr.asin || raw.asin;
    const upc = ids.upc?.[0] || attr.upc || raw.upc;
    const sku = attr.sku || raw.sku || raw.sellerLotId;
    return {
        id: raw._id || String(idx),
        asin,
        upc,
        sku,
        brand,
        title,
        category: raw.categories?.[0] || attr.category || raw.category,
        condition,
        quantity,
        unitRetail: round2(unitRetail),
        extRetail: round2(extRetail),
        estimatedUnitResale,
        estimatedExtResale,
        brandTier: tier,
        conditionMultiplier: condMultiplier,
    };
}
/**
 * Analyzes an entire manifest array to compute true comps and alpha opportunities.
 */
export function analyzeManifestComps(rawItems, baselineRecoveryPct = 0.30) {
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
        return {
            itemCount: 0,
            totalUnits: 0,
            totalStatedRetail: 0,
            totalEstimatedResale: 0,
            effectiveRecoveryPct: 0,
            baselineRecoveryPct,
            recoveryAlphaPct: 0,
            brandTiers: {
                1: { units: 0, retail: 0, estimatedResale: 0, unitSharePct: 0 },
                2: { units: 0, retail: 0, estimatedResale: 0, unitSharePct: 0 },
                3: { units: 0, retail: 0, estimatedResale: 0, unitSharePct: 0 },
                4: { units: 0, retail: 0, estimatedResale: 0, unitSharePct: 0 },
            },
            topBrands: [],
            conditionDistribution: {},
            verdict: "FAIR_VALUE",
            verdictReason: "No manifest line items available.",
            sampleItems: [],
        };
    }
    const items = rawItems.map((r, i) => standardizeManifestItem(r, i));
    let totalUnits = 0;
    let totalStatedRetail = 0;
    let totalEstimatedResale = 0;
    const tierMap = {
        1: { units: 0, retail: 0, estimatedResale: 0 },
        2: { units: 0, retail: 0, estimatedResale: 0 },
        3: { units: 0, retail: 0, estimatedResale: 0 },
        4: { units: 0, retail: 0, estimatedResale: 0 },
    };
    const brandAgg = new Map();
    const condAgg = new Map();
    for (const it of items) {
        totalUnits += it.quantity;
        totalStatedRetail += it.extRetail;
        totalEstimatedResale += it.estimatedExtResale;
        const t = tierMap[it.brandTier];
        t.units += it.quantity;
        t.retail += it.extRetail;
        t.estimatedResale += it.estimatedExtResale;
        const bName = it.brand || "Generic";
        const existingB = brandAgg.get(bName) ?? { tier: it.brandTier, units: 0, retail: 0, resale: 0 };
        existingB.units += it.quantity;
        existingB.retail += it.extRetail;
        existingB.resale += it.estimatedExtResale;
        brandAgg.set(bName, existingB);
        condAgg.set(it.condition, (condAgg.get(it.condition) ?? 0) + it.quantity);
    }
    const effectiveRecoveryPct = totalStatedRetail > 0 ? round2(totalEstimatedResale / totalStatedRetail) : baselineRecoveryPct;
    const recoveryAlphaPct = round2(effectiveRecoveryPct - baselineRecoveryPct);
    const brandTiers = {
        1: {
            units: tierMap[1].units,
            retail: round2(tierMap[1].retail),
            estimatedResale: round2(tierMap[1].estimatedResale),
            unitSharePct: totalUnits > 0 ? round2((tierMap[1].units / totalUnits) * 100) : 0,
        },
        2: {
            units: tierMap[2].units,
            retail: round2(tierMap[2].retail),
            estimatedResale: round2(tierMap[2].estimatedResale),
            unitSharePct: totalUnits > 0 ? round2((tierMap[2].units / totalUnits) * 100) : 0,
        },
        3: {
            units: tierMap[3].units,
            retail: round2(tierMap[3].retail),
            estimatedResale: round2(tierMap[3].estimatedResale),
            unitSharePct: totalUnits > 0 ? round2((tierMap[3].units / totalUnits) * 100) : 0,
        },
        4: {
            units: tierMap[4].units,
            retail: round2(tierMap[4].retail),
            estimatedResale: round2(tierMap[4].estimatedResale),
            unitSharePct: totalUnits > 0 ? round2((tierMap[4].units / totalUnits) * 100) : 0,
        },
    };
    const topBrands = Array.from(brandAgg.entries())
        .map(([brand, data]) => ({
        brand,
        tier: data.tier,
        units: data.units,
        extRetail: round2(data.retail),
        estimatedResale: round2(data.resale),
    }))
        .sort((a, b) => b.estimatedResale - a.estimatedResale)
        .slice(0, 8);
    const conditionDistribution = {};
    for (const [cond, u] of condAgg.entries()) {
        conditionDistribution[cond] = {
            units: u,
            sharePct: totalUnits > 0 ? round2((u / totalUnits) * 100) : 0,
        };
    }
    // Alpha Verdict Determination
    const premiumShare = (tierMap[1].units + tierMap[2].units) / Math.max(1, totalUnits);
    const unbrandedShare = tierMap[4].units / Math.max(1, totalUnits);
    let verdict = "FAIR_VALUE";
    let verdictReason = "";
    if (premiumShare >= 0.40 && recoveryAlphaPct >= 0.08) {
        verdict = "HIGH_CONFIDENCE_ALPHA";
        verdictReason = `High concentration of Tier 1/2 brands (${(premiumShare * 100).toFixed(0)}% of units) yields +${(recoveryAlphaPct * 100).toFixed(1)}% recovery alpha above baseline.`;
    }
    else if (unbrandedShare >= 0.70 && effectiveRecoveryPct < baselineRecoveryPct * 0.75) {
        verdict = "INFLATED_RETAIL_RISK";
        verdictReason = `Over ${(unbrandedShare * 100).toFixed(0)}% unbranded or generic items with inflated retail tags. Real recovery estimated at only ${(effectiveRecoveryPct * 100).toFixed(1)}%.`;
    }
    else if (effectiveRecoveryPct >= baselineRecoveryPct) {
        verdict = "SOLID_VALUE";
        verdictReason = `Balanced manifest with estimated secondary recovery of ${(effectiveRecoveryPct * 100).toFixed(1)}% meeting baseline goals.`;
    }
    else {
        verdict = "FAIR_VALUE";
        verdictReason = `Secondary market recovery estimated at ${(effectiveRecoveryPct * 100).toFixed(1)}%.`;
    }
    return {
        itemCount: items.length,
        totalUnits,
        totalStatedRetail: round2(totalStatedRetail),
        totalEstimatedResale: round2(totalEstimatedResale),
        effectiveRecoveryPct,
        baselineRecoveryPct,
        recoveryAlphaPct,
        brandTiers,
        topBrands,
        conditionDistribution,
        verdict,
        verdictReason,
        sampleItems: items.slice(0, 15),
    };
}
