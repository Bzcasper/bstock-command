import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import { existsSync } from "node:fs";
import path from "node:path";
import type { BStockClient } from "@bstock/client";
import type { Db } from "./db.ts";
import type { BidExecutor } from "./bids.ts";
import type { Collector, TradingSettings } from "./collector.ts";
import { DEFAULT_SETTINGS } from "./collector.ts";
import type { SecretVault } from "./security.ts";
import type { AppConfig } from "./config.ts";
import { FirebaseStorageService, pushDbToFirebase, pullFirebaseToLocalDb } from "@bstock/storage-firebase";

export interface StoredCredentials {
  clearance?: string;
  userAgent?: string;
  loginId?: string;
  password?: string;
  refreshToken?: string;
  accessToken?: string;
}

export interface AppDeps {
  config: AppConfig;
  db: Db;
  client: BStockClient;
  collector: Collector;
  executor: BidExecutor;
  vault: SecretVault;
  firebase?: FirebaseStorageService;
  now?: () => Date;
  version?: string;
}

export const CREDENTIAL_KEY = "credentials";

const asNumber = (v: unknown, fallback?: number): number | undefined => {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const asString = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const asBool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);

export function buildApp(deps: AppDeps): FastifyInstance {
  const { db, client, collector, executor, vault, config, firebase } = deps;
  const firebaseService = firebase ?? new FirebaseStorageService();
  const now = deps.now ?? (() => new Date());
  const version = deps.version ?? "0.1.0";
  const startedAt = now();
  const sseClients = new Set<{ write: (chunk: string) => void; end: () => void }>();

  const app = Fastify({ logger: { level: config.logLevel }, bodyLimit: 2 * 1024 * 1024 });

  const loadSettings = (): TradingSettings => ({ ...DEFAULT_SETTINGS, ...db.getSetting<Partial<TradingSettings>>("trading", {}) });
  const saveSettings = (patch: Partial<TradingSettings>): TradingSettings => {
    const merged = { ...loadSettings(), ...patch };
    db.setSetting("trading", merged);
    return merged;
  };

  app.register(fastifyCors, { origin: true, methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"] });

  // Optional shared secret for non-loopback exposure. Loopback-only by default.
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const expected = process.env.BSTOCK_CMD_API_TOKEN;
    if (!expected) return;
    if (req.url.startsWith("/api/health")) return;
    const header = req.headers.authorization ?? "";
    if (header !== `Bearer ${expected}`) {
      reply.code(401).send({ error: "unauthorized" });
    }
  });

  const broadcast = (event: string, data: unknown) => {
    const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of sseClients) {
      try {
        c.write(chunk);
      } catch {
        sseClients.delete(c);
      }
    }
  };
  collector.events.on("sync:start", (p) => broadcast("sync:start", p));
  collector.events.on("sync:done", (p) => broadcast("sync:done", p));
  collector.events.on("sync:error", (p) => broadcast("sync:error", p));

  // ------------------------------------------------------------------ health
  app.get("/api/health", async () => ({
    ok: true,
    version,
    uptimeSeconds: Math.round((now().getTime() - startedAt.getTime()) / 1000),
    mode: loadSettings().mode,
  }));

  app.get("/api/status", async () => {
    const settings = loadSettings();
    return {
      version,
      mode: settings.mode,
      liveEnvFlag: config.liveEnabled,
      credentials: {
        hasClearance: client.transport.hasClearance(),
        hasToken: Boolean(client.accessToken),
      },
      stats: db.stats(),
      storage: firebaseService.getStatus(),
      settings,
      serverTime: now().toISOString(),
    };
  });

  // ---------------------------------------------------------------- settings
  app.get("/api/settings", async () => loadSettings());

  app.put("/api/settings", async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Partial<TradingSettings> = {};
    if (asString(body.mode)) patch.mode = body.mode as TradingSettings["mode"];
    for (const key of ["perBidCap", "dailyCap", "minScore", "minRoi", "recoveryPctDefault", "targetRoiDefault", "buyerPremiumPct", "taxPct", "shippingDefault", "otherFeesDefault"] as const) {
      const n = asNumber(body[key]);
      if (n !== undefined) (patch as Record<string, unknown>)[key] = n;
    }
    const requireManifest = asBool(body.requireManifest);
    if (requireManifest !== undefined) patch.requireManifest = requireManifest;
    if (Array.isArray(body.allowedSites)) patch.allowedSites = body.allowedSites.map(String);
    if (Array.isArray(body.blockedCategories)) patch.blockedCategories = body.blockedCategories.map(String);
    if (patch.mode === "live" && !config.liveEnabled) {
      throw Object.assign(new Error("live mode needs BSTOCK_LIVE=1 in the server environment"), { statusCode: 400 });
    }
    return saveSettings(patch);
  });

  // ------------------------------------------------------------- credentials
  app.get("/api/credentials", async () => {
    const stored = db.getSetting<string | null>("credentials.blob", null);
    let meta: Record<string, unknown> = {};
    if (stored) {
      try {
        const c = vault.open<StoredCredentials>(CREDENTIAL_KEY, stored);
        meta = {
          hasClearance: Boolean(c.clearance),
          hasUserAgent: Boolean(c.userAgent),
          hasLogin: Boolean(c.loginId && c.password),
          hasRefreshToken: Boolean(c.refreshToken),
        };
      } catch {
        meta = { error: "credential blob unreadable" };
      }
    }
    return { ...meta, applied: { hasClearance: client.transport.hasClearance(), hasToken: Boolean(client.accessToken) } };
  });

  app.post("/api/credentials", async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const existing = (() => {
      const blob = db.getSetting<string | null>("credentials.blob", null);
      if (!blob) return {} as StoredCredentials;
      try {
        return vault.open<StoredCredentials>(CREDENTIAL_KEY, blob);
      } catch {
        return {} as StoredCredentials;
      }
    })();
    const merged: StoredCredentials = {
      ...existing,
      ...(asString(body.clearance) ? { clearance: asString(body.clearance) } : {}),
      ...(asString(body.userAgent) ? { userAgent: asString(body.userAgent) } : {}),
      ...(asString(body.loginId) ? { loginId: asString(body.loginId) } : {}),
      ...(asString(body.password) ? { password: asString(body.password) } : {}),
      ...(asString(body.refreshToken) ? { refreshToken: asString(body.refreshToken) } : {}),
      ...(asString(body.accessToken) ? { accessToken: asString(body.accessToken) } : {}),
    };
    db.setSetting("credentials.blob", vault.seal(CREDENTIAL_KEY, merged));
    if (merged.clearance) client.transport.setClearance(merged.clearance);
    if (merged.accessToken) client.setAccessToken(merged.accessToken);
    return {
      stored: true,
      applied: { hasClearance: client.transport.hasClearance(), hasToken: Boolean(client.accessToken) },
    };
  });

  app.delete("/api/credentials", async () => {
    db.deleteSetting("credentials.blob");
    client.transport.setClearance(undefined);
    client.setAccessToken(undefined);
    return { cleared: true };
  });

  app.post("/api/session/login", async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const blob = db.getSetting<string | null>("credentials.blob", null);
    const stored = blob ? vault.open<StoredCredentials>(CREDENTIAL_KEY, blob) : ({} as StoredCredentials);
    const loginId = asString(body.loginId) ?? stored.loginId;
    const password = asString(body.password) ?? stored.password;
    if (!loginId || !password) {
      throw Object.assign(new Error("loginId and password are required"), { statusCode: 400 });
    }
    const res = await client.login({ loginId, password });
    const token = res.token ?? res.access_token;
    const refresh = res.refreshToken ?? res.refresh_token;
    db.setSetting(
      "credentials.blob",
      vault.seal(CREDENTIAL_KEY, { ...stored, loginId, password, accessToken: token, refreshToken: refresh }),
    );
    return { ok: Boolean(token), user: res.user ?? null };
  });

  app.post("/api/session/probe", async () => {
    const results = await client.probe();
    return { results, at: now().toISOString() };
  });

  // --------------------------------------------------------------------- sync
  app.post("/api/sync", async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const report = await collector.sync({
      pages: asNumber(body.pages, 3),
      pageSize: asNumber(body.pageSize, 80),
      sortBy: asString(body.sortBy) as never,
      sortOrder: asString(body.sortOrder) as never,
      withBidsFor: asNumber(body.withBidsFor, 25),
      request: (body.request ?? {}) as never,
    });
    return report;
  });

  // ----------------------------------------------------------------- listings
  app.get("/api/listings", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const rows = db.queryListings({
      q: q.q,
      category: q.category,
      site: q.site,
      minScore: asNumber(q.minScore),
      minRoi: asNumber(q.minRoi),
      endingWithinHours: asNumber(q.endingWithinHours),
      minPallets: asNumber(q.minPallets),
      watchlistOnly: q.watchlistOnly === "1" || q.watchlistOnly === "true",
      sort: (q.sort as never) ?? "score",
      limit: asNumber(q.limit, 100),
      offset: asNumber(q.offset, 0),
    });
    return {
      count: rows.length,
      listings: rows.map((r) => ({
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
      })),
      facets: { categories: db.categories(), sites: db.sites() },
    };
  });

  app.get("/api/listings/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const detail = collector.listingDetail(id);
    if (!detail) {
      reply.code(404).send({ error: "listing not found", listingId: id });
      return;
    }
    return detail;
  });

  app.put("/api/listings/:id/decision", async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as Record<string, unknown>;
    db.setDecision(
      id,
      {
        recoveryPct: asNumber(body.recoveryPct) ?? null,
        targetRoi: asNumber(body.targetRoi) ?? null,
        targetMaxCents: body.targetMax === undefined ? null : Math.round(Number(body.targetMax) * 100),
        notes: asString(body.notes) ?? null,
      },
      now(),
    );
    collector.recompute();
    return { ok: true };
  });

  app.post("/api/listings/:id/watch", async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as Record<string, unknown>;
    db.watch(id, asString(body.note) ?? null, now());
    return { ok: true };
  });

  app.delete("/api/listings/:id/watch", async (req) => {
    const { id } = req.params as { id: string };
    db.unwatch(id);
    return { ok: true };
  });

  // --------------------------------------------------------------------- bids
  app.get("/api/bids", async () => ({
    attempts: db.listBidAttempts(100),
    dailyExposure: db.dailyExposureCents(new Date(new Date().setHours(0, 0, 0, 0)).toISOString()) / 100,
    settings: loadSettings(),
  }));

  app.post("/api/bid/plan", async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const listingId = asString(body.listingId);
    if (!listingId) throw Object.assign(new Error("listingId required"), { statusCode: 400 });
    return executor.plan(listingId, asNumber(body.maxAmount));
  });

  app.post("/api/bid/execute", async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const listingId = asString(body.listingId);
    const planToken = asString(body.planToken);
    const amount = asNumber(body.amount);
    const idempotencyKey = asString(body.idempotencyKey) ?? `manual-${Date.now()}`;
    if (!listingId || !planToken || amount === undefined) {
      throw Object.assign(new Error("listingId, planToken and amount are required"), { statusCode: 400 });
    }
    const result = await executor.execute({
      listingId,
      amount,
      planToken,
      armed: body.armed === true,
      dryRun: body.dryRun !== false,
      idempotencyKey,
    });
    broadcast("bid:result", { listingId, ...result });
    return result;
  });

  // ---------------------------------------------------------------- streaming
  app.get("/api/events", (req, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(`event: hello\ndata: ${JSON.stringify({ at: now().toISOString() })}\n\n`);
    const client = { write: (c: string) => reply.raw.write(c), end: () => reply.raw.end() };
    sseClients.add(client);
    const timer = setInterval(() => client.write(`: ping ${Date.now()}\n\n`), 15_000);
    req.raw.on("close", () => {
      clearInterval(timer);
      sseClients.delete(client);
    });
  });

  // ------------------------------------------------------------------- export
  app.get("/api/export.csv", async (_req, reply) => {
    const rows = db.queryListings({ limit: 5000 });
    const header = [
      "listing_id",
      "site",
      "title",
      "category",
      "pallets",
      "units",
      "retail",
      "current_bid",
      "next_min_bid",
      "projected",
      "max_hammer",
      "roi",
      "score",
      "ends_at",
      "watched",
    ];
    const csv = [header.join(",")];
    for (const r of rows) {
      const cells = [
        r.listing_id,
        r.site_abb,
        JSON.stringify(r.title ?? ""),
        JSON.stringify(r.category ?? ""),
        r.pallets ?? "",
        r.units ?? "",
        r.retail_cents === null ? "" : (r.retail_cents / 100).toFixed(2),
        r.current_cents === null ? "" : (r.current_cents / 100).toFixed(2),
        r.next_min_cents === null ? "" : (r.next_min_cents / 100).toFixed(2),
        r.projected_cents === null ? "" : (r.projected_cents / 100).toFixed(2),
        r.max_hammer_cents === null ? "" : (r.max_hammer_cents / 100).toFixed(2),
        r.roi === null ? "" : r.roi.toFixed(4),
        r.score === null ? "" : r.score.toFixed(1),
        r.ends_at,
        r.watched ? "yes" : "no",
      ];
      csv.push(cells.join(","));
    }
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", 'attachment; filename="bstock-listings.csv"');
    return csv.join("\n");
  });

  // --------------------------------------------------------- firebase storage
  app.get("/api/storage/status", async () => {
    return firebaseService.getStatus();
  });

  app.post("/api/storage/sync", async () => {
    return pushDbToFirebase(db, firebaseService, config.dbPath);
  });

  app.post("/api/storage/backup", async () => {
    return firebaseService.backupDatabase(config.dbPath);
  });

  app.post("/api/storage/restore", async () => {
    return pullFirebaseToLocalDb(db, firebaseService, config.dbPath);
  });

  // ------------------------------------------------------------- static web ui
  const dist = config.webDist;
  if (existsSync(dist)) {
    app.register(fastifyStatic, { root: dist, prefix: "/" });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) {
        reply.code(404).send({ error: "not found" });
        return;
      }
      reply.sendFile("index.html");
    });
  } else {
    app.get("/", async () => ({
      service: "bstock-command",
      note: "web bundle not built; run `npm run build:web` or use `npm run dev:web`",
      api: "/api/status",
    }));
  }

  app.get("/api/config/capabilities", async () => ({
    auctionHosts: {
      search: "https://search.bstock.com",
      auctions: "https://auction.bstock.com",
      listings: "https://listing.bstock.com",
      bridge: "https://bridge.bstock.com",
      contracts: "https://contract.bstock.com",
      auth: "https://auth.bstock.com",
    },
    endpoints: {
      search: "POST /v1/all-listings/listings",
      filters: "GET /v1/all-listings/listings/filters",
      auctions: "GET /v1/auctions?listingId=…",
      bids: "GET /v1/auctions/{id}/bids",
      placeBid: "POST /v1/auctions/{id}/bids",
      cancelBid: "DELETE /v1/auctions/bids/{id}",
      buyNow: "POST /v1/auctions/{id}/buy-now",
      contracts: "GET /v1/contracts",
    },
    workingDirectory: path.basename(config.dataDir),
  }));

  app.addHook("onClose", async () => {
    for (const c of sseClients) c.end();
    sseClients.clear();
  });

  return app;
}
