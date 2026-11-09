#!/usr/bin/env node
/**
 * Autonomous CI Backend Engine (ThePopeBot serverless architecture pattern).
 *
 * Runs scheduled and on-demand market crawling, Scrapling stealth challenge solving,
 * 4-stage mathematical auction funnel analysis, and multi-tier state persistence
 * (Git-as-a-database, Firebase Firestore & Cloud Storage, GitHub Step Summary).
 *
 * Designed to execute completely free inside GitHub Actions and GitLab CI runners.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { BStockClient } from "../packages/client/src/client.ts";
import { Db } from "../apps/server/src/db.ts";
import { Collector, DEFAULT_SETTINGS } from "../apps/server/src/collector.ts";
import { FirebaseStorageService, pushDbToFirebase } from "../packages/storage-firebase/src/index.ts";

const args = new Set(process.argv.slice(2));
const outDir = process.env.OUT_DIR || "public/data";
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync("backups", { recursive: true });

const forceMock = args.has("--mock") || process.env.MOCK === "1";
const forceLive = args.has("--live");
const solveClearance = args.has("--solve-clearance") || process.env.BSTOCK_SOLVE_CLEARANCE === "1";
const pagesToCrawl = Number(process.env.BSTOCK_PAGES || 5);
const enableFirebase = args.has("--firebase") || process.env.FIREBASE_SYNC === "1" || Boolean(process.env.FIREBASE_SERVICE_ACCOUNT);

// Detect live credentials
const hasLiveCreds = Boolean(
  process.env.BSTOCK_CLEARANCE ||
  process.env.BSTOCK_TOKEN ||
  (process.env.BSTOCK_LOGIN_ID && process.env.BSTOCK_PASSWORD)
);

const useMock = forceMock || (!forceLive && !hasLiveCreds);

let client;
let mockInstance = null;
let clearance = process.env.BSTOCK_CLEARANCE;
let userAgent = process.env.BSTOCK_UA || "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

console.log(`[ci-backend] Starting market crawl engine (Mode: ${useMock ? "OFFLINE_MOCK" : "LIVE_BSTOCK"})...`);

// If live mode requested and clearance is missing, try Scrapling stealth solver
if (!useMock && !clearance && solveClearance) {
  console.log("[ci-backend] Attempting Cloudflare Turnstile challenge solve via Scrapling...");
  try {
    const bridgeScript = path.resolve("scripts/scrapling_bridge.py");
    const py = process.env.PYTHON_BIN || "python3";
    const out = execFileSync(py, [bridgeScript, "--action", "solve-clearance"], {
      encoding: "utf8",
      timeout: 90_000,
    });
    const parsed = JSON.parse(out);
    if (parsed.success && parsed.clearance) {
      clearance = parsed.clearance;
      if (parsed.userAgent) userAgent = parsed.userAgent;
      console.log(`[ci-backend] Clearance solved! Token: ${clearance.slice(0, 15)}...`);
    } else {
      console.warn("[ci-backend] Turnstile solve failed:", parsed.error);
    }
  } catch (err) {
    console.warn("[ci-backend] Scrapling solve error:", err.message);
  }
}

if (useMock) {
  const { buildMock } = await import("../mock/bstock-mock.ts");
  const mock = buildMock({ logLevel: "silent" });
  mockInstance = mock;
  await mock.app.listen({ port: 0, host: "127.0.0.1" });
  const addr = mock.app.server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  client = new BStockClient({
    clearance: mock.clearance,
    userAgent: "mock-ci/1.0",
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
} else {
  client = new BStockClient({
    clearance,
    userAgent,
    accessToken: process.env.BSTOCK_TOKEN,
    maxRetries: 3,
    ratePerSecond: 6,
  });
  if (process.env.BSTOCK_LOGIN_ID && process.env.BSTOCK_PASSWORD) {
    try {
      await client.login({ loginId: process.env.BSTOCK_LOGIN_ID, password: process.env.BSTOCK_PASSWORD });
      console.log("[ci-backend] Authenticated successfully with B-Stock credentials.");
    } catch (err) {
      console.warn("[ci-backend] Login warning:", err.message);
    }
  }
}

// Prepare database (persist to file so SQLite can be committed or backed up)
const dbPath = path.resolve("backups/bstock.db");
const db = new Db(dbPath);
const settings = () => ({ ...DEFAULT_SETTINGS, mode: "dry-run" });
const collector = new Collector(client, db, settings, () => new Date());

console.log(`[ci-backend] Crawling ${pagesToCrawl} pages with 80 lots/page...`);
const report = await collector.sync({ pages: pagesToCrawl, pageSize: 80, withBidsFor: 40 });
console.log(`[ci-backend] Crawl complete: ${report.listingsSeen} listings seen, ${report.bidEventsAdded} bids parsed, ${report.metricsComputed} evaluated.`);

// Extract ranked listings
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
  galleryImages: r.gallery_images_json ? JSON.parse(r.gallery_images_json) : null,
  opportunityTier: r.opportunity_tier,
  funnelStage: r.funnel_stage,
  recommendedBid: r.recommended_bid_cents === null ? null : r.recommended_bid_cents / 100,
  kellyFraction: r.kelly_fraction,
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

// Tier breakdown
const tierCounts = {
  ALPHA_GEM: listings.filter((l) => l.opportunityTier === "ALPHA_GEM").length,
  SOLID_VALUE: listings.filter((l) => l.opportunityTier === "SOLID_VALUE").length,
  SLEEPER_SNIPE: listings.filter((l) => l.opportunityTier === "SLEEPER_SNIPE").length,
  SPECULATIVE: listings.filter((l) => l.opportunityTier === "SPECULATIVE").length,
  AVOID: listings.filter((l) => l.opportunityTier === "AVOID" || !l.opportunityTier).length,
};

const topAlphaGems = listings
  .filter((l) => l.opportunityTier === "ALPHA_GEM")
  .slice(0, 10);

const status = {
  mode: useMock ? "ci-mock" : "ci-live",
  stats: db.stats(),
  tierCounts,
  generatedAt: new Date().toISOString(),
  report,
  source: "autonomous-ci-workflow",
};

// Write static artifacts
fs.writeFileSync(path.join(outDir, "listings.json"), JSON.stringify({ count: listings.length, listings, facets: { categories: db.categories(), sites: db.sites() }, generatedAt: status.generatedAt }, null, 2));
fs.writeFileSync(path.join(outDir, "status.json"), JSON.stringify(status, null, 2));
fs.writeFileSync(path.join(outDir, "funnel-summary.json"), JSON.stringify({ tierCounts, topAlphaGems, report }, null, 2));

console.log(`[ci-backend] Wrote ${listings.length} listings to ${outDir} (Alpha Gems: ${tierCounts.ALPHA_GEM}, Solid Values: ${tierCounts.SOLID_VALUE}, Sleeper Snipes: ${tierCounts.SLEEPER_SNIPE}).`);

// Generate Markdown Summary
const summaryMd = `# 💎 B-Stock Autonomous Market Analysis Report
*Generated at: \`${status.generatedAt}\` | Engine: \`${status.mode}\`*

## 📊 Market Opportunity Funnel
| Tier | Count | Description |
| :--- | :---: | :--- |
| **💎 ALPHA GEM** | **${tierCounts.ALPHA_GEM}** | Outstanding ROI, dense pallet value, itemized manifest |
| **🟢 SOLID VALUE** | **${tierCounts.SOLID_VALUE}** | Strong margin floor, verified manifest, controlled competition |
| **⏱️ SLEEPER SNIPE** | **${tierCounts.SLEEPER_SNIPE}** | Closing soon, low bidder count, under radar |
| **🟡 SPECULATIVE** | **${tierCounts.SPECULATIVE}** | Positive EV, unmanifested or higher variance |
| **🛑 AVOID** | **${tierCounts.AVOID}** | Overbid, negative margin, or intense bidding war |

## 🚀 Top Alpha Gem Liquidation Lots
${
  topAlphaGems.length === 0
    ? "_No lots currently met strict Alpha Gem criteria in this crawl cycle._"
    : `| Lot ID | Title | Retail | Current | Snipe Bid | Exp. ROI | Pallets |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
${topAlphaGems
  .map(
    (g) =>
      `| \`${g.lotId}\` | **${(g.title || "Lot").replace(/\|/g, "/").slice(0, 45)}...** | $${(g.retail || 0).toLocaleString()} | $${(g.currentBid || 0).toLocaleString()} | **$${(g.recommendedBid || 0).toLocaleString()}** | **${((g.roi || 0) * 100).toFixed(1)}%** | ${g.pallets || 1} |`
  )
  .join("\n")}`
}

---
*Autonomous CI compute run powered by GitHub Actions / GitLab CI serverless architecture (thepopebot pattern).*
`;

fs.writeFileSync(path.join(outDir, "summary.md"), summaryMd);

// GitHub Actions Step Summary
if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMd + "\n");
    console.log("[ci-backend] Appended report to GITHUB_STEP_SUMMARY.");
  } catch (err) {
    console.warn("[ci-backend] Failed to write GITHUB_STEP_SUMMARY:", err.message);
  }
}

// Firebase Cloud Sync
if (enableFirebase) {
  console.log("[ci-backend] Syncing snapshots and SQLite database to Firebase...");
  const firebase = new FirebaseStorageService();
  if (firebase.init()) {
    try {
      const snapRes = await firebase.uploadJson(
        { count: listings.length, listings, facets: { categories: db.categories(), sites: db.sites() }, updatedAt: status.generatedAt },
        "data/listings.json"
      );
      await firebase.uploadJson(status, "data/status.json");
      const pushReport = await pushDbToFirebase(db, firebase, dbPath);
      console.log(`[ci-backend] Firebase sync completed successfully (Snapshot: ${snapRes.success ? "OK" : snapRes.error}, Lots: ${pushReport.lotsPushed}).`);
    } catch (err) {
      console.warn("[ci-backend] Firebase sync warning:", err.message);
    }
  } else {
    console.log("[ci-backend] Firebase service account not configured; skipping cloud sync.");
  }
}

db.close();
if (mockInstance?.app) {
  try {
    await mockInstance.app.close();
  } catch {}
}

console.log("[ci-backend] Autonomous CI run completed cleanly.");
process.exit(0);
