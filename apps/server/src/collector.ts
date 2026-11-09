import { EventEmitter } from "node:events";
import type { BStockClient } from "@bstock/client";
import type { Listing, SearchRequest } from "@bstock/client";
import {
  bidVelocity,
  dealEconomics,
  maxHammerForRoi,
  projectFinalPrice,
  scoreAuction,
  evaluateListingFunnel,
  type FunnelEvaluation,
  type CostModel,
} from "@bstock/analytics";
import type { Db, ListingRow, MetricsRow } from "./db.ts";
import { extractEntAuctionId } from "./db.ts";

export interface TradingSettings {
  mode: "off" | "dry-run" | "live";
  /** Absolute cap per bid, dollars. Also the ceiling for any plan. */
  perBidCap: number;
  /** Rolling-day committed capital cap, dollars. */
  dailyCap: number;
  /** Empty = every storefront allowed. */
  allowedSites: string[];
  blockedCategories: string[];
  requireManifest: boolean;
  minScore: number;
  /** Minimum ROI used for the "max bid" number and for gating. */
  minRoi: number;
  recoveryPctDefault: number;
  targetRoiDefault: number;
  buyerPremiumPct: number;
  taxPct: number;
  shippingDefault: number;
  otherFeesDefault: number;
}

export const DEFAULT_SETTINGS: TradingSettings = {
  mode: "dry-run",
  perBidCap: 10_000,
  dailyCap: 40_000,
  allowedSites: [],
  blockedCategories: [],
  requireManifest: false,
  minScore: 0,
  minRoi: 0.15,
  recoveryPctDefault: 0.4,
  targetRoiDefault: 0.3,
  buyerPremiumPct: 0.125,
  taxPct: 0,
  shippingDefault: 0,
  otherFeesDefault: 0,
};

export function costModelFrom(settings: TradingSettings): CostModel {
  return {
    buyerPremiumPct: settings.buyerPremiumPct,
    shipping: settings.shippingDefault,
    taxPct: settings.taxPct,
    otherFees: settings.otherFeesDefault,
  };
}

export interface SyncOptions {
  pages?: number;
  pageSize?: number;
  sortBy?: SearchRequest["sortBy"];
  sortOrder?: SearchRequest["sortOrder"];
  request?: SearchRequest;
  /** Fetch full bid history for the N listings closest to closing. */
  withBidsFor?: number;
  /** Refresh auction state for listings already known. */
  includeKnown?: boolean;
}

export interface SyncReport {
  startedAt: string;
  finishedAt: string;
  pagesFetched: number;
  listingsSeen: number;
  listingsUpserted: number;
  auctionsFetched: number;
  entAuctionsFetched: number;
  bidHistoriesFetched: number;
  bidEventsAdded: number;
  metricsComputed: number;
  errors: string[];
}

const pageSignature = (l: Listing) => l.listingId;

import type { MarketplaceAdapter } from "./adapters/types.ts";

export class Collector {
  readonly events = new EventEmitter();
  private syncing = false;
  private readonly client: BStockClient;
  private readonly adapters: MarketplaceAdapter[];
  private readonly db: Db;
  private readonly settings: () => TradingSettings;
  private readonly now: () => Date;

  constructor(
    client: BStockClient,
    db: Db,
    settings: () => TradingSettings,
    now: () => Date = () => new Date(),
    adapters?: MarketplaceAdapter[],
  ) {
    this.client = client;
    this.db = db;
    this.settings = settings;
    this.now = now;
    this.adapters = adapters ?? [];
  }

  get busy(): boolean {
    return this.syncing;
  }

