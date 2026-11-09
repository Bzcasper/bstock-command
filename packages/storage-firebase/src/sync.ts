import type { Db } from "../../../apps/server/src/db.ts";
import type { FirebaseStorageService } from "./service.ts";
import type { StorageSyncReport } from "./types.ts";

export async function pushDbToFirebase(
  db: Db,
  service: FirebaseStorageService,
  dbPath?: string,
): Promise<StorageSyncReport> {
  const report: StorageSyncReport = {
    listingsSynced: 0,
    watchlistSynced: 0,
    decisionsSynced: 0,
    dbBackedUp: false,
    dbRestored: false,
    snapshotUploaded: false,
    errors: [],
  };

  if (!service.init()) {
    report.errors.push("Firebase is not initialized or disabled");
    return report;
  }

  // 1. Sync listings to Firestore
  try {
    const rows = db.queryListings({ limit: 5000 });
    const payload = rows.map((r) => ({
      listingId: r.listing_id,
      lotId: r.lot_id,
      auctionId: r.auction_id,
      entAuctionId: r.ent_auction_id,
      site: r.site_abb,
      title: r.title,
      category: r.category,
      condition: r.condition,
      pallets: r.pallets,
      units: r.units,
      retail: r.retail_cents === null ? null : r.retail_cents / 100,
      currency: r.currency,
      endsAt: r.ends_at,
      startsAt: r.starts_at,
      bids: r.bids,
      currentBid: r.current_cents === null ? null : r.current_cents / 100,
      nextMinBid: r.next_min_cents === null ? null : r.next_min_cents / 100,
      manifest: Boolean(r.manifest),
      listingType: r.listing_type,
      bidBasis: r.bid_basis,
      region: r.region,
      sellerCity: r.seller_city,
      problemFree: r.problem_free,
      imageUrl: r.image_url,
      score: r.score,
      projected: r.projected_cents === null ? null : r.projected_cents / 100,
      roi: r.roi,
      maxHammer: r.max_hammer_cents === null ? null : r.max_hammer_cents / 100,
      costToRetail: r.cost_to_retail,
      costPerPallet: r.cost_per_pallet_cents === null ? null : r.cost_per_pallet_cents / 100,
      bidsPerHour: r.bids_per_hour,
      uniqueBidders: r.unique_bidders,
      reasons: r.reasons ? JSON.parse(r.reasons) : [],
      risks: r.risks ? JSON.parse(r.risks) : [],
      watched: Boolean(r.watched),
      note: r.note,
      computedAt: r.computed_at,
    }));

    const lRes = await service.syncListingsToFirestore(payload);
    report.listingsSynced = lRes.count;
    if (lRes.error) report.errors.push("Firestore listings sync: " + lRes.error);

    // Also upload static JSON snapshot to Cloud Storage
    const snapshot = {
      count: payload.length,
      listings: payload,
      facets: { categories: db.categories(), sites: db.sites() },
      updatedAt: new Date().toISOString(),
    };
    const snapRes = await service.uploadJson(snapshot, "data/listings.json");
    if (snapRes.success) {
      report.snapshotUploaded = true;
      report.listingsUrl = snapRes.publicUrl;
    } else if (snapRes.error) {
      report.errors.push("Storage listings.json upload: " + snapRes.error);
    }
  } catch (err) {
    report.errors.push("Listings sync failed: " + (err as Error).message);
  }

  // 2. Sync watchlist to Firestore
  try {
    const watchlist = db.listWatchlist();
    const wRes = await service.syncWatchlistToFirestore(watchlist);
    report.watchlistSynced = wRes.count;
    if (wRes.error) report.errors.push("Firestore watchlist sync: " + wRes.error);
  } catch (err) {
    report.errors.push("Watchlist sync failed: " + (err as Error).message);
  }

  // 3. Sync decisions to Firestore
  try {
    const rows = db.queryListings({ limit: 5000 });
    const decisions: Array<{
      listing_id: string;
      recovery_pct?: number | null;
      target_roi?: number | null;
      target_max_cents?: number | null;
      notes?: string | null;
      updated_at?: string;
    }> = [];

    for (const r of rows) {
      const d = db.getDecision(r.listing_id);
      if (d) {
        decisions.push({
          listing_id: r.listing_id,
          recovery_pct: d.recovery_pct,
          target_roi: d.target_roi,
          target_max_cents: d.target_max_cents,
          notes: d.notes,
        });
      }
    }

    if (decisions.length > 0) {
      const dRes = await service.syncDecisionsToFirestore(decisions);
      report.decisionsSynced = dRes.count;
      if (dRes.error) report.errors.push("Firestore decisions sync: " + dRes.error);
    }
  } catch (err) {
    report.errors.push("Decisions sync failed: " + (err as Error).message);
  }

  // 4. Back up SQLite database file to Firebase Cloud Storage
  if (dbPath) {
    try {
      const bRes = await service.backupDatabase(dbPath);
      report.dbBackedUp = bRes.success;
      if (!bRes.success && bRes.error) {
        report.errors.push("Database backup failed: " + bRes.error);
      }
    } catch (err) {
      report.errors.push("Database backup exception: " + (err as Error).message);
    }
  }

  return report;
}

export async function pullFirebaseToLocalDb(
  db: Db,
  service: FirebaseStorageService,
  dbPath?: string,
): Promise<{ watchlistPulled: number; decisionsPulled: number; dbRestored: boolean; errors: string[] }> {
  const result = {
    watchlistPulled: 0,
    decisionsPulled: 0,
    dbRestored: false,
    errors: [] as string[],
  };

  if (!service.init()) {
    result.errors.push("Firebase not initialized");
    return result;
  }

  // 1. Try to restore DB file if local dbPath is provided and currently empty
  if (dbPath) {
    try {
      const rRes = await service.restoreDatabase(dbPath);
      result.dbRestored = rRes.restored;
      if (!rRes.success && rRes.error) {
        result.errors.push("DB restore failed: " + rRes.error);
      }
    } catch (err) {
      result.errors.push("DB restore exception: " + (err as Error).message);
    }
  }

  const now = new Date();

  // 2. Pull watchlist items from Firestore
  try {
    const remoteWatchlist = await service.pullWatchlistFromFirestore();
    for (const item of remoteWatchlist) {
      db.watch(item.listing_id, item.note, new Date(item.added_at || now.toISOString()));
      result.watchlistPulled++;
    }
  } catch (err) {
    result.errors.push("Pull watchlist error: " + (err as Error).message);
  }

  // 3. Pull decisions from Firestore
  try {
    const remoteDecisions = await service.pullDecisionsFromFirestore();
    for (const d of remoteDecisions) {
      db.setDecision(
        d.listing_id,
        {
          recoveryPct: d.recovery_pct,
          targetRoi: d.target_roi,
          targetMaxCents: d.target_max_cents,
          notes: d.notes,
        },
        new Date(d.updated_at || now.toISOString()),
      );
      result.decisionsPulled++;
    }
  } catch (err) {
    result.errors.push("Pull decisions error: " + (err as Error).message);
  }

  return result;
}
