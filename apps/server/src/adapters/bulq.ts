import { BaseAdapter } from "./base.ts";
import type { Listing, SearchRequest } from "@bstock/client";

/**
 * BULQ adapter. BULQ publishes a JSON search API used by their storefront.
 */
export class BulqAdapter extends BaseAdapter {
  readonly id = "bulq";
  readonly label = "BULQ";
  readonly baseUrl = "https://www.bulq.com";

  async searchListings(body: SearchRequest): Promise<{ listings: Listing[]; total: number }> {
    return this.safe(async () => {
      const params = new URLSearchParams();
      params.set("limit", String(body.limit ?? 40));
      params.set("offset", String(body.offset ?? 0));
      if (body.q) params.set("q", body.q);
      if (body.category) params.set("category", Array.isArray(body.category) ? body.category.join(",") : body.category);
      if (body.condition?.length) params.set("condition", body.condition.join(","));
      const res = await fetch(`${this.baseUrl}/api/lots?${params.toString()}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { lots?: any[]; total?: number; results?: any[] };
      const raw = data.lots ?? data.results ?? [];
      const listings = raw.map((r: any) =>
        this.normalizePartial({
          listingId: String(r.id ?? r.lot_id),
          lotId: String(r.id ?? r.lot_id),
          title: r.title ?? r.name,
          category: r.category ?? r.categoryName,
          condition: Array.isArray(r.condition) ? r.condition : r.condition ? [r.condition] : [],
          pallets: r.pallets ?? r.pallet_count ?? null,
          units: r.units ?? r.quantity ?? null,
          retail: r.retail_value ?? r.msrp ?? null,
          currentBid: r.price ?? r.current_price ?? null,
          nextMinBid: r.next_bid ?? null,
          endsAt: r.end_time ?? r.auction_end ?? new Date(Date.now() + 86400000).toISOString(),
          bids: r.bid_count ?? 0,
          manifest: Boolean(r.manifest ?? r.has_manifest),
          siteAbb: (r.retailer ?? r.storefront ?? "BULQ").toString().toUpperCase().slice(0, 4),
          region: r.location ?? r.region ?? "US",
          auctionUrl: r.url ?? `${this.baseUrl}/lot/${r.id}`,
        }),
      );
      return { listings, total: data.total ?? listings.length };
    }, { listings: [], total: 0 });
  }
}
