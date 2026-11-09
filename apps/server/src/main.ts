#!/usr/bin/env node
/**
 * bstock-command server.
 *
 *   node apps/server/src/main.ts              # API + built UI on 127.0.0.1:8788
 *   node apps/server/src/main.ts --sync       # one crawl, then exit (cron-friendly)
 *   node apps/server/src/main.ts --probe      # credential/clearance check, then exit
 */
import { loadConfig } from "./config.ts";
import { Db } from "./db.ts";
import { SecretVault, PlanSigner } from "./security.ts";
import { BStockClient } from "@bstock/client";
import { Collector, DEFAULT_SETTINGS, type TradingSettings } from "./collector.ts";
import { BidExecutor } from "./bids.ts";
import { buildApp, CREDENTIAL_KEY, type StoredCredentials } from "./app.ts";
import { FirebaseStorageService, pushDbToFirebase, pullFirebaseToLocalDb } from "@bstock/storage-firebase";
import { ScraplingService } from "./scrapling.ts";

const args = new Set(process.argv.slice(2));
const config = loadConfig();
const db = new Db(config.dbPath);
const vault = new SecretVault(config.masterKey);
const signer = new PlanSigner(config.masterKey);
const firebase = new FirebaseStorageService();
const scrapling = new ScraplingService();

const settings = (): TradingSettings => ({ ...DEFAULT_SETTINGS, ...db.getSetting<Partial<TradingSettings>>("trading", {}) });

// Restore sealed credentials into the client before it makes its first call.
const blob = db.getSetting<string | null>("credentials.blob", null);
let creds: StoredCredentials = {};
if (blob) {
  try {
    creds = vault.open<StoredCredentials>(CREDENTIAL_KEY, blob);
  } catch (err) {
    console.error("[bstock-command] credential blob could not be decrypted:", (err as Error).message);
  }
}

const client = new BStockClient({
  clearance: creds.clearance,
  userAgent: creds.userAgent,
  accessToken: creds.accessToken,
  maxRetries: 2,
  ratePerSecond: 8,
  onToken: (token, refreshToken) => {
    const current = db.getSetting<string | null>("credentials.blob", null);
    const existing = current ? vault.open<StoredCredentials>(CREDENTIAL_KEY, current) : {};
    db.setSetting("credentials.blob", vault.seal(CREDENTIAL_KEY, { ...existing, accessToken: token, refreshToken }));
  },
});
credentialsBootstrap();

function credentialsBootstrap() {
  if (creds.refreshToken) {
    // Non-blocking: a bad refresh token must not stop the terminal from opening.
    void client.refreshAccessToken().catch((err: Error) => {
      console.error("[bstock-command] token refresh failed:", err.message);
    });
  }
}

const collector = new Collector(client, db, settings);
const executor = new BidExecutor({ client, db, settings, signer, liveEnabled: config.liveEnabled });

async function main() {
  if (args.has("--help") || args.has("-h")) {
    console.log(`bstock-command - Pallet-reseller buying terminal

Usage:
  bstock-command                     Start the Fastify API server + web dashboard
  bstock-command --sync              Crawl B-Stock once and update database
  bstock-command --sync --firebase   Crawl B-Stock and sync database + snapshot to Firebase
  bstock-command --solve-clearance   Solve Cloudflare challenge via Scrapling stealth browser
  bstock-command --scraper-status    Print Scrapling stealth scraper installation status
  bstock-command --firebase-sync     Sync local SQLite database to Firebase Storage & Firestore
  bstock-command --firebase-pull     Pull remote watchlist & decisions from Firestore
  bstock-command --firebase-status   Print Firebase connection and bucket status
  bstock-command --probe             Test B-Stock credentials and clearance reachability
  bstock-command --recompute         Recompute analytics scoring models for all lots
`);
    db.close();
    return;
  }

  if (args.has("--scraper-status")) {
    console.log(JSON.stringify(scrapling.getStatus(), null, 2));
    db.close();
    return;
  }

  if (args.has("--solve-clearance")) {
    console.log("[bstock-command] Solving Cloudflare challenge with Scrapling...");
    const res = await scrapling.solveClearance();
    if (res.success && res.clearance) {
      console.log(`[bstock-command] Clearance solved successfully! Token: ${res.clearance.slice(0, 15)}...`);
      client.transport.setClearance(res.clearance);
      if (res.userAgent) client.transport.setUserAgent(res.userAgent);
      const blob = db.getSetting<string | null>("credentials.blob", null);
      let current: StoredCredentials = {};
      if (blob) {
        try {
          current = vault.open<StoredCredentials>(CREDENTIAL_KEY, blob);
        } catch {}
      }
      db.setSetting("credentials.blob", vault.seal(CREDENTIAL_KEY, { ...current, clearance: res.clearance, userAgent: res.userAgent }));
    } else {
      console.error("[bstock-command] Failed to solve clearance:", res.error);
    }
    db.close();
    return;
  }

  if (args.has("--firebase-status")) {
    console.log(JSON.stringify(firebase.getStatus(), null, 2));
    db.close();
    return;
  }

  if (args.has("--firebase-sync")) {
    const report = await pushDbToFirebase(db, firebase, config.dbPath);
    console.log(JSON.stringify(report, null, 2));
    db.close();
    return;
  }

  if (args.has("--firebase-pull")) {
    const report = await pullFirebaseToLocalDb(db, firebase, config.dbPath);
    console.log(JSON.stringify(report, null, 2));
    db.close();
    return;
  }

  if (args.has("--sync")) {
    const report = await collector.sync({ pages: 5, pageSize: 80, withBidsFor: 40 });
    console.log(JSON.stringify(report, null, 2));
    if (args.has("--firebase") || process.env.BSTOCK_FIREBASE_SYNC === "1") {
      const fbReport = await pushDbToFirebase(db, firebase, config.dbPath);
      console.log(JSON.stringify({ firebase: fbReport }, null, 2));
    }
    db.close();
    return;
  }

  if (args.has("--probe")) {
    const results = await client.probe();
    console.log(JSON.stringify({ clearance: client.transport.hasClearance(), token: Boolean(client.accessToken), results }, null, 2));
    db.close();
    return;
  }

  if (args.has("--recompute")) {
    console.log(JSON.stringify({ recomputed: collector.recompute() }));
    db.close();
    return;
  }

  // Auto-restore data on startup if local DB is empty and Firebase is configured
  if (db.stats().listings === 0 && firebase.isInitialized()) {
    try {
      const restored = await pullFirebaseToLocalDb(db, firebase, config.dbPath);
      if (restored.dbRestored || restored.watchlistPulled > 0) {
        console.log(`[bstock-command] Restored data from Firebase (watchlist: ${restored.watchlistPulled}, decisions: ${restored.decisionsPulled})`);
      }
    } catch (e) {
      console.warn("[bstock-command] Firebase restore notice:", (e as Error).message);
    }
  }

  const app = buildApp({ config, db, client, collector, executor, vault, firebase, scrapling });
  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    { port: config.port, mode: settings().mode, live: config.liveEnabled, db: config.dbPath },
    "bstock-command ready",
  );

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