  async sync(options: SyncOptions = {}): Promise<SyncReport> {
    if (this.syncing) throw new Error("sync already running");
    this.syncing = true;
    const started = this.now();
    const report: SyncReport = {
      startedAt: started.toISOString(),
      finishedAt: started.toISOString(),
      pagesFetched: 0,
      listingsSeen: 0,
      listingsUpserted: 0,
      auctionsFetched: 0,
      entAuctionsFetched: 0,
      bidHistoriesFetched: 0,
      bidEventsAdded: 0,
      metricsComputed: 0,
      errors: [],
    };

    this.events.emit("sync:start", { at: started.toISOString() });

    try {
      const pages = Math.max(1, Math.min(20, options.pages ?? 3));
      const pageSize = Math.max(20, Math.min(80, options.pageSize ?? 80));
      const seen = new Map<string, Listing>();

      // If adapters are registered, use them; otherwise fall back to the single B-Stock client.
      const sources = this.adapters.length > 0 ? this.adapters : null;

      if (sources) {
        for (const adapter of sources) {
          for (let page = 0; page < pages; page += 1) {
            try {
              const body: SearchRequest = {
                limit: pageSize,
                offset: page * pageSize,
                sortBy: options.sortBy ?? "endTime",
                sortOrder: options.sortOrder ?? "asc",
                ...options.request,
              };
              const res = await adapter.searchListings(body);
              report.pagesFetched += 1;
              const listings = res.listings ?? [];
              for (const l of listings) {
                const key = `${adapter.id}:${pageSignature(l)}`;
                if (!seen.has(key)) seen.set(key, l);
              }
              if (listings.length < pageSize) break;
            } catch (err) {
              report.errors.push(`${adapter.id}: ${(err as Error).message}`);
              break;
            }
          }
        }
      } else {
        for (let page = 0; page < pages; page += 1) {
          const body: SearchRequest = {
            limit: pageSize,
            offset: page * pageSize,
            sortBy: options.sortBy ?? "endTime",
            sortOrder: options.sortOrder ?? "asc",
            ...options.request,
          };
          const res = await this.client.searchListings(body);
          report.pagesFetched += 1;
          const listings = res.listings ?? [];
          for (const l of listings) {
            if (!seen.has(pageSignature(l))) seen.set(pageSignature(l), l);
          }
          if (listings.length < pageSize) break;
        }
      }

      report.listingsSeen = seen.size;
      const now = this.now();
      for (const listing of seen.values()) {
        this.db.upsertListing(listing, now);
        report.listingsUpserted += 1;
      }

      const all = [...seen.values()].filter((l) => l.auctionId);
      for (let i = 0; i < all.length; i += 100) {
        const batch = all.slice(i, i + 100);
        const states = await this.client.getAuctions(batch.map((l) => l.listingId));
        report.auctionsFetched += states.length;
        for (const state of states) this.db.upsertAuction(state, now);
      }

      const ent = [...seen.values()].filter((l) => !l.auctionId && extractEntAuctionId(l.auctionUrl));
      if (ent.length > 0) {
        const ids = ent.map((l) => extractEntAuctionId(l.auctionUrl)!).filter(Boolean);
        const rows = await this.client.getEntAuctions(ids);
        report.entAuctionsFetched += rows.length;
        for (const row of rows) {
          const listing = ent.find((l) => extractEntAuctionId(l.auctionUrl) === String(row.auctionId));
          if (!listing) continue;
          this.db.upsertAuction(
            {
              _id: String(row.auctionId),
              listingId: listing.listingId,
              actualEndTime: row.endTime,
              biddingEnabled: !row.closed && !row.canceled,
              buyingFormatSequence: "AUCTION",
              startPrice: row.startPrice,
              closed: row.closed,
              canceled: row.canceled,
              nextMinBidAmount: (row.winningBidAmount ?? row.startPrice) + 1,
              bidPrecision: 1,
              winningBidAmount: row.winningBidAmount,
              numberOfBids: row.numberOfBids,
            },
            now,
          );
        }
      }

      const withBids = Math.max(0, Math.min(200, options.withBidsFor ?? 25));
      if (withBids > 0) {
        const targets = this.db
          .queryListings({ sort: "ending", limit: withBids })
          .filter((r) => r.auction_id);
        for (const row of targets) {
          try {
            const auctionId = row.auction_id!;
            const bids = await this.client.getAuctionBids(auctionId, { limit: 100 });
            report.bidHistoriesFetched += 1;
            report.bidEventsAdded += this.db.insertBidEvents(auctionId, row.listing_id, bids.bids ?? [], now);
            if (bids.uniqueBidders !== undefined) {
              const state = this.db.getAuctionForListing(row.listing_id);
              if (state) {
                state.uniqueBidders = bids.uniqueBidders;
                state.numberOfBids = bids.numberOfBids ?? state.numberOfBids;
                this.db.upsertAuction(state, now);
              }
            }
          } catch (err) {
            report.errors.push(`${row.listing_id}: ${(err as Error).message}`);
          }
        }
      }

      report.metricsComputed = this.recompute();
      report.finishedAt = this.now().toISOString();
      this.events.emit("sync:done", report);
      return report;
    } catch (err) {
      report.errors.push((err as Error).message);
      report.finishedAt = this.now().toISOString();
      this.events.emit("sync:error", report);
      throw err;
    } finally {
      this.syncing = false;
    }
  }

