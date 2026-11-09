import { loadConfig } from "../../apps/server/src/config.ts";
import { Db } from "../../apps/server/src/db.ts";
import { SecretVault, PlanSigner } from "../../apps/server/src/security.ts";
import { BStockClient } from "@bstock/client";
import { Collector, DEFAULT_SETTINGS, type TradingSettings } from "../../apps/server/src/collector.ts";
import { BidExecutor } from "../../apps/server/src/bids.ts";
import { buildApp } from "../../apps/server/src/app.ts";
import { FirebaseStorageService, pullFirebaseToLocalDb } from "@bstock/storage-firebase";
import awsLambdaFastify from "@fastify/aws-lambda";

const config = loadConfig({
  dataDir: "/tmp/bstock-command",
  dbPath: "/tmp/bstock-command/bstock.db",
  masterKey: process.env.BSTOCK_CMD_KEY
    ? Buffer.from(process.env.BSTOCK_CMD_KEY, "base64")
    : undefined,
  webDist: "/tmp/no-dist",
  port: 0,
  host: "127.0.0.1",
  liveEnabled: process.env.BSTOCK_LIVE === "1",
  logLevel: "warn",
});

const db = new Db(config.dbPath);
const vault = new SecretVault(config.masterKey);
const signer = new PlanSigner(config.masterKey);

const settings = (): TradingSettings => ({ ...DEFAULT_SETTINGS, ...db.getSetting<Partial<TradingSettings>>("trading", {}) });

const client = new BStockClient({ maxRetries: 1, ratePerSecond: 8 });
const collector = new Collector(client, db, settings);
const executor = new BidExecutor({ client, db, settings, signer, liveEnabled: config.liveEnabled });
const firebase = new FirebaseStorageService();

// Hydrate DB from Firebase Storage on cold start if available
if (firebase.init()) {
  try {
    await pullFirebaseToLocalDb(db, firebase, config.dbPath);
  } catch {}
}

const app = buildApp({ config, db, client, collector, executor, vault, firebase });
await app.ready();

export const handler = awsLambdaFastify(app);
export default handler;
