# Reverse-engineering findings: B-Stock marketplace

Captured from `bstock.com` build `55.5.3` (2026-11-08) by driving a real Chrome
instance through the public listing pages and recording every network request.
All shapes below are taken from live responses, not from documentation (B-Stock
publishes none for these endpoints).

## Service host map

From `__NEXT_DATA__.props.pageProps.hostMap`:

| key | host |
|---|---|
| `search` | `https://search.bstock.com` |
| `auctions` | `https://auction.bstock.com` |
| `listings` | `https://listing.bstock.com` |
| `bridge` | `https://bridge.bstock.com` |
| `contracts` | `https://contract.bstock.com` |
| `auth` | `https://auth.bstock.com` (FusionAuth) |
| `docserv` | `https://docserv.bstock.com/v1` |
| `locations` | `https://location.bstock.com` |
| `accounts` | `https://account.bstock.com` |
| `personalization` | `https://buyer-personalization.bstock.com` |
| `transactions` | `https://payments-transactions.bstock.com` |
| `paymethods` | `https://payments-methods.bstock.com` |
| `ingestion` | `https://ingestion.bstock.com` |
| `second-chance` | `https://second-chance.bstock.com` |
| `risk` | `https://risk.bstock.com` |
| `disputes` | `https://dispute.bstock.com` |
| `subscriptions` | `https://subscription.bstock.com` |
| `orders` | `https://order.bstock.com` |
| `shipments` | `https://shipment.bstock.com` |
| `erp` | `https://erp.bstock.com` |

## Endpoints used by this terminal

### Search (public, Cloudflare-light)

`POST /v1/all-listings/listings` — body:

```json
{ "limit": 80, "offset": 0, "sortBy": "endTime", "sortOrder": "asc",
  "categories": ["Mixed Lots"], "storefront": ["69791476…-Ace Hardware"],
  "condition": ["New"], "minBidValue": 0, "maxBidValue": 5000,
  "minUnits": 1, "maxUnits": 5000, "listingType": ["SPOT"],
  "manifest": true, "minRetailPrice": 0, "maxRetailPrice": 100000,
  "maxPercentMsrp": 0.5, "maxLandedCostPercentMsrp": 0.4,
  "minProblemFreeOrderRate": 0.85, "region": ["/US/SC"],
  "warehouseLocation": ["US/SC/Orangeburg"], "q": "faucet",
  "minEndTime": "…", "maxEndTime": "…",
  "distanceRange": { "distance": 100, "coordinates": {"lat":..,"long":..}, "zipCode": "…" },
  "currentBidRanges": [null, null], "msrp": [null, null], "units": [null, null],
  "endTimeRange": [null, null], "closesIn": "24h", "bidStatus": "open",
  "myBids": false, "eligibleOnly": true, "starterLots": false,
  "isCreditCardEnabled": true, "transportMode": ["LTL"], "allowedShipmentTypes": ["BINDING"],
  "categoryThreshold": null, "msrpPercentage": null, "landedCostPercentage": null,
  "problemFreeOrderRate": null, "category": [] }
```

The server validates strictly: unknown keys / bad `sortBy` → `400 {errorMessage:"body validation errors", messages:[…]}`.

`GET /v1/all-listings/listings/filters` — facet counts for every filter dimension
(categories, storefront, shipmentType, transportMode, listingType, inventoryType,
manufacturer, productType, model, capacity, carrier, deals, bstockGrade, memory,
isCreditCardEnabled, buyingFormat, condition, region, warehouseLocation).

### Auctions (Cloudflare-gated, batched up to ~100 ids)

`GET /v1/auctions?listingId=id1,id2,…&limit=100` → `{auctions:[{…}], total, offset, limit}`.

`GET /v1/auctions/by-listing-id/{listingId}` → single state.

`GET /v1/auctions/{id}/bids?limit=&offset=&sortBy=&sortOrder=` →
`{uniqueBidders, numberOfBids, bids:[{createdAt, bidAmount, uniqueId, winning, userBid, currency}]}`.

`POST /v1/auctions/{id}/bids` body `{amount, buyerGroupId?}` → write path.
Requires `Authorization: Bearer <token>`; without it: `401 {errorMessage:"Unauthorized"}`.

`POST /v1/auctions/{id}/buy-now` body `{amount}`.
`DELETE /v1/auctions/bids/{id}` cancel a bid.
`GET /v1/auctions/bids?accountId=&auctionId=&limit=&offset=` account bids.
`GET /v1/auctions/bids/exposure?accountId=` total exposure.
`GET /v1/auctions/bids/unique` / `…/unique/count`.

### Listings / lots (Cloudflare-gated)

`GET /v1/lots/{id}` → lot metadata.
`GET /v1/lots/{id}/items?limit=&offset=` → manifest line items.
`GET /v1/groups?lotId=` → pallet groups.
`GET /v1/listings`, `GET /v1/listings/{id}`.

### Enterprise / A2Z storefronts (bridge host)

`GET /v1/ent-auctions?auctionIds=a2z59391,…` → array of enterprise auctions with
`buyerBidStatus` (`HAS_NOT_BID` etc.). These listings have `auctionId: null` and
publish the numeric id inside `auctionUrl` (`/auction/view/id/59391`).

### Contracts (legal purchase agreements, not on-chain)

`GET /v1/contracts`, `GET /v1/contracts/{id}`, `PATCH/PUT`, `POST /{id}/status`.

### Auth (FusionAuth)

`POST /auth.bstock.com/api/login` body `{loginId, password, applicationId}`.
Application id (public): `1b094c5f-c8a6-416c-8c62-4dc77ca88ce9`.
`POST /api/jwt/refresh` body `{refreshToken}`.

### Location / tax / exemptions

`GET /v1/exemption-requirements/{country}` and `…/{country}/{region}`.
`GET /v1/canadian-tax/listings/{id}/max-exposure`, `…/running-estimate`.
`GET /v1/eu-tax/listings/{id}/max-exposure`, `…/running-estimate`.

### Accounts, orders, shipments, disputes, offers, methods, entities

Standard REST surfaces under `/v1/…` on `account`, `order`, `shipment`,
`dispute`, `offerings`/`offers`, `methods`, `entities`, `transactions`,
`quotes`, `fixed-terms`, `inventories-summary`, `facility-metrics`.

## Auth model

Two independent gates:

1. **Cloudflare bot management.** The `auction`, `listing`, `bridge`, `contract`
   and most other service hosts reject requests without a valid `cf_clearance`
   cookie obtained by solving the JS challenge in a real browser. Replaying the
   cookie together with the **exact** User-Agent string of the browser that
   solved it is sufficient (verified). `search.bstock.com` is not challenged
   today but receives the same headers.

2. **FusionAuth bearer tokens.** Required only for the account-scoped writes
   (bidding, buy-now, watchlists, contracts, orders). The frontend obtains them
   via `auth.bstock.com/api/login` and refreshes via `/api/jwt/refresh`.

## Cloudflare-gated hosts

Everything except `search.bstock.com` and the third-party analytics/CDN hosts.
`location.bstock.com` is inconsistently gated (observed 200 without clearance
for some paths).

## Notes

- B-Stock has no blockchain or EVM layer anywhere in its frontend or network
  traffic. "Contracts" = legal purchase contracts.
- `nextMinBidAmount` in the auction state is the authoritative minimum for the
  next bid; the search payload's `nextMinBidAmount` is a stale-ish mirror.
- Enterprise (A2Z) storefronts use numeric auction ids and the bridge host.
- Bid history `uniqueId` is a stable per-bidder proxy hash, so bidder counts
  and competition pressure can be computed without identities.
