import type { BStockClient } from "@bstock/client";
import { dealEconomics, maxHammerForRoi } from "@bstock/analytics";
import type { Db, ListingRow } from "./db.ts";
import { costModelFrom, type TradingSettings } from "./collector.ts";
import type { PlanSigner, PlanPayload } from "./security.ts";

export interface GuardCheck {
  name: string;
  ok: boolean;
  detail: string;
  severity: "blocker" | "warning";
}

export interface GuardInput {
  settings: TradingSettings;
  liveEnabled: boolean;
  hasToken: boolean;
  hasClearance: boolean;
  now: Date;
  listing: Pick<ListingRow, "listing_id" | "site_abb" | "category" | "ends_at" | "next_min_cents" | "current_cents" | "retail_cents" | "units" | "pallets" | "manifest">;
  auction?: { closed: boolean; canceled: boolean; biddingEnabled: boolean; nextMinBidAmount: number } | null;
  amount: number;
  armed: boolean;
  dryRun: boolean;
  dailyExposure: number;
  score?: number | null;
  plan?: PlanPayload | null;
  idempotencyKey: string;
  duplicateKey: boolean;
  nonceUsed: boolean;
}

export interface GuardResult {
  allowed: boolean;
  checks: GuardCheck[];
  blockers: string[];
  warnings: string[];
  limits: { perBidCap: number; dailyRemaining: number; maxHammerForTargetRoi: number | null };
}

const add = (
  checks: GuardCheck[],
  name: string,
  ok: boolean,
  detail: string,
  severity: "blocker" | "warning" = "blocker",
): void => {
  checks.push({ name, ok, detail, severity });
};

/**
 * Every reason a bid may or may not fire, evaluated in one place so the UI, the
 * API and the tests all see the same decision. A bid fires only when every
 * blocker passes; warnings are surfaced but do not stop it.
 */
export function evaluateBid(input: GuardInput): GuardResult {
  const checks: GuardCheck[] = [];
  const s = input.settings;
  const cost = costModelFrom(s);
  const endsMs = Date.parse(input.listing.ends_at);

  add(checks, "trading-mode", s.mode !== "off", `trading mode is "${s.mode}"`);
  add(checks, "amount-positive", input.amount > 0, `amount ${input.amount}`);
  add(checks, "amount-integer-cents", Number.isFinite(input.amount), `amount ${input.amount}`);
  add(checks, "per-bid-cap", input.amount <= s.perBidCap, `${input.amount} <= cap ${s.perBidCap}`);
  const dailyRemaining = Math.max(0, s.dailyCap - input.dailyExposure);
  add(
    checks,
    "daily-cap",
    input.amount <= dailyRemaining,
    `${input.amount} <= remaining daily ${dailyRemaining.toFixed(2)} of ${s.dailyCap}`,
  );
  add(
    checks,
    "storefront-allowed",
    s.allowedSites.length === 0 || s.allowedSites.includes(input.listing.site_abb),
    s.allowedSites.length === 0 ? "all storefronts allowed" : `storefront ${input.listing.site_abb}`,
  );
  add(
    checks,
    "category-allowed",
    !input.listing.category || !s.blockedCategories.includes(input.listing.category),
    `category ${input.listing.category ?? "n/a"}`,
  );
  add(
    checks,
    "manifest-required",
    !s.requireManifest || Boolean(input.listing.manifest),
    s.requireManifest ? "manifest required by settings" : "manifest not required",
  );
  add(
    checks,
    "min-score",
    (input.score ?? 0) >= s.minScore,
    `score ${(input.score ?? 0).toFixed(1)} >= ${s.minScore}`,
  );
  add(
    checks,
    "auction-open",
    !input.auction || (!input.auction.closed && !input.auction.canceled && input.auction.biddingEnabled),
    input.auction ? `closed=${input.auction.closed} canceled=${input.auction.canceled}` : "no live auction state cached",
  );
  add(
    checks,
    "not-ended",
    Number.isFinite(endsMs) && endsMs > input.now.getTime(),
    `ends ${input.listing.ends_at}`,
  );
  const nextMin = input.auction?.nextMinBidAmount ?? (input.listing.next_min_cents ?? 0) / 100;
  add(checks, "meets-minimum", input.amount >= nextMin, `${input.amount} >= next minimum ${nextMin}`);

  const economics = dealEconomics({
    hammer: input.amount,
    retail: input.listing.retail_cents ? input.listing.retail_cents / 100 : null,
    units: input.listing.units,
    pallets: input.listing.pallets,
    recoveryPct: s.recoveryPctDefault,
    cost,
  });
  add(
    checks,
    "roi-floor",
    economics.roi >= s.minRoi,
    `ROI at this bid ${(economics.roi * 100).toFixed(1)}% >= floor ${(s.minRoi * 100).toFixed(1)}%`,
  );

  const maxHammer = maxHammerForRoi(
    {
      retail: input.listing.retail_cents ? input.listing.retail_cents / 100 : null,
      recoveryPct: s.recoveryPctDefault,
      targetRoi: s.targetRoiDefault,
      cost,
    },
    nextMin,
  );
  add(
    checks,
    "target-roi-ceiling",
    input.amount <= maxHammer,
    `${input.amount} <= target-ROI ceiling ${maxHammer.toFixed(2)}`,
  );

  if (input.plan) {
    add(checks, "plan-listing", input.plan.listingId === input.listing.listing_id, "plan bound to listing");
    add(checks, "plan-amount", input.amount <= input.plan.maxAmount, `${input.amount} <= plan max ${input.plan.maxAmount}`);
    add(checks, "plan-single-use", !input.nonceUsed, "plan nonce unused");
  } else {
    add(checks, "plan-present", false, "no plan token supplied");
  }

  add(checks, "armed", input.armed, input.armed ? "operator armed" : "operator did not arm", input.dryRun ? "warning" : "blocker");
  add(
    checks,
    "dry-run-allowed",
    true,
    input.dryRun ? "dry-run: no live side effects" : "live execution requested",
    "warning",
  );
  add(checks, "env-live-flag", input.liveEnabled, "BSTOCK_LIVE=1 required for live bidding");
  add(checks, "bearer-token", input.hasToken, "B-Stock account token present");
  add(checks, "clearance-cookie", input.hasClearance, "Cloudflare clearance present");
  add(checks, "idempotency", !input.duplicateKey, `idempotency key ${input.idempotencyKey}`);
  add(
    checks,
    "closing-window",
    endsMs - input.now.getTime() > 15_000,
    "more than 15s remaining",
    "warning",
  );
  add(
    checks,
    "competition",
    (input.score ?? 100) >= 0,
    "informational",
    "warning",
  );

  const blockers = checks.filter((c) => !c.ok && c.severity === "blocker").map((c) => `${c.name}: ${c.detail}`);
  const warnings = checks.filter((c) => !c.ok && c.severity === "warning").map((c) => `${c.name}: ${c.detail}`);
  return {
    allowed: blockers.length === 0,
    checks,
    blockers,
    warnings,
    limits: {
      perBidCap: s.perBidCap,
      dailyRemaining,
      maxHammerForTargetRoi: maxHammer,
    },
  };
}

