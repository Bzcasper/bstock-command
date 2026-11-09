import { BaseAdapter } from "./base.ts";
import type { Listing, SearchRequest } from "@bstock/client";

/**
 * Liquidation.com adapter.
 * Liquidation.com exposes a JSON search endpoint used by their storefront.
 * We hit it with a POST and normalize the returned lots.
 */
export class LiquidationComAdapter extends BaseAdapter {
  readonly id = "liquidation-com";
  readonly label = "Liquidation.com";
  readonly baseUrl = "https://www.liquidation.com";

  async searchListings(body: SearchRequest): Promise<{ listings: Listing[]; total: number }> {
    return this.safe(async () => {
      const res = await fetch(`${this.baseUrl}/api/v2/lots/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          query: body.q ?? "",
          category: body.category,
          condition: body.condition,
          limit: body.limit ?? 40,
          offset: body.offset ?? 0,
          sort: body.sortBy ?? "endTime",
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { lots?: any[]; total?: number; results?: any[] };
      const raw = data.lots ?? data.results ?? [];
      const listings = raw.map((r: any) =>
        this.normalizePartial({
          listingId: String(r.id ?? r.lotId ?? r.lot_id),
          lotId: String(r.id ?? r.lotId ?? r.lot_id),
          title: r.title ?? r.name,
          category: r.category ?? r.categoryName,
          condition: Array.isArray(r.condition) ? r.condition : r.condition ? [r.condition] : [],
          pallets: r.pallets ?? r.palletCount ?? null,
          units: r.units ?? r.quantity ?? null,
          retail: r.retailValue ?? r.msrp ?? null,
          currentBid: r.currentBid ?? r.currentPrice ?? null,
          nextMinBid: r.nextBid ?? r.minimumBid ?? null,
          endsAt: r.endTime ?? r.auctionEnd ?? new Date(Date.now() + 86400000).toISOString(),
          bids: r.bidCount ?? r.numberOfBids ?? 0,
          manifest: Boolean(r.manifest ?? r.hasManifest),
          siteAbb: (r.retailer ?? r.storefront ?? "LIQ").toString().toUpperCase().slice(0, 4),
          region: r.location ?? r.region ?? "US",
          auctionUrl: r.url ?? `${this.baseUrl}/lot/${r.id}`,
        }),
      );
      return { listings, total: data.total ?? listings.length };
    }, { listings: [], total: 0 });
  }
}
