/**
 * HTTP transport for the B-Stock service hosts.
 *
 * Two independent gates guard these APIs:
 *  1. Cloudflare bot management. `auction`, `listing`, `bridge`, `contract` and
 *     most other service hosts reject requests whose UA does not match the
 *     browser that solved the challenge. Reusing the browser's `cf_clearance`
 *     cookie together with its exact User-Agent is sufficient (verified).
 *     `search.bstock.com` is not challenge-protected today but is sent the same
 *     headers for consistency.
 *  2. FusionAuth bearer tokens, required only for the account-scoped writes
 *     (bidding, buy-now, watchlists, contracts, orders).
 */
export const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36";
export class BStockApiError extends Error {
    status;
    method;
    url;
    body;
    constructor(status, method, url, body) {
        const detail = body && typeof body === "object" && "errorMessage" in body
            ? String(body.errorMessage)
            : typeof body === "string"
                ? body.slice(0, 200)
                : "";
        super(`B-Stock ${method} ${url} -> ${status}${detail ? `: ${detail}` : ""}`);
        this.name = "BStockApiError";
        this.status = status;
        this.method = method;
        this.url = url;
        this.body = body;
    }
}
export class BStockAuthError extends BStockApiError {
    constructor(method, url, body) {
        super(401, method, url, body);
        this.name = "BStockAuthError";
    }
}
export class BStockNetworkError extends Error {
    cause;
    constructor(message, cause) {
        super(message);
        this.name = "BStockNetworkError";
        this.cause = cause;
    }
}
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
export class Transport {
    opts;
    fetchImpl;
    now;
    sleep;
    tokens;
    lastRefill;
    constructor(options = {}) {
        this.opts = {
            userAgent: options.userAgent ?? BROWSER_UA,
            timeoutMs: options.timeoutMs ?? 20_000,
            maxRetries: options.maxRetries ?? 3,
            ratePerSecond: options.ratePerSecond ?? 8,
            ...options,
        };
        this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
        this.now = options.now ?? (() => Date.now());
        this.sleep = options.sleep ?? defaultSleep;
        this.tokens = this.opts.ratePerSecond;
        this.lastRefill = this.now();
    }
    get accessToken() {
        return this.opts.accessToken;
    }
    setAccessToken(token) {
        this.opts.accessToken = token;
    }
    setClearance(clearance) {
        this.opts.clearance = clearance;
    }
    setUserAgent(ua) {
        this.opts.userAgent = ua;
    }
    hasClearance() {
        return Boolean(this.opts.clearance);
    }
    async acquire() {
        // Token bucket. Refill is computed from elapsed time so the transport stays
        // deterministic under an injected clock in tests.
        const rate = this.opts.ratePerSecond;
        const now = this.now();
        const elapsed = Math.max(0, now - this.lastRefill) / 1000;
        this.tokens = Math.min(rate, this.tokens + elapsed * rate);
        this.lastRefill = now;
        if (this.tokens < 1) {
            const waitMs = Math.ceil(((1 - this.tokens) / rate) * 1000);
            await this.sleep(waitMs);
            this.tokens = 0;
            this.lastRefill = this.now();
        }
        else {
            this.tokens -= 1;
        }
    }
    headers(extra = {}) {
        const headers = {
            "User-Agent": this.opts.userAgent,
            Accept: "application/json, text/plain, */*",
            Origin: "https://bstock.com",
            Referer: "https://bstock.com/",
            ...this.opts.defaultHeaders,
            ...extra,
        };
        if (this.opts.clearance)
            headers.Cookie = `cf_clearance=${this.opts.clearance}`;
        if (this.opts.accessToken)
            headers.Authorization = `Bearer ${this.opts.accessToken}`;
        return headers;
    }
    async request(method, url, body, extraHeaders = {}) {
        let attempt = 0;
        let lastError;
        while (attempt <= this.opts.maxRetries) {
            attempt += 1;
            await this.acquire();
            const started = this.now();
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
            try {
                const res = await this.fetchImpl(url, {
                    method,
                    headers: this.headers({
                        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
                        ...extraHeaders,
                    }),
                    body: body === undefined ? undefined : JSON.stringify(body),
                    signal: controller.signal,
                });
                const text = await res.text();
                let parsed = text;
                if (text) {
                    try {
                        parsed = JSON.parse(text);
                    }
                    catch {
                        parsed = text;
                    }
                }
                else {
                    parsed = null;
                }
                if (res.ok)
                    return parsed;
                if (res.status === 401)
                    throw new BStockAuthError(method, url, parsed);
                if ((res.status === 429 || res.status >= 500) && attempt <= this.opts.maxRetries) {
                    lastError = new BStockApiError(res.status, method, url, parsed);
                    await this.sleep(250 * 2 ** (attempt - 1) + Math.floor(Math.random() * 100));
                    continue;
                }
                throw new BStockApiError(res.status, method, url, parsed);
            }
            catch (err) {
                if (err instanceof BStockApiError) {
                    if (err instanceof BStockAuthError)
                        throw err;
                    if (attempt > this.opts.maxRetries)
                        throw err;
                    lastError = err;
                    continue;
                }
                const isAbort = err instanceof Error && err.name === "AbortError";
                lastError = isAbort ? new BStockNetworkError(`timeout after ${this.opts.timeoutMs}ms`, err) : err;
                if (attempt > this.opts.maxRetries)
                    throw lastError;
                await this.sleep(250 * 2 ** (attempt - 1));
            }
            finally {
                clearTimeout(timer);
            }
        }
        throw lastError instanceof Error ? lastError : new BStockNetworkError("request failed");
    }
}