  /** Recompute score/economics for every stored listing. Cheap; no network. */
  recompute(): number {
    const settings = this.settings();
    const cost = costModelFrom(settings);
    const now = this.now();
    const rows = this.db.queryListings({ limit: 5000 });
    let count = 0;

    for (const row of rows) {
      const listing = JSON.parse(row.raw_json) as Listing;
      const bids = this.db.listBidEvents(row.listing_id, 200);
      const velocity = bidVelocity(bids, now);
      const current = (row.current_cents ?? row.next_min_cents ?? 0) / 100;
      const decision = this.db.getDecision(row.listing_id);
      const recoveryPct = decision?.recovery_pct ?? settings.recoveryPctDefault;
      const targetRoi = decision?.target_roi ?? settings.targetRoiDefault;

      const projected = projectFinalPrice({
        currentBid: current,
        startPrice: (this.db.getAuctionForListing(row.listing_id)?.startPrice ?? current) || current,
        bids: row.bids ?? 0,
        endsAt: row.ends_at,
        now,
        retail: row.retail_cents ? row.retail_cents / 100 : null,
        startedAt: row.starts_at,
      });

      const economics = dealEconomics({
        hammer: current,
        retail: row.retail_cents ? row.retail_cents / 100 : null,
        units: row.units,
        pallets: row.pallets,
        recoveryPct,
        cost,
      });

      const scored = scoreAuction({
        listing: {
          listingId: row.listing_id,
          retailPrice: row.retail_cents ? row.retail_cents / 100 : null,
          units: row.units,
          palletCount: row.pallets,
          numberOfBids: row.bids,
          endTime: row.ends_at,
          problemFreeOrderRate: row.problem_free,
          manifest: Boolean(row.manifest),
          listingType: row.listing_type as Listing["listingType"],
          bidBasis: row.bid_basis as Listing["bidBasis"],
          siteAbb: row.site_abb,
          title: row.title ?? "",
          condition: row.condition ? [row.condition] : [],
        },
        economics,
        velocity,
        projected,
        now,
        costModel: cost,
      });

      const funnel = evaluateListingFunnel(
        {
          ...listing,
          bidsHistory: bids,
        },
        {
          minRoi: settings.minRoi,
          targetRoiDefault: targetRoi,
          recoveryPctDefault: recoveryPct,
          requireManifest: settings.requireManifest,
          cost,
        },
        now,
      );

      const maxHammer = maxHammerForRoi(
        { retail: row.retail_cents ? row.retail_cents / 100 : null, recoveryPct, targetRoi, cost },
        current,
      );

      // Merge standard reasons with advanced mathematical reasons
      const mergedReasons = Array.from(new Set([...scored.reasons, ...funnel.reasons]));
      const mergedRisks = Array.from(new Set([...scored.risks, ...funnel.risks]));

      this.db.upsertMetrics({
        listing_id: row.listing_id,
        score: funnel.score,
        projected_cents: Math.round(projected.projected * 100),
        roi: funnel.algebraic.expectedRoi,
        max_hammer_cents: Math.round(funnel.algebraic.maxHammer * 100),
        cost_to_retail: funnel.algebraic.costToRetail,
        cost_per_pallet_cents: funnel.density.costPerPallet ? Math.round(funnel.density.costPerPallet * 100) : null,
        bids_per_hour: velocity.bidsPerHour,
        unique_bidders: velocity.uniqueBidders,
        funnel_stage: funnel.stage,
        opportunity_tier: funnel.tier,
        algebraic_json: JSON.stringify(funnel.algebraic),
        density_json: JSON.stringify(funnel.density),
        pattern_json: JSON.stringify(funnel.pattern),
        recommended_bid_cents: Math.round(funnel.recommendedBid * 100),
        kelly_fraction: funnel.kellyFraction,
        reasons: JSON.stringify(mergedReasons),
        risks: JSON.stringify(mergedRisks),
        computed_at: now.toISOString(),
      });
      this.db.addSnapshot({
        listingId: row.listing_id,
        at: now,
        currentCents: row.current_cents,
        bids: row.bids,
        uniqueBidders: velocity.uniqueBidders,
        projectedCents: Math.round(projected.projected * 100),
      });
      count += 1;
    }
    return count;
  }

