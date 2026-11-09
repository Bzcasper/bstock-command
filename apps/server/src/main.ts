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

const args = new Set(process.argv.slice(2));
const config = loadConfig();
const db = new Db(config.dbPath);
const vault = new SecretVault(config.masterKey);
const signer = new PlanSigner(config.masterKey);

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
  if (args.has("--sync")) {
    const report = await collector.sync({ pages: 5, pageSize: 80, withBidsFor: 40 });
    console.log(JSON.stringify(report, null, 2));
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

  const app = buildApp({ config, db, client, collector, executor, vault });
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
