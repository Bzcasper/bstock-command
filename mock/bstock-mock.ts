#!/usr/bin/env node
/**
 * Offline B-Stock simulator.
 *
 * Reproduces the production contracts observed in the live captures (paths,
 * payload shapes, status codes, auth behaviour, Cloudflare gating) so the whole
 * terminal can be developed, demoed and regression-tested without touching
 * production and without any credentials.
 *
 * Hosts are mounted as path prefixes, mirroring the real subdomain split:
 *   /search/*   -> search.bstock.com
 *   /auction/*  -> auction.bstock.com
 *   /listing/*  -> listing.bstock.com
 *   /bridge/*   -> bridge.bstock.com
 *   /auth/*     -> auth.bstock.com
 */
import Fastify, { type FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { buildMarketplace, filterFacets } from "./data.ts";

export interface MockOptions {
  token?: string;
  clearanceRequired?: boolean;
  clearance?: string;
  listings?: number;
  now?: Date;
  logLevel?: string;
}

export interface MockHandle {
  app: FastifyInstance;
  market: ReturnType<typeof buildMarketplace>;
  token: string;
  clearance: string;
}

export function buildMock(options: MockOptions = {}): MockHandle {
  const token = options.token ?? "test-token";
  const clearance = options.clearance ?? "mock-clearance";
  const clearanceRequired = options.clearanceRequired ?? true;
  const market = buildMarketplace(options.now ?? new Date(), options.listings ?? 48);

  const byListingId = new Map(market.map((m) => [m.listing.listingId, m]));
  const byAuctionId = new Map(market.map((m) => [m.auction._id, m]));

  const app = Fastify({ logger: { level: options.logLevel ?? "warn" } });

  app.addHook("onRequest", async (req, reply) => {
    const url = req.url;
    const gated = url.startsWith("/auction/") || url.startsWith("/listing/") || url.startsWith("/bridge/");
    if (clearanceRequired && gated) {
      const cookie = req.headers.cookie ?? "";
      if (!cookie.includes(`cf_clearance=${clearance}`)) {
        reply
          .code(403)
          .header("Content-Type", "text/html")
          .send("<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>challenge</body></html>");
      }
    }
  });

  const requireToken = (req: { headers: Record<string, unknown> }, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
    const auth = String(req.headers.authorization ?? "");
    if (auth !== `Bearer ${token}`) {
      reply.code(401).send({ errorMessage: "Unauthorized" });
      return false;
    }
    return true;
  };

  const SORT_VALUES = ["endTime", "startTime", "numberOfBids", "winningBidAmount", "relevance", "recommended", "personalization"];

  // ---------------------------------------------------------------- search host
  app.post("/search/v1/all-listings/listings", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.sortBy && !SORT_VALUES.includes(String(body.sortBy))) {
      return reply.code(400).send({
        errorMessage: "body validation errors",
        messages: [`sortBy must be one of the following values: ${SORT_VALUES.join(", ")}`],
      });
    }
    let rows = market.map((m) => m.listing);
    const cats = (body.categories ?? body.category) as string[] | undefined;
    if (cats?.length) rows = rows.filter((l) => l.categories.some((c) => cats.includes(c)));
    const sites = (body.storefront as string[] | undefined) ?? (body.storeFrontId as string[] | undefined);
    if (sites?.length) {
      rows = rows.filter((l) => sites.some((s) => s === l.siteAbb || s.endsWith(`-${l.siteAbb}`) || s.includes(l.siteAbb)));
    }
    if (typeof body.q === "string" && body.q.trim()) {
      const q = body.q.toLowerCase();
      rows = rows.filter((l) => `${l.title} ${l.categories.join(" ")} ${l.siteAbb}`.toLowerCase().includes(q));
    }
    if (typeof body.minBidValue === "number") rows = rows.filter((l) => (l.currentBid ?? 0) >= (body.minBidValue as number));
    if (typeof body.maxBidValue === "number") rows = rows.filter((l) => (l.currentBid ?? 0) <= (body.maxBidValue as number));
    if (typeof body.minUnits === "number") rows = rows.filter((l) => (l.units ?? 0) >= (body.minUnits as number));
    if (typeof body.maxUnits === "number") rows = rows.filter((l) => (l.units ?? 0) <= (body.maxUnits as number));
    if (Array.isArray(body.listingType) && body.listingType.length) {
      rows = rows.filter((l) => (body.listingType as string[]).includes(l.listingType));
    }
    if (typeof body.manifest === "boolean") rows = rows.filter((l) => l.manifest === body.manifest);

    const sortBy = String(body.sortBy ?? "recommended");
    const dir = String(body.sortOrder ?? "asc") === "desc" ? -1 : 1;
    const key = (l: (typeof rows)[number]): number | string => {
      switch (sortBy) {
        case "endTime":
          return Date.parse(l.endTime);
        case "startTime":
          return Date.parse(l.biddingStartTime ?? l.endTime);
        case "numberOfBids":
          return l.numberOfBids;
        case "winningBidAmount":
          return l.winningBidAmount ?? 0;
        default:
          return l.listingId;
      }
    };
    rows = [...rows].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      return ka < kb ? -dir : ka > kb ? dir : 0;
    });

    const limit = Math.min(100, Number(body.limit ?? 20));
    const offset = Number(body.offset ?? 0);
    return { listings: rows.slice(offset, offset + limit), total: rows.length, offset, limit };
  });

  app.get("/search/v1/all-listings/listings/filters", async () => filterFacets);

  // --------------------------------------------------------------- listing host
  app.get("/listing/v1/lots/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const m = market.find((x) => x.listing.lotId === id);
    if (!m) return reply.code(404).send({ statusCode: 404, errorMessage: "Not Found" });
    return {
      _id: id,
      accountId: m.listing.sellerId,
      locationId: "mock-location",
      sellerLotId: m.listing.sellerLotId,
      groups: ["mock-group"],
      documents: [],
      itemAttributes: { pallets: m.listing.palletCount, units: m.listing.units },
    };
  });

  app.get("/listing/v1/lots/:id/items", async (req, reply) => {
    const { id } = req.params as { id: string };
    const m = market.find((x) => x.listing.lotId === id);
    if (!m) return reply.code(404).send({ statusCode: 404, errorMessage: "Not Found" });
    const rows = Array.from({ length: 5 }, (_, i) => ({
      _id: `${id}-item-${i}`,
      attributes: {
        currencyCode: "USD",
        description: `Sample manifest line ${i + 1}`,
        unitRetail: Math.round(((m.listing.retailPrice ?? 1000) / 5) * 100) / 100,
        quantity: 1,
        condition: m.listing.condition?.[0] ?? "Used Good",
      },
    }));
    return { limit: 10, offset: 0, total: rows.length, items: rows };
  });

  app.get("/listing/v1/groups", async (req) => {
    const { lotId } = req.query as { lotId?: string };
    return { limit: 100, offset: 0, total: 1, groups: [{ _id: "mock-group", accountId: "mock-seller", lotId: lotId ?? null }] };
  });

  // -------------------------------------------------------------- auction host
  const auctionOf = (listingId: string) => byListingId.get(listingId)?.auction;

  app.get("/auction/v1/auctions", async (req, reply) => {
    const { listingId } = req.query as { listingId?: string };
    if (!listingId) return reply.code(400).send({ errorMessage: "listingId is required" });
    const ids = decodeURIComponent(listingId).split(",");
    const auctions = ids.map((id) => auctionOf(id)).filter(Boolean);
    return { auctions, total: auctions.length, offset: 0, limit: 20 };
  });

  app.get("/auction/v1/auctions/by-listing-id/:listingId", async (req, reply) => {
    const { listingId } = req.params as { listingId: string };
    const a = auctionOf(listingId);
    if (!a) return reply.code(404).send({ errorMessage: "Not Found" });
    return a;
  });

  app.get("/auction/v1/auctions/:id/bids", async (req, reply) => {
    const { id } = req.params as { id: string };
    const m = byAuctionId.get(id);
    if (!m) return reply.code(404).send({ errorMessage: "Not Found" });
    return {
      uniqueBidders: new Set(m.bids.map((b) => b.uniqueId)).size,
      numberOfBids: m.bids.length,
      bids: [...m.bids].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    };
  });

  app.post("/auction/v1/auctions/:id/bids", async (req, reply) => {
    if (!requireToken(req, reply)) return;
    const { id } = req.params as { id: string };
    const m = byAuctionId.get(id);
    if (!m) return reply.code(404).send({ errorMessage: "Not Found" });
    const body = (req.body ?? {}) as { amount?: number };
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return reply.code(400).send({ errorMessage: "body validation errors", messages: ["amount must be a positive number"] });
    }
    if (m.auction.closed) return reply.code(409).send({ errorMessage: "Auction is closed" });
    if (amount < m.auction.nextMinBidAmount) {
      return reply.code(400).send({ errorMessage: `Bid must be at least ${m.auction.nextMinBidAmount}` });
    }
    const bidderId = String(req.headers["x-mock-bidder"] ?? "self");
    const record = {
      createdAt: new Date().toISOString(),
      bidAmount: amount,
      uniqueId: createHash("sha256").update(bidderId).digest("hex"),
      winning: true,
      userBid: true,
      currency: "USD",
    };
    m.bids = m.bids.map((b) => ({ ...b, winning: false }));
    m.bids.push(record);
    const increment = amount < 500 ? 25 : amount < 2_000 ? 50 : amount < 10_000 ? 100 : 250;
    m.auction.winningBidAmount = amount;
    m.auction.numberOfBids = m.bids.length;
    m.auction.nextMinBidAmount = amount + increment;
    m.listing.winningBidAmount = amount;
    m.listing.currentBid = amount;
    m.listing.numberOfBids = m.bids.length;
    m.listing.nextMinBidAmount = m.auction.nextMinBidAmount;
    return reply.code(201).send({ _id: `bid-${Date.now()}`, auctionId: id, amount, status: "ACCEPTED" });
  });

  app.delete("/auction/v1/auctions/bids/:id", async (req, reply) => {
    if (!requireToken(req, reply)) return;
    const { id } = req.params as { id: string };
    for (const m of market) {
      const before = m.bids.length;
      m.bids = m.bids.filter((b) => b.uniqueId !== id);
      if (m.bids.length !== before) return { canceled: true, auctionId: m.auction._id };
    }
    return reply.code(404).send({ errorMessage: "Not Found" });
  });

  app.post("/auction/v1/auctions/:id/buy-now", async (req, reply) => {
    if (!requireToken(req, reply)) return;
    const { id } = req.params as { id: string };
    const m = byAuctionId.get(id);
    if (!m) return reply.code(404).send({ errorMessage: "Not Found" });
    return { _id: `order-${Date.now()}`, auctionId: id, status: "PURCHASED" };
  });

  app.get("/auction/v1/auctions/bids", async (req, reply) => {
    if (!requireToken(req, reply)) return;
    const { accountId } = req.query as { accountId?: string };
    if (!accountId) return reply.code(400).send({ errorMessage: "accountId is required" });
    const mine = market.flatMap((m) =>
      m.bids.filter((b) => b.userBid).map((b) => ({ ...b, auctionId: m.auction._id, listingId: m.listing.listingId })),
    );
    return { bids: mine, total: mine.length };
  });

  app.get("/auction/v1/auctions/bids/exposure", async (req, reply) => {
    if (!requireToken(req, reply)) return;
    const exposure = market.reduce(
      (sum, m) => sum + m.bids.filter((b) => b.userBid && b.winning).reduce((s, b) => s + b.bidAmount, 0),
      0,
    );
    return { exposure, currency: "USD" };
  });

  // ----------------------------------------------------------------- auth host
  app.post("/auth/api/login", async (req, reply) => {
    const body = (req.body ?? {}) as { loginId?: string; password?: string; applicationId?: string };
    if (body.loginId === "demo@example.com" && body.password === "demo-password") {
      return {
        token,
        refreshToken: "mock-refresh",
        tokenExpirationInstant: Date.now() + 3600_000,
        user: { id: "mock-person", email: body.loginId },
      };
    }
    return reply.code(401).send({});
  });

  app.post("/auth/api/jwt/refresh", async (req, reply) => {
    const body = (req.body ?? {}) as { refreshToken?: string };
    if (body.refreshToken === "mock-refresh") return { token, refreshToken: "mock-refresh" };
    return reply.code(401).send({});
  });

  // --------------------------------------------------------------------- bridge
  app.get("/bridge/v1/ent-auctions", async (req) => {
    const { auctionIds } = req.query as { auctionIds?: string };
    const ids = (auctionIds ?? "").split(",").filter(Boolean);
    return ids.map((id, i) => ({
      auctionId: id,
      title: `Enterprise lot ${id}`,
      sku: `A2Z_CR_${id}`,
      siteName: "Amazon Liquidation Auctions",
      units: 44 + i,
      winningBidAmount: 1000 + i * 50,
      numberOfBids: 5 + i,
      closed: false,
      canceled: false,
      startPrice: 100,
      startTime: new Date(Date.now() - 3600_000).toISOString(),
      endTime: new Date(Date.now() + (12 + i) * 3600_000).toISOString(),
      buyerBidStatus: "HAS_NOT_BID",
    }));
  });

  app.get("/mock/state", async () => ({
    listings: market.length,
    bids: market.reduce((n, m) => n + m.bids.length, 0),
    clearanceRequired,
  }));

  return { app, market, token, clearance };
}

const isMain = process.argv[1]?.endsWith("bstock-mock.ts");
if (isMain) {
  const port = Number(process.env.MOCK_PORT ?? 8899);
  const handle = buildMock({
    logLevel: process.env.MOCK_LOG ?? "warn",
    clearanceRequired: process.env.MOCK_CF !== "0",
  });
  handle.app.listen({ port, host: "127.0.0.1" }).then(() => {
    console.log(`mock B-Stock listening on http://127.0.0.1:${port}`);
  });
}
