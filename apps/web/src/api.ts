const BASE = (import.meta as { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE ?? "";

export const isStaticMode = BASE === "";

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
  saveSettings: (patch: unknown) => request<any>("/api/settings", { method: "PUT", body: JSON.stringify(patch) }),
  listings: (params: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    }
    const q = qs.toString();
    return request<{ count: number; listings: ListingRow[]; facets: { categories: { category: string; count: number }[]; sites: { site_abb: string; count: number }[] } }>(
      `/api/listings${q ? `?${q}` : ""}`,
    );
  },
  listing: (id: string) => request<any>(`/api/listings/${id}`),
  setDecision: (id: string, body: unknown) => request<any>(`/api/listings/${id}/decision`, { method: "PUT", body: JSON.stringify(body) }),
  watch: (id: string, note?: string) => request<any>(`/api/listings/${id}/watch`, { method: "POST", body: JSON.stringify({ note }) }),
  unwatch: (id: string) => request<any>(`/api/listings/${id}/watch`, { method: "DELETE" }),
  sync: (body: unknown) => request<any>("/api/sync", { method: "POST", body: JSON.stringify(body) }),
  plan: (listingId: string, maxAmount?: number) =>
    request<any>("/api/bid/plan", { method: "POST", body: JSON.stringify({ listingId, maxAmount }) }),
  execute: (body: unknown) => request<any>("/api/bid/execute", { method: "POST", body: JSON.stringify(body) }),
  bids: () => request<any>("/api/bids"),
  probe: () => request<any>("/api/session/probe", { method: "POST" }),
  credentials: (body: unknown) => request<any>("/api/credentials", { method: "POST", body: JSON.stringify(body) }),
  login: (body: unknown) => request<any>("/api/session/login", { method: "POST", body: JSON.stringify(body) }),
  exportCsv: () => (BASE ? BASE : "") + "/api/export.csv",
  storageStatus: () => request<any>("/api/storage/status"),
  storageSync: () => request<any>("/api/storage/sync", { method: "POST" }),
  storageBackup: () => request<any>("/api/storage/backup", { method: "POST" }),
  storageRestore: () => request<any>("/api/storage/restore", { method: "POST" }),
};
