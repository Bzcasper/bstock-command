import { Transport, BStockAuthError } from "./http.ts";
export const HOSTS = {
    search: "https://search.bstock.com",
    auctions: "https://auction.bstock.com",
    listings: "https://listing.bstock.com",
    bridge: "https://bridge.bstock.com",
    contracts: "https://contract.bstock.com",
    auth: "https://auth.bstock.com",
    documents: "https://docserv.bstock.com/v1",
    locations: "https://location.bstock.com",
};
/** FusionAuth application id published in `publicEnvVars.PUBLIC_FA_CLIENT_ID`. */
export const FUSIONAUTH_APPLICATION_ID = "1b094c5f-c8a6-416c-8c62-4dc77ca88ce9";
export class BStockClient {
    transport;
    hosts;
    applicationId;
    onToken;
    refreshToken;
    refreshing;
    constructor(options = {}) {
        this.transport = new Transport(options);
        this.hosts = { ...HOSTS, ...options.hosts };
        this.applicationId = options.applicationId ?? FUSIONAUTH_APPLICATION_ID;
        this.onToken = options.onToken;
    }
    get accessToken() {
        return this.transport.accessToken;
    }
    setAccessToken(token) {
        this.transport.setAccessToken(token);
    }
    async login(credentials) {
        const res = await this.transport.request("POST", `${this.hosts.auth}/api/login`, {
            loginId: credentials.loginId,
            password: credentials.password,
            applicationId: credentials.applicationId ?? this.applicationId,
            ...(credentials.tenantId ? { tenantId: credentials.tenantId } : {}),
        });
        const token = res.token ?? res.access_token;
        const refresh = res.refreshToken ?? res.refresh_token;
        if (!token)
            throw new BStockAuthError("POST", `${this.hosts.auth}/api/login`, res);
        this.transport.setAccessToken(token);
        this.refreshToken = refresh;
        this.onToken?.(token, refresh);
        return res;
    }
    /**
     * FusionAuth refresh grant. B-Stock's own frontend refreshes tokens through a
     * Next.js BFF route, but the FusionAuth endpoint is the documented public
     * surface and is what the browser ultimately exchanges against.
     */
    async refreshAccessToken() {
        if (!this.refreshToken)
            return undefined;
        if (!this.refreshing) {
            this.refreshing = (async () => {
                const res = await this.transport.request("POST", `${this.hosts.auth}/api/jwt/refresh`, { refreshToken: this.refreshToken });
                const token = res.token ?? res.access_token;
                if (token) {
                    this.transport.setAccessToken(token);
                    if (res.refreshToken ?? res.refresh_token) {
                        this.refreshToken = res.refreshToken ?? res.refresh_token;
                    }
                    this.onToken?.(token, this.refreshToken);
                }
                return token;
            })().finally(() => {
                this.refreshing = undefined;
            });
        }
        return this.refreshing;
    }
    /** Search the global marketplace. Public: no bearer token required. */
    searchListings(body = {}) {
        return this.transport.request("POST", `${this.hosts.search}/v1/all-listings/listings`, { limit: 20, offset: 0, sortBy: "endTime", sortOrder: "asc", ...body });
    }
    getFilterOptions() {
        return this.transport.request("GET", `${this.hosts.search}/v1/all-listings/listings/filters`);
    }
    /** Batch auction state for up to ~100 listing ids per call. */
    async getAuctions(listingIds) {
        if (listingIds.length === 0)
            return [];
        const out = [];
        for (const chunk of chunked(listingIds, 100)) {
            const qs = chunk.map(encodeURIComponent).join("%2C");
            const res = await this.transport.request("GET", `${this.hosts.auctions}/v1/auctions?listingId=${qs}&limit=100`);
            out.push(...(res.auctions ?? []));
        }
        return out;
    }
    getAuctionByListingId(listingId) {
        return this.transport.request("GET", `${this.hosts.auctions}/v1/auctions/by-listing-id/${encodeURIComponent(listingId)}`);
    }
    getAuctionBids(auctionId, params = {}) {
        const qs = new URLSearchParams();
        if (params.limit !== undefined)
            qs.set("limit", String(params.limit));
        if (params.offset !== undefined)
            qs.set("offset", String(params.offset));
        if (params.sortBy)
            qs.set("sortBy", params.sortBy);
        if (params.sortOrder)
            qs.set("sortOrder", params.sortOrder);
        const suffix = qs.toString() ? `?${qs}` : "";
        return this.transport.request("GET", `${this.hosts.auctions}/v1/auctions/${encodeURIComponent(auctionId)}/bids${suffix}`);
    }
    /** THE write path. Requires a bearer token; 401 `{errorMessage:"Unauthorized"}` otherwise. */
    placeBid(auctionId, body) {
        return this.transport.request("POST", `${this.hosts.auctions}/v1/auctions/${encodeURIComponent(auctionId)}/bids`, body);
    }
    placeBidBatch(bids) {
        return this.transport.request("POST", `${this.hosts.auctions}/v1/auctions/bids/batch`, bids);
    }
    cancelBid(bidId) {
        return this.transport.request("DELETE", `${this.hosts.auctions}/v1/auctions/bids/${encodeURIComponent(bidId)}`);
    }
    buyNow(auctionId, body) {
        return this.transport.request("POST", `${this.hosts.auctions}/v1/auctions/${encodeURIComponent(auctionId)}/buy-now`, body);
    }
    getAccountBids(params) {
        const qs = new URLSearchParams({ accountId: params.accountId });
        if (params.auctionId)
            qs.set("auctionId", params.auctionId);
        if (params.limit !== undefined)
            qs.set("limit", String(params.limit));
        if (params.offset !== undefined)
            qs.set("offset", String(params.offset));
        return this.transport.request("GET", `${this.hosts.auctions}/v1/auctions/bids?${qs}`);
    }
    getExposure(accountId) {
        const qs = new URLSearchParams({ accountId });
        return this.transport.request("GET", `${this.hosts.auctions}/v1/auctions/bids/exposure?${qs}`);
    }
    /** Enterprise / A2Z storefronts use bridge's numeric auction ids. */
    async getEntAuctions(auctionIds) {
        if (auctionIds.length === 0)
            return [];
        const res = await this.transport.request("GET", `${this.hosts.bridge}/v1/ent-auctions?auctionIds=${auctionIds.map(encodeURIComponent).join(",")}`);
        return Array.isArray(res) ? res : (res.auctions ?? []);
    }
    getLot(lotId) {
        return this.transport.request("GET", `${this.hosts.listings}/v1/lots/${encodeURIComponent(lotId)}`);
    }
    getLotItems(lotId, params = {}) {
        const qs = new URLSearchParams();
        qs.set("limit", String(params.limit ?? 25));
        qs.set("offset", String(params.offset ?? 0));
        return this.transport.request("GET", `${this.hosts.listings}/v1/lots/${encodeURIComponent(lotId)}/items?${qs}`);
    }
    getLotGroups(lotId) {
        return this.transport.request("GET", `${this.hosts.listings}/v1/groups?lotId=${encodeURIComponent(lotId)}`);
    }
    /**
     * Purchase contracts (the "contract" service). These are legal purchase
     * agreements, not on-chain/EVM smart contracts — see docs/RE-FINDINGS.md.
     */
    getContracts(params = {}) {
        const qs = new URLSearchParams({
            limit: String(params.limit ?? 25),
            offset: String(params.offset ?? 0),
        });
        return this.transport.request("GET", `${this.hosts.contracts}/v1/contracts?${qs}`);
    }
    /**
     * Live reachability check per gate. Useful before trusting a sync or arming a
     * bid: it separates "Cloudflare rejected the UA/clearance" (403) from "token
     * missing or expired" (401).
     */
    async probe(sampleListingId) {
        const results = [];
        const probeOne = async (host, path, note) => {
            try {
                await this.transport.request("GET", `${host}${path}`, undefined, undefined);
                results.push({ host, path, status: 200, ok: true, note });
            }
            catch (err) {
                const status = err && typeof err === "object" && "status" in err ? Number(err.status) : "network-error";
                results.push({
                    host,
                    path,
                    status: status,
                    ok: false,
                    note,
                });
            }
        };
        await probeOne(this.hosts.search, "/v1/all-listings/listings/filters", "public search");
        const listingId = sampleListingId ?? "6ae9e891cf9500c824baa77a";
        await probeOne(this.hosts.auctions, `/v1/auctions?listingId=${encodeURIComponent(listingId)}`, "auction state (needs clearance)");
        await probeOne(this.hosts.auctions, "/v1/auctions/bids/exposure?accountId=probe", "account exposure (needs bearer token)");
        return results;
    }
}
function chunked(items, size) {
    const out = [];
    for (let i = 0; i < items.length; i += size)
        out.push(items.slice(i, i + size));
    return out;
}
export { Transport, BStockApiError, BStockAuthError, BStockNetworkError, BROWSER_UA } from "./http.ts";
export * from "./types.ts";
