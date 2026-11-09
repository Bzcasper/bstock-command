import { describe, it, expect } from "vitest";
import {
  classifyBrand,
  classifyConditionMultiplier,
  standardizeManifestItem,
  analyzeManifestComps,
} from "@bstock/analytics";

describe("Manifest Comp & Secondary Market Valuation Engine", () => {
  it("correctly classifies brands across equity tiers", () => {
    expect(classifyBrand("Apple").tier).toBe(1);
    expect(classifyBrand("Sony Electronics").tier).toBe(1);
    expect(classifyBrand("Anker").tier).toBe(2);
    expect(classifyBrand("Logitech").tier).toBe(2);
    expect(classifyBrand("Amazon Basics").tier).toBe(3);
    expect(classifyBrand("Mainstays").tier).toBe(3);
    expect(classifyBrand("Alotiki").tier).toBe(4);
    expect(classifyBrand("Generic").tier).toBe(4);
    expect(classifyBrand(null).tier).toBe(4);
  });

  it("scales condition multipliers properly", () => {
    expect(classifyConditionMultiplier("BRAND_NEW")).toBe(1.0);
    expect(classifyConditionMultiplier("LIKE_NEW")).toBe(0.85);
    expect(classifyConditionMultiplier("USED_GOOD")).toBe(0.65);
    expect(classifyConditionMultiplier("USED_FAIR")).toBe(0.45);
    expect(classifyConditionMultiplier("SALVAGE")).toBe(0.15);
  });

  it("standardizes raw B-Stock lot items with ASIN and comps", () => {
    const raw = {
      _id: "item123",
      attributes: {
        brandName: "Apple",
        description: "Apple AirPods Pro 2nd Gen",
        unitRetail: 24900,
        extRetail: 124500,
        currencyCode: "USD",
        ids: { asin: ["B0BDHWDR12"] },
      },
      itemCondition: "LIKE_NEW",
      quantity: 5,
    };

    const item = standardizeManifestItem(raw, 0);
    expect(item.id).toBe("item123");
    expect(item.asin).toBe("B0BDHWDR12");
    expect(item.brand).toBe("Apple");
    expect(item.brandTier).toBe(1);
    expect(item.quantity).toBe(5);
    expect(item.unitRetail).toBe(249);
    // 249 * 0.65 (Tier 1) * 0.85 (Like New) = 137.57
    expect(item.estimatedUnitResale).toBeCloseTo(137.57, 1);
    expect(item.estimatedExtResale).toBeCloseTo(137.57 * 5, 1);
  });

  it("identifies HIGH_CONFIDENCE_ALPHA on premium brand concentration", () => {
    const items = [
      {
        attributes: { brandName: "Apple", description: "iPad 10th Gen", unitRetail: 449.0, extRetail: 4490.0 },
        itemCondition: "BRAND_NEW",
        quantity: 10,
      },
      {
        attributes: { brandName: "Sony", description: "WH-1000XM5", unitRetail: 399.0, extRetail: 1995.0 },
        itemCondition: "LIKE_NEW",
        quantity: 5,
      },
      {
        attributes: { brandName: "Anker", description: "Power Bank", unitRetail: 49.0, extRetail: 490.0 },
        itemCondition: "BRAND_NEW",
        quantity: 10,
      },
    ];

    const analysis = analyzeManifestComps(items, 0.30);
    expect(analysis.totalUnits).toBe(25);
    expect(analysis.effectiveRecoveryPct).toBeGreaterThan(0.45);
    expect(analysis.recoveryAlphaPct).toBeGreaterThan(0.10);
    expect(analysis.verdict).toBe("HIGH_CONFIDENCE_ALPHA");
    expect(analysis.brandTiers[1].units).toBe(15);
  });

  it("flags INFLATED_RETAIL_RISK when unbranded items have high stated retail", () => {
    const items = [
      {
        attributes: { brandName: "Unbranded", description: "Cheap phone cases", unitRetail: 49.0, extRetail: 4900.0 },
        itemCondition: "USED_FAIR",
        quantity: 100,
      },
      {
        attributes: { brandName: "Generic", description: "Charging cables", unitRetail: 29.0, extRetail: 2900.0 },
        itemCondition: "USED_GOOD",
        quantity: 100,
      },
    ];

    const analysis = analyzeManifestComps(items, 0.30);
    expect(analysis.totalUnits).toBe(200);
    // 49 * 0.18 * 0.45 = 3.96 / 49 = ~8% recovery
    expect(analysis.effectiveRecoveryPct).toBeLessThan(0.15);
    expect(analysis.verdict).toBe("INFLATED_RETAIL_RISK");
  });
});
