import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { BStockClient } from "@bstock/client";
import { buildMock, type MockHandle } from "../mock/bstock-mock.ts";
import { Db } from "../apps/server/src/db.ts";
import { SecretVault, PlanSigner } from "../apps/server/src/security.ts";
import { Collector, DEFAULT_SETTINGS, type TradingSettings } from "../apps/server/src/collector.ts";
import { BidExecutor } from "../apps/server/src/bids.ts";
import { buildApp } from "../apps/server/src/app.ts";
import { loadConfig } from "../apps/server/src/config.ts";

export interface Harness {
  mock: MockHandle;
  baseUrl: string;
  client: BStockClient;
  db: Db;
  collector: Collector;
  executor: BidExecutor;
  app: ReturnType<typeof buildApp>;
  settings: () => TradingSettings;
  setSettings: (patch: Partial<TradingSettings>) => void;
  close: () => Promise<void>;
}

export const MOCK_UA = "mock-ua/1.0";

export async function startHarness(options: { mode?: TradingSettings["mode"]; liveEnabled?: boolean; clearance?: string | null } = {}): Promise<Harness> {
  const mock = buildMock({ logLevel: "silent", now: new Date("2026-11-08T18:00:00.000Z") });
  await mock.app.listen({ port: 0, host: "127.0.0.1" });
  const address = mock.app.server.address();
  if (!address || typeof address === "string") throw new Error("mock did not bind");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const clearance = options.clearance === null ? undefined : (options.clearance ?? mock.clearance);
  const client = new BStockClient({
    clearance,
    userAgent: MOCK_UA,
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

  const dataDir = mkdtempSync(path.join(os.tmpdir(), "bstock-cmd-test-"));
  const db = new Db(":memory:");
  if (options.mode) db.setSetting("trading", { ...DEFAULT_SETTINGS, mode: options.mode });

  const settings = (): TradingSettings => ({ ...DEFAULT_SETTINGS, ...db.getSetting<Partial<TradingSettings>>("trading", {}) });
  const setSettings = (patch: Partial<TradingSettings>) => db.setSetting("trading", { ...settings(), ...patch });

  const collector = new Collector(client, db, settings, () => new Date("2026-11-08T18:00:00.000Z"));
  const key = randomBytes(32);
  const executor = new BidExecutor({
    client,
    db,
    settings,
    signer: new PlanSigner(key),
    liveEnabled: options.liveEnabled ?? false,
    now: () => new Date("2026-11-08T18:00:00.000Z"),
  });

  const config = loadConfig({
    dataDir,
    dbPath: path.join(dataDir, "test.db"),
    masterKey: key,
    webDist: path.join(dataDir, "no-dist"),
    port: 0,
    host: "127.0.0.1",
    liveEnabled: options.liveEnabled ?? false,
    logLevel: "silent",
  });

  const app = buildApp({ config, db, client, collector, executor, vault: new SecretVault(key) });
  await app.ready();

  return {
    mock,
    baseUrl,
    client,
    db,
    collector,
    executor,
    app,
    settings,
    setSettings,
    close: async () => {
      await app.close();
      await mock.app.close();
      db.close();
    },
  };
}
