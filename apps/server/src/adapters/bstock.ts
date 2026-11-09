import type { BStockClient } from "@bstock/client";
import type { MarketplaceAdapter } from "./types.ts";
import type { Listing, SearchRequest, AuctionState, AuctionBidsResponse } from "@bstock/client";

export class BStockAdapter implements MarketplaceAdapter {
  readonly id = "bstock";
  readonly label = "B-Stock";
  readonly baseUrl = "https://bstock.com";
  readonly public = false;

  constructor(private readonly client: BStockClient) {}

  async searchListings(body: SearchRequest): Promise<{ listings: Listing[]; total: number }> {
    const res = await this.client.searchListings(body);
    const listings = (res.listings ?? []).map((l) => ({ ...l, source: "bstock" } as Listing));
    return { listings, total: res.total ?? listings.length };
  }

  async getAuctions(listingIds: string[]): Promise<AuctionState[]> {
    return this.client.getAuctions(listingIds);
  }

  async getAuctionBids(auctionId: string, opts?: { limit?: number }): Promise<AuctionBidsResponse> {
    return this.client.getAuctionBids(auctionId, opts);
  }

  async placeBid(auctionId: string, amount: number, extra?: Record<string, unknown>): Promise<unknown> {
    return this.client.placeBid(auctionId, { amount, ...extra } as any);
  }

  async probe(): Promise<{ ok: boolean; note?: string }> {
    const results = await this.client.probe();
    const ok = results.length > 0 && results.every((r) => r.ok);
    return { ok, note: results.map((r) => `${r.host}: ${r.status}`).join(", ") };
  }
}
