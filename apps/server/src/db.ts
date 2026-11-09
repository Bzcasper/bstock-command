import { DatabaseSync } from "node:sqlite";
import type { AuctionState, BidRecord, Listing } from "@bstock/client";

export interface ListingRow {
  listing_id: string;
  lot_id: string;
  auction_id: string | null;
  ent_auction_id: string | null;
  site_abb: string;
  title: string | null;
  category: string | null;
  condition: string | null;
  pallets: number | null;
  units: number | null;
  retail_cents: number | null;
  currency: string;
  ends_at: string;
  starts_at: string | null;
  bids: number;
  current_cents: number | null;
  next_min_cents: number | null;
  buy_now_cents: number | null;
  manifest: number;
  listing_type: string;
  bid_basis: string;
  region: string | null;
  seller_city: string | null;
  problem_free: number | null;
  image_url: string | null;
  raw_json: string;
  first_seen: string;
  last_seen: string;
}

export interface MetricsRow {
  listing_id: string;
  score: number | null;
  projected_cents: number | null;
  roi: number | null;
  max_hammer_cents: number | null;
  cost_to_retail: number | null;
  cost_per_pallet_cents: number | null;
  bids_per_hour: number | null;
  unique_bidders: number | null;
  reasons: string | null;
  risks: string | null;
  computed_at: string;
}

export interface QueryFilters {
  q?: string;
  category?: string;
  site?: string;
  minScore?: number;
  minRoi?: number;
  endingWithinHours?: number;
  minPallets?: number;
  watchlistOnly?: boolean;
  sort?: "score" | "roi" | "ending" | "price" | "discount" | "bids";
  limit?: number;
  offset?: number;
}

export interface BidAttempt {
  id: number;
  at: string;
  listing_id: string;
  auction_id: string;
  amount_cents: number;
  mode: string;
  status: string;
  request_json: string | null;
  response_json: string | null;
  error: string | null;
  idempotency_key: string;
}

const SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS listings (
  listing_id TEXT PRIMARY KEY,
  lot_id TEXT NOT NULL,
  auction_id TEXT,
  ent_auction_id TEXT,
  site_abb TEXT NOT NULL,
  title TEXT,
  category TEXT,
  condition TEXT,
  pallets INTEGER,
  units INTEGER,
  retail_cents INTEGER,
  currency TEXT NOT NULL DEFAULT 'USD',
  ends_at TEXT NOT NULL,
  starts_at TEXT,
  bids INTEGER NOT NULL DEFAULT 0,
  current_cents INTEGER,
  next_min_cents INTEGER,
  buy_now_cents INTEGER,
  manifest INTEGER NOT NULL DEFAULT 0,
  listing_type TEXT NOT NULL DEFAULT 'SPOT',
  bid_basis TEXT NOT NULL DEFAULT 'PRICE',
  region TEXT,
  seller_city TEXT,
  problem_free REAL,
  image_url TEXT,
  raw_json TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_listings_ends ON listings(ends_at);
CREATE INDEX IF NOT EXISTS idx_listings_site ON listings(site_abb);

CREATE TABLE IF NOT EXISTS auction_state (
  auction_id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  next_min_cents INTEGER,
  current_cents INTEGER,
  bids INTEGER,
  unique_bidders INTEGER,
  closed INTEGER NOT NULL DEFAULT 0,
  canceled INTEGER NOT NULL DEFAULT 0,
  ends_at TEXT,
  bidding_enabled INTEGER,
  raw_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bid_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auction_id TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  unique_id TEXT NOT NULL,
  winning INTEGER NOT NULL DEFAULT 0,
  user_bid INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  seen_at TEXT NOT NULL,
  UNIQUE(auction_id, unique_id, created_at, amount_cents)
);
CREATE INDEX IF NOT EXISTS idx_bid_events_listing ON bid_events(listing_id, created_at);

CREATE TABLE IF NOT EXISTS metrics (
  listing_id TEXT PRIMARY KEY,
  score REAL,
  projected_cents INTEGER,
  roi REAL,
  max_hammer_cents INTEGER,
  cost_to_retail REAL,
  cost_per_pallet_cents INTEGER,
  bids_per_hour REAL,
  unique_bidders INTEGER,
  reasons TEXT,
  risks TEXT,
  computed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watchlist (
  listing_id TEXT PRIMARY KEY,
  note TEXT,
  added_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS decisions (
  listing_id TEXT PRIMARY KEY,
  recovery_pct REAL,
  target_roi REAL,
  target_max_cents INTEGER,
  notes TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bid_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  auction_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  request_json TEXT,
  response_json TEXT,
  error TEXT,
  idempotency_key TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS used_nonces (
  nonce TEXT PRIMARY KEY,
  used_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL,
  at TEXT NOT NULL,
  current_cents INTEGER,
  bids INTEGER,
  unique_bidders INTEGER,
  projected_cents INTEGER
);
CREATE INDEX IF NOT EXISTS idx_snapshots_listing ON snapshots(listing_id, at);
`;

const cents = (n: number | null | undefined): number | null =>
  n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 100);

export class Db {
  readonly raw: DatabaseSync;

  constructor(path: string) {
    this.raw = new DatabaseSync(path);
    this.raw.exec(SCHEMA);
  }

  close(): void {
    this.raw.close();
  }

  private run(sql: string, ...params: unknown[]): void {
    this.raw.prepare(sql).run(...(params as never[]));
  }

  private get<T>(sql: string, ...params: unknown[]): T | undefined {
    return this.raw.prepare(sql).get(...(params as never[])) as T | undefined;
  }

  private all<T>(sql: string, ...params: unknown[]): T[] {
    return this.raw.prepare(sql).all(...(params as never[])) as T[];
  }

  // ---------------------------------------------------------------- settings
  getSetting<T>(key: string, fallback: T): T {
    const row = this.get<{ value: string }>("SELECT value FROM settings WHERE key = ?", key);
    if (!row) return fallback;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return fallback;
    }
  }

  setSetting(key: string, value: unknown): void {
    this.run(
      "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key,
      JSON.stringify(value),
    );
  }

  deleteSetting(key: string): void {
    this.run("DELETE FROM settings WHERE key = ?", key);
  }

  // ---------------------------------------------------------------- listings
  upsertListing(listing: Listing, now: Date, entAuctionId?: string | null): void {
    const entId = entAuctionId ?? extractEntAuctionId(listing.auctionUrl);
    this.run(
      `INSERT INTO listings (
        listing_id, lot_id, auction_id, ent_auction_id, site_abb, title, category, condition, pallets, units,
        retail_cents, currency, ends_at, starts_at, bids, current_cents, next_min_cents, buy_now_cents,
        manifest, listing_type, bid_basis, region, seller_city, problem_free, image_url, raw_json,
        first_seen, last_seen
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(listing_id) DO UPDATE SET
        auction_id=excluded.auction_id, ent_auction_id=excluded.ent_auction_id, site_abb=excluded.site_abb,
        title=excluded.title, category=excluded.category, condition=excluded.condition,
        pallets=excluded.pallets, units=excluded.units, retail_cents=excluded.retail_cents,
        currency=excluded.currency, ends_at=excluded.ends_at, starts_at=excluded.starts_at,
        bids=excluded.bids, current_cents=COALESCE(excluded.current_cents, listings.current_cents),
        next_min_cents=excluded.next_min_cents, buy_now_cents=excluded.buy_now_cents,
        manifest=excluded.manifest, listing_type=excluded.listing_type, bid_basis=excluded.bid_basis,
        region=excluded.region, seller_city=excluded.seller_city, problem_free=excluded.problem_free,
        image_url=excluded.image_url, raw_json=excluded.raw_json, last_seen=excluded.last_seen`,
      listing.listingId,
      listing.lotId,
      listing.auctionId ?? null,
      entId,
      listing.siteAbb,
      listing.title ?? null,
      listing.categories?.[0] ?? null,
      listing.displayedCondition ?? listing.condition?.[0] ?? null,
      listing.palletCount ?? null,
      listing.units ?? null,
      cents(listing.retailPrice ?? null),
      listing.currency ?? "USD",
      listing.endTime,
      listing.biddingStartTime ?? listing.startTime ?? null,
      listing.numberOfBids ?? 0,
      cents(listing.winningBidAmount ?? listing.currentBid ?? null),
      cents(listing.nextMinBidAmount ?? null),
      cents(listing.buyNow ? (listing.unitRetail ?? null) : null),
      listing.manifest ? 1 : 0,
      listing.listingType ?? "SPOT",
      listing.bidBasis ?? "PRICE",
      listing.region ?? null,
      listing.sellerCity ?? null,
      listing.problemFreeOrderRate ?? null,
      listing.primaryImageUrl ?? null,
      JSON.stringify(listing),
      now.toISOString(),
      now.toISOString(),
    );
  }

  upsertAuction(state: AuctionState, now: Date): void {
    this.run(
      `INSERT INTO auction_state (auction_id, listing_id, next_min_cents, current_cents, bids, unique_bidders,
        closed, canceled, ends_at, bidding_enabled, raw_json, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(auction_id) DO UPDATE SET
         next_min_cents=excluded.next_min_cents,
         current_cents=COALESCE(excluded.current_cents, auction_state.current_cents),
         bids=excluded.bids, unique_bidders=COALESCE(excluded.unique_bidders, auction_state.unique_bidders),
         closed=excluded.closed, canceled=excluded.canceled, ends_at=excluded.ends_at,
         bidding_enabled=excluded.bidding_enabled, raw_json=excluded.raw_json, updated_at=excluded.updated_at`,
      state._id,
      state.listingId,
      cents(state.nextMinBidAmount ?? null),
      cents(state.winningBidAmount ?? null),
      state.numberOfBids ?? null,
      state.uniqueBidders ?? null,
      state.closed ? 1 : 0,
      state.canceled ? 1 : 0,
      state.actualEndTime,
      state.biddingEnabled ? 1 : 0,
      JSON.stringify(state),
      now.toISOString(),
    );
    // Keep the listing row's live figures authoritative.
    this.run(
      `UPDATE listings SET
         next_min_cents = COALESCE(?, next_min_cents),
         current_cents = COALESCE(?, current_cents),
         bids = COALESCE(?, bids),
         ends_at = COALESCE(?, ends_at),
         last_seen = ?
       WHERE listing_id = ?`,
      cents(state.nextMinBidAmount ?? null),
      cents(state.winningBidAmount ?? null),
      state.numberOfBids ?? null,
      state.actualEndTime ?? null,
      now.toISOString(),
      state.listingId,
    );
  }

  insertBidEvents(auctionId: string, listingId: string, bids: BidRecord[], now: Date): number {
    let added = 0;
    for (const b of bids) {
      const res = this.raw
        .prepare(
          `INSERT OR IGNORE INTO bid_events (auction_id, listing_id, amount_cents, unique_id, winning, user_bid, created_at, seen_at)
           VALUES (?,?,?,?,?,?,?,?)`,
        )
        .run(
          auctionId,
          listingId,
          cents(b.bidAmount) ?? 0,
          b.uniqueId,
          b.winning ? 1 : 0,
          b.userBid ? 1 : 0,
          b.createdAt,
          now.toISOString(),
        );
      added += Number(res.changes ?? 0);
    }
    return added;
  }

  listBidEvents(listingId: string, limit = 100): BidRecord[] {
    const rows = this.all<{
      amount_cents: number;
      unique_id: string;
      winning: number;
      user_bid: number;
      created_at: string;
    }>(
      `SELECT amount_cents, unique_id, winning, user_bid, created_at FROM bid_events
       WHERE listing_id = ? ORDER BY created_at DESC LIMIT ?`,
      listingId,
      limit,
    );
    return rows.map((r) => ({
      createdAt: r.created_at,
      bidAmount: r.amount_cents / 100,
      uniqueId: r.unique_id,
      winning: Boolean(r.winning),
      userBid: Boolean(r.user_bid),
      currency: "USD",
    }));
  }

  // ----------------------------------------------------------------- metrics
  upsertMetrics(m: MetricsRow): void {
    this.run(
      `INSERT INTO metrics (listing_id, score, projected_cents, roi, max_hammer_cents, cost_to_retail,
        cost_per_pallet_cents, bids_per_hour, unique_bidders, reasons, risks, computed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(listing_id) DO UPDATE SET
         score=excluded.score, projected_cents=excluded.projected_cents, roi=excluded.roi,
         max_hammer_cents=excluded.max_hammer_cents, cost_to_retail=excluded.cost_to_retail,
         cost_per_pallet_cents=excluded.cost_per_pallet_cents, bids_per_hour=excluded.bids_per_hour,
         unique_bidders=excluded.unique_bidders, reasons=excluded.reasons, risks=excluded.risks,
         computed_at=excluded.computed_at`,
      m.listing_id,
      m.score,
      m.projected_cents,
      m.roi,
      m.max_hammer_cents,
      m.cost_to_retail,
      m.cost_per_pallet_cents,
      m.bids_per_hour,
      m.unique_bidders,
      m.reasons,
      m.risks,
      m.computed_at,
    );
  }

  addSnapshot(s: { listingId: string; at: Date; currentCents: number | null; bids: number; uniqueBidders: number | null; projectedCents: number | null }): void {
    this.run(
      `INSERT INTO snapshots (listing_id, at, current_cents, bids, unique_bidders, projected_cents) VALUES (?,?,?,?,?,?)`,
      s.listingId,
      s.at.toISOString(),
      s.currentCents,
      s.bids,
      s.uniqueBidders,
      s.projectedCents,
    );
  }

  // ------------------------------------------------------------------ queries
  queryListings(f: QueryFilters = {}): Array<ListingRow & MetricsRow & { watched: number; note: string | null }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (f.q) {
      where.push("(l.title LIKE ? OR l.site_abb LIKE ? OR l.region LIKE ? OR l.lot_id LIKE ?)");
      const like = `%${f.q}%`;
      params.push(like, like, like, like);
    }
    if (f.category) {
      where.push("l.category = ?");
      params.push(f.category);
    }
    if (f.site) {
      where.push("l.site_abb = ?");
      params.push(f.site);
    }
    if (f.minScore !== undefined) {
      where.push("COALESCE(m.score, 0) >= ?");
      params.push(f.minScore);
    }
    if (f.minRoi !== undefined) {
      where.push("COALESCE(m.roi, -99) >= ?");
      params.push(f.minRoi);
    }
    if (f.endingWithinHours !== undefined) {
      where.push("l.ends_at <= datetime('now', ?)");
      params.push(`+${f.endingWithinHours} hours`);
    }
    if (f.minPallets !== undefined) {
      where.push("COALESCE(l.pallets, 0) >= ?");
      params.push(f.minPallets);
    }
    if (f.watchlistOnly) where.push("w.listing_id IS NOT NULL");

    const order: Record<string, string> = {
      score: "COALESCE(m.score,0) DESC",
      roi: "COALESCE(m.roi,-99) DESC",
      ending: "l.ends_at ASC",
      price: "COALESCE(l.current_cents, l.next_min_cents, 0) ASC",
      discount: "COALESCE(m.cost_to_retail, 99) ASC",
      bids: "l.bids ASC",
    };
    const sql = `
      SELECT l.*, m.score, m.projected_cents, m.roi, m.max_hammer_cents, m.cost_to_retail,
             m.cost_per_pallet_cents, m.bids_per_hour, m.unique_bidders, m.reasons, m.risks, m.computed_at,
             CASE WHEN w.listing_id IS NULL THEN 0 ELSE 1 END AS watched, w.note
      FROM listings l
      LEFT JOIN metrics m ON m.listing_id = l.listing_id
      LEFT JOIN watchlist w ON w.listing_id = l.listing_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY ${order[f.sort ?? "score"]}
      LIMIT ? OFFSET ?`;
    params.push(f.limit ?? 100, f.offset ?? 0);
    return this.all(sql, ...params);
  }

  getListing(listingId: string): (ListingRow & Partial<MetricsRow>) | undefined {
    return this.get(
      `SELECT l.*, m.score, m.projected_cents, m.roi, m.max_hammer_cents, m.cost_to_retail,
              m.cost_per_pallet_cents, m.bids_per_hour, m.unique_bidders, m.reasons, m.risks, m.computed_at
       FROM listings l LEFT JOIN metrics m ON m.listing_id = l.listing_id WHERE l.listing_id = ?`,
      listingId,
    );
  }

  getAuctionForListing(listingId: string): AuctionState | undefined {
    const row = this.get<{ raw_json: string }>(
      "SELECT raw_json FROM auction_state WHERE listing_id = ? ORDER BY updated_at DESC LIMIT 1",
      listingId,
    );
    return row ? (JSON.parse(row.raw_json) as AuctionState) : undefined;
  }

  categories(): Array<{ category: string; count: number }> {
    return this.all("SELECT COALESCE(category,'Uncategorised') AS category, COUNT(*) AS count FROM listings GROUP BY category ORDER BY count DESC");
  }

  sites(): Array<{ site_abb: string; count: number }> {
    return this.all("SELECT site_abb, COUNT(*) AS count FROM listings GROUP BY site_abb ORDER BY count DESC");
  }

  // --------------------------------------------------------------- watchlist
  watch(listingId: string, note: string | null, now: Date): void {
    this.run(
      "INSERT INTO watchlist(listing_id, note, added_at) VALUES (?,?,?) ON CONFLICT(listing_id) DO UPDATE SET note = excluded.note",
      listingId,
      note,
      now.toISOString(),
    );
  }

  unwatch(listingId: string): void {
    this.run("DELETE FROM watchlist WHERE listing_id = ?", listingId);
  }

  listWatchlist(): Array<{ listing_id: string; note: string | null; added_at: string }> {
    return this.all("SELECT listing_id, note, added_at FROM watchlist ORDER BY added_at DESC");
  }

  // --------------------------------------------------------------- decisions
  getDecision(listingId: string): { recovery_pct: number | null; target_roi: number | null; target_max_cents: number | null; notes: string | null } | undefined {
    return this.get("SELECT recovery_pct, target_roi, target_max_cents, notes FROM decisions WHERE listing_id = ?", listingId);
  }

  setDecision(
    listingId: string,
    d: { recoveryPct?: number | null; targetRoi?: number | null; targetMaxCents?: number | null; notes?: string | null },
    now: Date,
  ): void {
    this.run(
      `INSERT INTO decisions (listing_id, recovery_pct, target_roi, target_max_cents, notes, updated_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(listing_id) DO UPDATE SET
         recovery_pct=excluded.recovery_pct, target_roi=excluded.target_roi,
         target_max_cents=excluded.target_max_cents, notes=excluded.notes, updated_at=excluded.updated_at`,
      listingId,
      d.recoveryPct ?? null,
      d.targetRoi ?? null,
      d.targetMaxCents ?? null,
      d.notes ?? null,
      now.toISOString(),
    );
  }

  // ------------------------------------------------------------ bid attempts
  recordBidAttempt(a: {
    at: Date;
    listingId: string;
    auctionId: string;
    amountCents: number;
    mode: string;
    status: string;
    request?: unknown;
    response?: unknown;
    error?: string | null;
    idempotencyKey: string;
  }): void {
    this.run(
      `INSERT INTO bid_attempts (at, listing_id, auction_id, amount_cents, mode, status, request_json, response_json, error, idempotency_key)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      a.at.toISOString(),
      a.listingId,
      a.auctionId,
      a.amountCents,
      a.mode,
      a.status,
      a.request === undefined ? null : JSON.stringify(a.request),
      a.response === undefined ? null : JSON.stringify(a.response),
      a.error ?? null,
      a.idempotencyKey,
    );
  }

  listBidAttempts(limit = 50): BidAttempt[] {
    return this.all<BidAttempt>("SELECT * FROM bid_attempts ORDER BY id DESC LIMIT ?", limit);
  }

  findBidAttempt(idempotencyKey: string): BidAttempt | undefined {
    return this.get<BidAttempt>("SELECT * FROM bid_attempts WHERE idempotency_key = ?", idempotencyKey);
  }

  dailyExposureCents(dayStartIso: string): number {
    const row = this.get<{ total: number | null }>(
      "SELECT SUM(amount_cents) AS total FROM bid_attempts WHERE at >= ? AND status IN ('placed','dry-run')",
      dayStartIso,
    );
    return row?.total ?? 0;
  }

  // ------------------------------------------------------------------ nonces
  useNonce(nonce: string, now: Date): boolean {
    const res = this.raw
      .prepare("INSERT OR IGNORE INTO used_nonces(nonce, used_at) VALUES (?,?)")
      .run(nonce, now.toISOString());
    return Number(res.changes ?? 0) === 1;
  }

  isNonceFree(nonce: string): boolean {
    const row = this.get<{ nonce: string }>("SELECT nonce FROM used_nonces WHERE nonce = ?", nonce);
    return !row;
  }

  // ------------------------------------------------------------------ counts
  stats(): { listings: number; metrics: number; bids: number; attempts: number; watched: number } {
    const one = (sql: string) => this.get<{ c: number }>(sql)?.c ?? 0;
    return {
      listings: one("SELECT COUNT(*) AS c FROM listings"),
      metrics: one("SELECT COUNT(*) AS c FROM metrics"),
      bids: one("SELECT COUNT(*) AS c FROM bid_events"),
      attempts: one("SELECT COUNT(*) AS c FROM bid_attempts"),
      watched: one("SELECT COUNT(*) AS c FROM watchlist"),
    };
  }

  pruneSnapshots(keepDays = 30): void {
    this.run("DELETE FROM snapshots WHERE at < datetime('now', ?)", `-${keepDays} days`);
  }
}

/** A2Z/enterprise listings publish the numeric auction id inside the legacy URL. */
export function extractEntAuctionId(auctionUrl: string | null | undefined): string | null {
  if (!auctionUrl) return null;
  const m = /\/auction\/view\/id\/(\d+)/i.exec(auctionUrl);
  return m ? m[1] : null;
}