  /** Detail for one listing: metrics, bid curve, economics, guard preview. */
  listingDetail(listingId: string): ListingDetail | undefined {
    const row = this.db.getListing(listingId);
    if (!row) return undefined;
    const settings = this.settings();
    const cost = costModelFrom(settings);
    const now = this.now();
    const listing = JSON.parse(row.raw_json) as Listing;
    const decision = this.db.getDecision(listingId);
    const recoveryPct = decision?.recovery_pct ?? settings.recoveryPctDefault;
    const targetRoi = decision?.target_roi ?? settings.targetRoiDefault;
    const bids = this.db.listBidEvents(listingId, 200);
    const velocity = bidVelocity(bids, now);
    const current = (row.current_cents ?? row.next_min_cents ?? 0) / 100;
    const economics = dealEconomics({
      hammer: current,
      retail: row.retail_cents ? row.retail_cents / 100 : null,
      units: row.units,
      pallets: row.pallets,
      recoveryPct,
      cost,
    });
    const projected = projectFinalPrice({
      currentBid: current,
      startPrice: this.db.getAuctionForListing(listingId)?.startPrice ?? current,
      bids: row.bids ?? 0,
      endsAt: row.ends_at,
      now,
      retail: row.retail_cents ? row.retail_cents / 100 : null,
      startedAt: row.starts_at,
    });
    const maxHammer = maxHammerForRoi(
      { retail: row.retail_cents ? row.retail_cents / 100 : null, recoveryPct, targetRoi, cost },
      current,
    );
    const funnel = evaluateListingFunnel(
      {
        ...listing,
        bidsHistory: bids,
      },
      {
        minRoi: settings.minRoi,
        targetRoiDefault: targetRoi,
        recoveryPctDefault: recoveryPct,
        requireManifest: settings.requireManifest,
        cost,
      },
      now,
    );
    return {
      listing,
      row,
      auction: this.db.getAuctionForListing(listingId) ?? null,
      bids,
      velocity,
      economics,
      projected,
      maxHammer,
      targetRoi,
      recoveryPct,
      funnel,
      decision: decision ?? null,
      snapshots: this.db.raw
        .prepare("SELECT at, current_cents, bids, unique_bidders, projected_cents FROM snapshots WHERE listing_id = ? ORDER BY at ASC LIMIT 500")
        .all(listingId) as unknown as ListingDetail["snapshots"],
    };
  }
}

export interface ListingDetail {
  listing: Listing;
  row: ListingRow;
  auction: ReturnType<Db["getAuctionForListing"]> | null;
  bids: ReturnType<Db["listBidEvents"]>;
  velocity: ReturnType<typeof bidVelocity>;
  economics: ReturnType<typeof dealEconomics>;
  projected: ReturnType<typeof projectFinalPrice>;
  maxHammer: number;
  targetRoi: number;
  recoveryPct: number;
  funnel?: FunnelEvaluation;
  decision: NonNullable<ReturnType<Db["getDecision"]>> | null;
  snapshots: Array<{
    at: string;
    current_cents: number | null;
    bids: number | null;
    unique_bidders: number | null;
    projected_cents: number | null;
  }>;
}

export type { MetricsRow };
