import type { MarketplaceAdapter } from "./types.ts";
import type { Listing, SearchRequest, AuctionState, AuctionBidsResponse } from "@bstock/client";

/**
 * Base class for marketplace adapters. Provides safe defaults so a single
 * failing source never breaks the whole sync.
 */
export abstract class BaseAdapter implements MarketplaceAdapter {
  abstract readonly id: string;
  abstract readonly label: string;
  abstract readonly baseUrl: string;
  readonly public = true;

  protected async safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      console.warn(`[${this.id}] ${(err as Error).message}`);
      return fallback;
    }
  }

  abstract searchListings(body: SearchRequest): Promise<{ listings: Listing[]; total: number }>;

  async getAuctions(listingIds: string[]): Promise<AuctionState[]> {
    return [];
  }

  async getAuctionBids(auctionId: string, opts?: { limit?: number }): Promise<AuctionBidsResponse> {
    return { bids: [], uniqueBidders: 0, numberOfBids: 0 } as AuctionBidsResponse;
  }

  async placeBid(auctionId: string, amount: number, extra?: Record<string, unknown>): Promise<unknown> {
    throw new Error(`${this.id}: bid placement not supported via this adapter`);
  }

  async probe(): Promise<{ ok: boolean; note?: string }> {
    try {
      const res = await fetch(this.baseUrl, { method: "HEAD" });
      return { ok: res.ok, note: `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, note: (err as Error).message };
    }
  }

  protected normalizePartial(partial: Partial<Listing> & { listingId: string; lotId: string }): Listing {
    return {
      source: this.id,
      auctionId: null,
      auctionUrl: "",
      sellerId: "",
      sellerLotId: [],
      region: "US",
      countryCode: "US",
      currency: "USD",
      siteAbb: this.id.toUpperCase().slice(0, 4),
      listingType: "AUCTION",
      pricingStrategy: "AUCTION",
      bidBasis: "PRICE",
      bidUnits: null,
      inventoryType: "PALLET",
      condition: [],
      categories: [],
      manifest: false,
      buyNow: false,
      pallets: null,
      units: null,
      ...partial,
    } as Listing;
  }
}