export interface ExecuteBidInput {
  listingId: string;
  amount: number;
  planToken: string;
  armed: boolean;
  dryRun: boolean;
  idempotencyKey: string;
  /** Optional override used by tests to simulate the environment flag. */
  liveEnabled?: boolean;
}

export interface ExecuteBidResult {
  status: "blocked" | "dry-run" | "placed" | "duplicate" | "error";
  attemptId?: number;
  guard: GuardResult;
  response?: unknown;
  error?: string;
}

export interface BidExecutorDeps {
  client: BStockClient;
  db: Db;
  settings: () => TradingSettings;
  signer: PlanSigner;
  liveEnabled: boolean;
  now?: () => Date;
}

export class BidExecutor {
  private readonly deps: BidExecutorDeps;

  constructor(deps: BidExecutorDeps) {
    this.deps = deps;
  }

  private now(): Date {
    return (this.deps.now ?? (() => new Date()))();
  }

  /**
   * Mints a plan the operator (or UI) reviews: the maximum amount that may be
   * sent for this listing, bound to a signed, expiring, single-use token.
   */
  plan(listingId: string, requestedMax?: number): { planToken: string; payload: PlanPayload; guard: GuardResult } {
    const { db, signer, settings } = this.deps;
    const now = this.now();
    const row = db.getListing(listingId);
    if (!row) throw new Error(`unknown listing ${listingId}`);
    const auction = db.getAuctionForListing(listingId);
    const s = settings();
    const cost = costModelFrom(s);

    const maxByTargetRoi = maxHammerForRoi(
      {
        retail: row.retail_cents ? row.retail_cents / 100 : null,
        recoveryPct: s.recoveryPctDefault,
        targetRoi: s.targetRoiDefault,
        cost,
      },
      (row.next_min_cents ?? 0) / 100,
    );
    const ceiling = Math.min(s.perBidCap, maxByTargetRoi);
    const amount = Math.round((requestedMax ?? ceiling) * 100) / 100;
    if (amount > ceiling) {
      throw new Error(
        `requested ${amount} exceeds the tighter of per-bid cap (${s.perBidCap}) and target-ROI ceiling (${maxByTargetRoi.toFixed(2)})`,
      );
    }

    const payload: Omit<PlanPayload, "nonce"> = {
      listingId,
      auctionId: auction?._id ?? row.auction_id ?? "",
      amount,
      maxAmount: amount,
      expiresAt: now.getTime() + 10 * 60_000,
    };
    const planToken = signer.issue(payload);
    const verified = signer.verify(planToken, now.getTime());
    const guard = evaluateBid({
      settings: s,
      liveEnabled: this.deps.liveEnabled,
      hasToken: Boolean(this.deps.client.accessToken),
      hasClearance: this.deps.client.transport.hasClearance(),
      now,
      listing: row,
      auction: auction
        ? {
            closed: auction.closed,
            canceled: auction.canceled,
            biddingEnabled: auction.biddingEnabled,
            nextMinBidAmount: auction.nextMinBidAmount,
          }
        : null,
      amount,
      armed: true,
      dryRun: s.mode !== "live",
      dailyExposure: db.dailyExposureCents(dayStart(now).toISOString()),
      score: row.score ?? null,
      plan: verified.ok ? verified.payload : null,
      idempotencyKey: "plan-preview",
      duplicateKey: false,
      nonceUsed: false,
    });

    return { planToken, payload: verified.ok ? verified.payload : { ...payload, nonce: "" }, guard };
  }

