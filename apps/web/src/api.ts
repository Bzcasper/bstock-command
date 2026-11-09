const BASE = (import.meta as { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE ?? "";

export const isStaticMode = BASE === "";

const WATCH_KEY = "bstock_watched_lots";
export function getLocalWatched(): Set<string> {
  try {
    const raw = localStorage.getItem(WATCH_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

export function setLocalWatched(id: string, watch: boolean) {
  try {
    const s = getLocalWatched();
    if (watch) s.add(id);
    else s.delete(id);
    localStorage.setItem(WATCH_KEY, JSON.stringify([...s]));
  } catch {}
}

function toUrl(path: string): string {
  const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
  if (BASE) return BASE + path;
  // Static (CI-generated) data mode: map /api/* to <base>/data/*.json
  const mapped = path
    .replace(/^\/api/, "/data")
    .replace(/\/listings(\?.*)?$/, (m) => m.replace("/listings", "/listings.json"))
    .replace(/\/status(\?.*)?$/, (m) => m.replace("/status", "/status.json"))
    .replace(/\/bids(\?.*)?$/, (m) => m.replace("/bids", "/bids.json"));
  return base + mapped;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(toUrl(path), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in (body as Record<string, unknown>)
        ? String((body as Record<string, unknown>).error)
        : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return body as T;
}

export interface ListingRow {
  listingId: string;
  lotId: string;
  auctionId: string | null;
  site: string;
  title: string | null;
  category: string | null;
  condition: string | null;
  pallets: number | null;
  units: number | null;
  retail: number | null;
  currency: string;
  endsAt: string;
  startsAt: string | null;
  bids: number;
  currentBid: number | null;
  nextMinBid: number | null;
  manifest: boolean;
  listingType: string;
  bidBasis: string;
  region: string | null;
  sellerCity: string | null;
  problemFree: number | null;
  imageUrl: string | null;
  galleryImages?: string[] | null;
  opportunityTier?: "ALPHA_GEM" | "SOLID_VALUE" | "SLEEPER_SNIPE" | "SPECULATIVE" | "AVOID" | null;
  funnelStage?: "ingested" | "viable" | "pattern_approved" | "alpha_ranked" | null;
  recommendedBid?: number | null;
  kellyFraction?: number | null;
  score: number | null;
  projected: number | null;
  roi: number | null;
  maxHammer: number | null;
  costToRetail: number | null;
  costPerPallet: number | null;
  bidsPerHour: number | null;
  uniqueBidders: number | null;
  reasons: string[];
  risks: string[];
  watched: boolean;
  note: string | null;
  computedAt: string | null;
}

export const api = {
  status: () => isStaticMode ? request<any>("/api/status") : request<any>("/api/status"),
  settings: () =>
    isStaticMode
      ? Promise.resolve({
          mode: "static",
          perBidCap: 10000,
          dailyCap: 40000,
          minScore: 0,
          minRoi: 0.15,
          recoveryPctDefault: 0.4,
          targetRoiDefault: 0.3,
          buyerPremiumPct: 0.125,
          taxPct: 0,
          shippingDefault: 0,
          otherFeesDefault: 0,
          allowedSites: [],
          blockedCategories: [],
          requireManifest: false,
        })
      : request<any>("/api/settings"),
  saveSettings: (patch: unknown) =>
    isStaticMode
      ? Promise.resolve({ ...(typeof patch === "object" && patch !== null ? patch : {}), saved: true })
      : request<any>("/api/settings", { method: "PUT", body: JSON.stringify(patch) }),
  listings: async (params: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    }
    const q = qs.toString();
    const data = await request<{ count: number; listings: ListingRow[]; facets: { categories: { category: string; count: number }[]; sites: { site_abb: string; count: number }[] } }>(
      `/api/listings${q ? `?${q}` : ""}`,
    );
    if (isStaticMode && data?.listings) {
      const watchedSet = getLocalWatched();
      data.listings = data.listings.map((l) => ({
        ...l,
        watched: watchedSet.has(l.listingId) || l.watched,
      }));
    }
    return data;
  },
  listing: async (id: string) => {
    if (isStaticMode) {
      const data = await request<{ listings: ListingRow[] }>("/data/listings.json");
      const match = data.listings?.find((l) => l.listingId === id);
      if (!match) throw new Error("Listing not found");
      const baseBid = match.currentBid ?? 200;
      return {
        listing: match,
        economics: {
          retail: match.retail,
          currentBid: match.currentBid,
          maxHammer: match.maxHammer,
          roi: match.roi,
          costToRetail: match.costToRetail,
          costPerPallet: match.costPerPallet,
        },
        projected: { projected: match.projected },
        maxHammer: match.maxHammer,
        velocity: { uniqueBidders: match.uniqueBidders ?? 3, bidsPerHour: match.bidsPerHour ?? 1.2 },
        bids: [
          { createdAt: new Date(Date.now() - 3600000 * 4).toISOString(), bidAmount: Math.round(baseBid * 0.65), winning: false },
          { createdAt: new Date(Date.now() - 3600000 * 2.5).toISOString(), bidAmount: Math.round(baseBid * 0.8), winning: false },
          { createdAt: new Date(Date.now() - 3600000 * 1).toISOString(), bidAmount: Math.round(baseBid * 0.92), winning: false },
          { createdAt: new Date(Date.now() - 1800000).toISOString(), bidAmount: baseBid, winning: true },
        ],
      };
    }
    return request<any>(`/api/listings/${id}`);
  },
  setDecision: (id: string, body: unknown) =>
    isStaticMode
      ? Promise.resolve({ ok: true, id, decision: body })
      : request<any>(`/api/listings/${id}/decision`, { method: "PUT", body: JSON.stringify(body) }),
  watch: (id: string, note?: string) => {
    if (isStaticMode) {
      setLocalWatched(id, true);
      return Promise.resolve({ ok: true, watched: true });
    }
    return request<any>(`/api/listings/${id}/watch`, { method: "POST", body: JSON.stringify({ note }) });
  },
  unwatch: (id: string) => {
    if (isStaticMode) {
      setLocalWatched(id, false);
      return Promise.resolve({ ok: true, watched: false });
    }
    return request<any>(`/api/listings/${id}/watch`, { method: "DELETE" });
  },
  sync: (body: unknown) =>
    isStaticMode
      ? Promise.resolve({ mode: "static", refreshedAt: new Date().toISOString() })
      : request<any>("/api/sync", { method: "POST", body: JSON.stringify(body) }),
  plan: (listingId: string, maxAmount?: number) => {
    if (isStaticMode) {
      return Promise.resolve({
        planToken: `sim-plan-${listingId}-${Date.now()}`,
        listingId,
        maxAmount: maxAmount ?? 500,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      });
    }
    return request<any>("/api/bid/plan", { method: "POST", body: JSON.stringify({ listingId, maxAmount }) });
  },
  execute: (body: unknown) => {
    if (isStaticMode) {
      return Promise.resolve({
        status: "dry-run",
        message: "Simulation mode active: guarded plan verified and dry run placed.",
        timestamp: new Date().toISOString(),
        payload: body,
      });
    }
    return request<any>("/api/bid/execute", { method: "POST", body: JSON.stringify(body) });
  },
  bids: () => request<any>("/api/bids"),
  probe: () => request<any>("/api/session/probe", { method: "POST" }),
  credentials: (body: unknown) => request<any>("/api/credentials", { method: "POST", body: JSON.stringify(body) }),
  login: (body: unknown) => request<any>("/api/session/login", { method: "POST", body: JSON.stringify(body) }),
  exportCsv: () => (BASE ? BASE : "") + "/api/export.csv",
  storageStatus: () => request<any>("/api/storage/status"),
  storageSync: () => request<any>("/api/storage/sync", { method: "POST" }),
  storageBackup: () => request<any>("/api/storage/backup", { method: "POST" }),
  storageRestore: () => request<any>("/api/storage/restore", { method: "POST" }),
  scraplingStatus: () => request<any>("/api/scraper/status"),
  solveClearance: (targetUrl?: string) => request<any>("/api/scraper/solve-clearance", { method: "POST", body: JSON.stringify({ targetUrl }) }),
  scrapeLot: (urlOrId: string, listingId?: string) => request<any>("/api/scraper/scrape-lot", { method: "POST", body: JSON.stringify({ urlOrId, listingId }) }),
  cacheListingImage: (listingId: string) => request<any>("/api/images/cache-listing", { method: "POST", body: JSON.stringify({ listingId }) }),
  funnelListings: (params: Record<string, string | number | undefined> = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    }
    const q = qs.toString();
    return request<any>(`/api/funnel/listings${q ? `?${q}` : ""}`);
  },
};
