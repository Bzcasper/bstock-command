/**
 * Common contract for every pallet-liquidation marketplace we integrate with.
 * Each adapter normalizes its source into the shared Listing / AuctionState shapes
 * so the collector, scoring, and UI stay marketplace-agnostic.
 */
import type { Listing, SearchRequest, AuctionState, AuctionBidsResponse } from "@bstock/client";

export interface MarketplaceAdapter {
  /** Stable identifier, e.g. "bstock", "liquidation-com", "bulq". */
  readonly id: string;
  /** Human label shown in the UI. */
  readonly label: string;
  /** Base URL of the marketplace. */
  readonly baseUrl: string;
  /** Whether the adapter can run without credentials (public listings). */
  readonly public: boolean;

  /** Fetch a page of listings. */
  searchListings(body: SearchRequest): Promise<{ listings: Listing[]; total: number }>;

  /** Fetch auction state for the given listing ids (best-effort). */
  getAuctions(listingIds: string[]): Promise<AuctionState[]>;

  /** Fetch bid history for one auction (best-effort). */
  getAuctionBids(auctionId: string, opts?: { limit?: number }): Promise<AuctionBidsResponse>;

  /** Place a bid. Returns the raw response. */
  placeBid(auctionId: string, amount: number, extra?: Record<string, unknown>): Promise<unknown>;

  /** Probe connectivity/auth status. */
  probe(): Promise<{ ok: boolean; note?: string }>;
}

export interface AdapterRegistry {
  adapters: MarketplaceAdapter[];
  get(id: string): MarketplaceAdapter | undefined;
  all(): MarketplaceAdapter[];
}
