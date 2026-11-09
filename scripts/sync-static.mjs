#!/usr/bin/env node
/**
 * CI backend: runs a sync and exports a static snapshot that the dashboard can
 * consume without a live API server. This is the "GitLab/GitHub CI as backend"
 * pattern — the pipeline performs the work and commits the results.
 *
 * Env:
 *   BSTOCK_CLEARANCE   Cloudflare clearance cookie (optional; falls back to mock)
 *   BSTOCK_UA          matching User-Agent (optional)
 *   BSTOCK_TOKEN       FusionAuth bearer token (optional)
 *   BSTOCK_LOGIN_ID / BSTOCK_PASSWORD   (optional, alternative to token)
 *   MOCK=1             force the offline mock
 *   OUT_DIR            output directory (default: public/data)
 */
import fs from "node:fs";
import path from "node:path";
import { BStockClient } from "../packages/client/src/client.ts";
import { Db } from "../apps/server/src/db.ts";
import { SecretVault, PlanSigner } from "../apps/server/src/security.ts";
import { Collector, DEFAULT_SETTINGS } from "../apps/server/src/collector.ts";
import { FirebaseStorageService } from "../packages/storage-firebase/src/index.ts";
import { randomBytes } from "node:crypto";

const outDir = process.env.OUT_DIR ?? "public/data";
fs.mkdirSync(outDir, { recursive: true });

const useMock = process.env.MOCK === "1" || (!process.env.BSTOCK_CLEARANCE && !process.env.BSTOCK_TOKEN && !process.env.BSTOCK_LOGIN_ID);

let client;
let baseUrl;
let mockInstance;

if (useMock) {
  const { buildMock } = await import("../mock/bstock-mock.ts");
  const mock = buildMock({ logLevel: "silent" });
  mockInstance = mock;
  await mock.app.listen({ port: 0, host: "127.0.0.1" });
  const addr = mock.app.server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
  client = new BStockClient({
    clearance: mock.clearance,
    userAgent: "mock-ua/1.0",
    maxRetries: 0,
    ratePerSecond: 1000,
    hosts: {
      search: `${baseUrl}/search`,
      auctions: `${baseUrl}/auction`,
      listings: `${baseUrl}/listing`,
      bridge: `${baseUrl}/bridge`,
      contracts: `${baseUrl}/contract`,
      auth: `${baseUrl}/auth`,
    },
  });
  await client.login({ loginId: "demo@example.com", password: "demo-password" }).catch(() => {});
  console.log("syncing against offline mock");
} else {
  client = new BStockClient({
    clearance: process.env.BSTOCK_CLEARANCE,
    userAgent: process.env.BSTOCK_UA,
    accessToken: process.env.BSTOCK_TOKEN,
    maxRetries: 2,
    ratePerSecond: 8,
  });
  if (process.env.BSTOCK_LOGIN_ID && process.env.BSTOCK_PASSWORD) {
    await client.login({ loginId: process.env.BSTOCK_LOGIN_ID, password: process.env.BSTOCK_PASSWORD });
  }
  console.log("syncing against production B-Stock");
}

const db = new Db(":memory:");
const settings = () => ({ ...DEFAULT_SETTINGS, mode: "dry-run" });
const collector = new Collector(client, db, settings, () => new Date());

const report = await collector.sync({ pages: 5, pageSize: 80, withBidsFor: 40 });
console.log(JSON.stringify(report, null, 2));

const rows = db.queryListings({ limit: 5000, sort: "score" });
const listings = rows.map((r) => ({
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
  watched: false,
  note: null,
  computedAt: r.computed_at,
}));

const status = {
  mode: "static",
  stats: db.stats(),
  generatedAt: new Date().toISOString(),
  report,
};

fs.writeFileSync(path.join(outDir, "listings.json"), JSON.stringify({ count: listings.length, listings, facets: { categories: db.categories(), sites: db.sites() } }, null, 2));
fs.writeFileSync(path.join(outDir, "status.json"), JSON.stringify(status, null, 2));

console.log(`wrote ${listings.length} listings to ${outDir}`);

if (process.env.FIREBASE_SYNC === "1" || process.argv.includes("--firebase")) {
  const firebase = new FirebaseStorageService();
  if (firebase.init()) {
    console.log("uploading snapshots to Firebase Storage...");
    const snapRes = await firebase.uploadJson(
      { count: listings.length, listings, facets: { categories: db.categories(), sites: db.sites() }, updatedAt: new Date().toISOString() },
      "data/listings.json"
    );
    await firebase.uploadJson(status, "data/status.json");
    console.log("Firebase Storage snapshot upload:", snapRes.success ? "success" : snapRes.error);
  }
}
db.close();
if (mockInstance?.app) {
  try {
    await mockInstance.app.close();
  } catch {}
}
process.exit(0);
