import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import os from "node:os";

export interface AppConfig {
  dataDir: string;
  dbPath: string;
  keyPath: string;
  webDist: string;
  port: number;
  host: string;
  /** 32-byte key used for AES-256-GCM credential storage and plan-token HMAC. */
  masterKey: Buffer;
  /** Hard floor: live bidding additionally requires this env flag. */
  liveEnabled: boolean;
  logLevel: string;
}

function ensureKey(keyPath: string): Buffer {
  const fromEnv = process.env.BSTOCK_CMD_KEY;
  if (fromEnv) {
    const buf = Buffer.from(fromEnv, "base64");
    if (buf.length !== 32) throw new Error("BSTOCK_CMD_KEY must be 32 bytes base64-encoded");
    return buf;
  }
  if (existsSync(keyPath)) {
    const buf = readFileSync(keyPath);
    if (buf.length !== 32) throw new Error(`${keyPath} must contain exactly 32 bytes`);
    return buf;
  }
  const buf = randomBytes(32);
  writeFileSync(keyPath, buf, { mode: 0o600 });
  chmodSync(keyPath, 0o600);
  return buf;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const dataDir = overrides.dataDir ?? process.env.BSTOCK_CMD_DATA ?? path.join(os.homedir(), ".local", "share", "bstock-command");
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const keyPath = overrides.keyPath ?? path.join(dataDir, "master.key");
  return {
    dataDir,
    dbPath: overrides.dbPath ?? path.join(dataDir, "bstock.db"),
    keyPath,
    webDist: overrides.webDist ?? path.resolve(import.meta.dirname, "../../web/dist"),
    port: overrides.port ?? Number(process.env.BSTOCK_CMD_PORT ?? 8788),
    host: overrides.host ?? process.env.BSTOCK_CMD_HOST ?? "127.0.0.1",
    masterKey: overrides.masterKey ?? ensureKey(keyPath),
    liveEnabled: overrides.liveEnabled ?? process.env.BSTOCK_LIVE === "1",
    logLevel: overrides.logLevel ?? process.env.BSTOCK_CMD_LOG ?? "info",
  };
}