  async execute(input: ExecuteBidInput): Promise<ExecuteBidResult> {
    const { client, db, signer, settings } = this.deps;
    const now = this.now();
    const liveEnabled = input.liveEnabled ?? this.deps.liveEnabled;
    const s = settings();

    const row = db.getListing(input.listingId);
    if (!row) throw new Error(`unknown listing ${input.listingId}`);
    const auction = db.getAuctionForListing(input.listingId);
    const verified = signer.verify(input.planToken, now.getTime());
    const duplicate = db.findBidAttempt(input.idempotencyKey);

    const guard = evaluateBid({
      settings: s,
      liveEnabled,
      hasToken: Boolean(client.accessToken),
      hasClearance: client.transport.hasClearance(),
      now,
      listing: row,
      auction: auction
        ? {
            closed: auction.closed,
            canceled: auction.canceled,
            biddingEnabled: auction.biddingEnabled,
            nextMinBidAmount: auction.nextMinBidAmount,
          }
        : null,
      amount: input.amount,
      armed: input.armed,
      dryRun: input.dryRun,
      dailyExposure: db.dailyExposureCents(dayStart(now).toISOString()),
      score: row.score ?? null,
      plan: verified.ok ? verified.payload : null,
      idempotencyKey: input.idempotencyKey,
      duplicateKey: Boolean(duplicate),
      nonceUsed: verified.ok ? !db.isNonceFree(verified.payload.nonce) : true,
    });

    if (duplicate) {
      return { status: "duplicate", attemptId: duplicate.id, guard };
    }
    if (!guard.allowed) {
      db.recordBidAttempt({
        at: now,
        listingId: input.listingId,
        auctionId: auction?._id ?? "",
        amountCents: Math.round(input.amount * 100),
        mode: s.mode,
        status: "blocked",
        request: { amount: input.amount },
        error: guard.blockers.join("; "),
        idempotencyKey: input.idempotencyKey,
      });
      return { status: "blocked", guard };
    }

    if (input.dryRun || s.mode !== "live") {
      db.recordBidAttempt({
        at: now,
        listingId: input.listingId,
        auctionId: auction?._id ?? "",
        amountCents: Math.round(input.amount * 100),
        mode: "dry-run",
        status: "dry-run",
        request: { amount: input.amount },
        response: { simulated: true },
        idempotencyKey: input.idempotencyKey,
      });
      return { status: "dry-run", guard };
    }

    // Live path: consume the plan nonce before the network call so a retry can
    // never double-submit. A failure keeps the audit row and returns the error.
    const payload = (verified as { ok: true; payload: PlanPayload }).payload;
    if (!db.useNonce(payload.nonce, now)) {
      return { status: "blocked", guard: { ...guard, allowed: false, blockers: ["plan already used"] } };
    }

    try {
      const response = await client.placeBid(payload.auctionId || auction!._id, { amount: input.amount });
      db.recordBidAttempt({
        at: now,
        listingId: input.listingId,
        auctionId: payload.auctionId,
        amountCents: Math.round(input.amount * 100),
        mode: "live",
        status: "placed",
        request: { amount: input.amount },
        response,
        idempotencyKey: input.idempotencyKey,
      });
      return { status: "placed", guard, response };
    } catch (err) {
      db.recordBidAttempt({
        at: now,
        listingId: input.listingId,
        auctionId: payload.auctionId,
        amountCents: Math.round(input.amount * 100),
        mode: "live",
        status: "error",
        request: { amount: input.amount },
        error: (err as Error).message,
        idempotencyKey: input.idempotencyKey,
      });
      return { status: "error", guard, error: (err as Error).message };
    }
  }
}

export function dayStart(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}
