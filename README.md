# bstock-command

A local-first buying terminal for pallet resellers who source on B-Stock
(`bstock.com`). It crawls every public auction, ranks them with a transparent
scoring model, and lets the operator execute bids through a guarded, auditable
pipeline — including a dry-run mode that simulates the write without touching
the marketplace.

> **"Smart contracts" clarification.** B-Stock has no on-chain/EVM layer. What
> its frontend calls "contracts" is the `contract.bstock.com` service, which
> manages legal purchase contracts between buyers and sellers. This terminal
> integrates that service read-only (contract listing) and does **not** attempt
> any blockchain interaction. The bid write path is a plain authenticated HTTP
> POST, reverse-engineered below.

## What it does

- **Discovery** — paginated crawl of `search.bstock.com/v1/all-listings/listings`
  with the full filter vocabulary (category, storefront, condition, region,
  pallet/unit ranges, retail/MSRP %, landed-cost %, problem-free rate, closing
  window, distance).
- **Enrichment** — batched auction state from `auction.bstock.com`, enterprise
  (A2Z) storefronts via `bridge.bstock.com`, manifest line items via
  `listing.bstock.com`, full bid history per auction.
- **Analytics** — landed cost (premium + tax + freight + fees), ROI, max
  hammer price for a target ROI, close-price projection, bid velocity, composite
  0–100 score with explainable reasons and risks.
- **Execution** — signed, expiring, single-use plan tokens; a pure guard
  function with 20+ checks; dry-run by default; live bidding additionally gated
  by `BSTOCK_LIVE=1`, an armed toggle, a per-bid cap, a daily capital cap,
  site/category allow-lists, manifest requirements, ROI floors, and a bearer
  token.
- **Audit** — every attempt (blocked, dry-run, placed, error, duplicate) is
  persisted with the request/response and an idempotency key. Daily exposure is
  tracked against the capital cap.
- **UI** — dense ops console: KPI strip, filterable/sortable lot table, detail
  drawer with bid curve, reasons/risks, bid ticket, decision overrides,
  settings, CSV export, SSE updates.

## Architecture

```
apps/server   Fastify API + SQLite (node:sqlite) + AES-256-GCM vault + HMAC plans
packages/client  Typed B-Stock HTTP client (transport, hosts, auth)
packages/analytics  Pure buying math (landed cost, ROI, projection, scoring)
apps/web      React + Vite ops console
mock          Offline simulator reproducing the captured contracts
tests         25 tests: analytics, client, guard, server integration
```

## Reverse-engineering findings

See `docs/RE-FINDINGS.md` for the full host map, endpoint catalogue, auth model,
Cloudflare gating and the bid write contract. Summary:

- 18 service hosts (`hostMap` from the Next.js `__NEXT_DATA__` payload).
- Search: `POST search.bstock.com/v1/all-listings/listings` (body-validated).
- Auction state: `GET auction.bstock.com/v1/auctions?listingId=a,b,c` (batched).
- Bid history: `GET auction.bstock.com/v1/auctions/{id}/bids`.
- **Bid write: `POST auction.bstock.com/v1/auctions/{id}/bids` body `{amount, buyerGroupId?}`**
  with `Authorization: Bearer <fusionauth token>`. Returns 401 `{errorMessage:"Unauthorized"}`
  without a token. Cloudflare-gated.
- Auth: FusionAuth at `auth.bstock.com`, application id `1b094c5f-…`.
- Contracts (legal, not on-chain): `contract.bstock.com/v1/contracts`.

Cloudflare `cf_clearance` + the browser's exact User-Agent are sufficient to
pass bot management for the service hosts; `search.bstock.com` is not challenged
today but receives the same headers.

## Setup

```bash
npm install
npm run typecheck
npm test
npm run build:web
```

Run the offline simulator (no credentials needed):

```bash
MOCK_CF=0 npm run mock        # http://127.0.0.1:8899
```

Run the terminal:

```bash
# optional: point the client at the mock by editing hosts, or use production
BSTOCK_LIVE=0 npm run dev     # API on 127.0.0.1:8788 + built UI
```

Credentials are sealed at rest with AES-256-GCM under `~/.local/share/bstock-command/master.key`
(mode 0600). Store them via `POST /api/credentials`:

```json
{ "clearance": "<cf_clearance value>", "userAgent": "<exact browser UA>", "loginId": "...", "password": "..." }
```

Then `POST /api/session/login` to obtain a bearer token.

## Safety model

- Default mode is `dry-run`. Live bidding requires `BSTOCK_LIVE=1` in the server
  environment **and** `mode=live` in settings **and** the operator arming each bid.
- Every bid passes `evaluateBid` (20+ checks) and a signed plan token bound to
  the exact amount, listing and auction, expiring in 10 minutes, single-use.
- Daily capital exposure is tracked against `dailyCap`.
- All writes are appended to `bid_attempts` with request/response/error and an
  idempotency key.

## Scripts

| script | purpose |
|---|---|
| `npm run dev` | start the API server |
| `npm run dev:web` | Vite dev server (proxies /api) |
| `npm run build` | build web bundle + typecheck |
| `npm run mock` | offline B-Stock simulator |
| `npm test` | vitest (25 tests) |
| `npm run typecheck` | tsc --noEmit |

## CLI flags

`node apps/server/src/main.ts --sync` runs one crawl and exits (cron-friendly).
`--probe` checks clearance/token reachability. `--recompute` recomputes scores.
