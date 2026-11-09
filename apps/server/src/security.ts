import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const VERSION = "v1";

/** AES-256-GCM at rest. One blob per credential name; AAD binds the name. */
export class SecretVault {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 32) throw new Error("vault key must be 32 bytes");
    this.key = key;
  }

  seal(name: string, value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(`${VERSION}:${name}`));
    const plaintext = Buffer.from(JSON.stringify(value), "utf8");
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
  }

  open<T>(name: string, blob: string): T {
    const [version, ivB64, tagB64, dataB64] = blob.split(":");
    if (version !== VERSION) throw new Error(`unknown vault version ${version}`);
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivB64, "base64"));
    decipher.setAAD(Buffer.from(`${VERSION}:${name}`));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8")) as T;
  }
}

export interface PlanPayload {
  listingId: string;
  auctionId: string;
  amount: number;
  maxAmount: number;
  expiresAt: number;
  nonce: string;
}

/**
 * Plan tokens bind a bid to the exact amount/max/listing that was reviewed and
 * are single-use (nonce recorded on first execution). An agent cannot mint one
 * without the master key, which never leaves the server process.
 */
export class PlanSigner {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    this.key = key;
  }

  private sign(payload: PlanPayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const mac = createHmac("sha256", this.key).update(body).digest("base64url");
    return `${body}.${mac}`;
  }

  issue(payload: Omit<PlanPayload, "nonce"> & { nonce?: string }): string {
    return this.sign({ ...payload, nonce: payload.nonce ?? randomBytes(9).toString("base64url") });
  }

  verify(token: string, now: number): { ok: true; payload: PlanPayload } | { ok: false; reason: string } {
    const parts = token.split(".");
    if (parts.length !== 2) return { ok: false, reason: "malformed token" };
    const [body, mac] = parts;
    const expected = createHmac("sha256", this.key).update(body).digest("base64url");
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "bad signature" };
    let payload: PlanPayload;
    try {
      payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PlanPayload;
    } catch {
      return { ok: false, reason: "unreadable payload" };
    }
    if (!payload.expiresAt || payload.expiresAt < now) return { ok: false, reason: "plan expired" };
    if (typeof payload.amount !== "number" || typeof payload.maxAmount !== "number") {
      return { ok: false, reason: "plan missing amounts" };
    }
    return { ok: true, payload };
  }
}
