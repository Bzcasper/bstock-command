const BASE = (import.meta as { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE ?? "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
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
  status: () => request<any>("/status"),
  settings: () => request<any>("/settings"),
  saveSettings: (patch: unknown) => request<any>("/settings", { method: "PUT", body: JSON.stringify(patch) }),
  listings: (params: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    }
    return request<{ count: number; listings: ListingRow[]; facets: { categories: { category: string; count: number }[]; sites: { site_abb: string; count: number }[] } }>(
      `/listings?${qs}`,
    );
  },
  listing: (id: string) => request<any>(`/listings/${id}`),
  setDecision: (id: string, body: unknown) => request<any>(`/listings/${id}/decision`, { method: "PUT", body: JSON.stringify(body) }),
  watch: (id: string, note?: string) => request<any>(`/listings/${id}/watch`, { method: "POST", body: JSON.stringify({ note }) }),
  unwatch: (id: string) => request<any>(`/listings/${id}/watch`, { method: "DELETE" }),
  sync: (body: unknown) => request<any>("/sync", { method: "POST", body: JSON.stringify(body) }),
  plan: (listingId: string, maxAmount?: number) =>
    request<any>("/bid/plan", { method: "POST", body: JSON.stringify({ listingId, maxAmount }) }),
  execute: (body: unknown) => request<any>("/bid/execute", { method: "POST", body: JSON.stringify(body) }),
  bids: () => request<any>("/bids"),
  probe: () => request<any>("/session/probe", { method: "POST" }),
  credentials: (body: unknown) => request<any>("/credentials", { method: "POST", body: JSON.stringify(body) }),
  login: (body: unknown) => request<any>("/session/login", { method: "POST", body: JSON.stringify(body) }),
  exportCsv: () => `${BASE}/export.csv`,
};
