import { describe, expect, it } from "vitest";
import { BStockApiError, BStockAuthError } from "@bstock/client";
import { startHarness } from "./helpers.ts";

describe("client against the mock", () => {
  it("rejects auction reads without Cloudflare clearance", async () => {
    const h = await startHarness({ clearance: null });
    try {
      await expect(h.client.getAuctions(["mock000000"])).rejects.toBeInstanceOf(BStockApiError);
      await expect(h.client.getAuctions(["mock000000"])).rejects.toMatchObject({ status: 403 });
    } finally {
      await h.close();
    }
  });

  it("reads auctions and listings with clearance", async () => {
    const h = await startHarness();
    try {
      const auctions = await h.client.getAuctions([h.mock.market[0].listing.listingId]);
      expect(auctions).toHaveLength(1);
      expect(auctions[0]._id).toBe(h.mock.market[0].auction._id);
      const filters = await h.client.getFilterOptions();
      expect(filters.categories.length).toBeGreaterThan(0);
      const search = await h.client.searchListings({ limit: 5, sortBy: "endTime", sortOrder: "asc" });
      expect(search.listings).toHaveLength(5);
      expect(search.total).toBeGreaterThan(40);
    } finally {
      await h.close();
    }
  });

  it("rejects bids without a bearer token", async () => {
    const h = await startHarness();
    try {
      const auctionId = h.mock.market[0].auction._id;
      await expect(h.client.placeBid(auctionId, { amount: 9999 })).rejects.toBeInstanceOf(BStockAuthError);
    } finally {
      await h.close();
    }
  });

  it("places a bid with a valid token", async () => {
    const h = await startHarness();
    try {
      await h.client.login({ loginId: "demo@example.com", password: "demo-password" });
      const m = h.mock.market[0];
      const before = m.bids.length;
      const res = await h.client.placeBid(m.auction._id, { amount: m.auction.nextMinBidAmount });
      expect(res.status).toBe("ACCEPTED");
      expect(m.bids.length).toBe(before + 1);
    } finally {
      await h.close();
    }
  });
});
