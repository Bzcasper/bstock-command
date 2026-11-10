/**
 * Wire types for the B-Stock marketplace APIs.
 *
 * Every shape here was derived from live captures of the production frontend
 * (bstock.com, build 55.5.3) and its service hosts; see docs/RE-FINDINGS.md.
 * Optional fields are optional on the wire: the backend omits empty arrays for
 * some storefronts and always omits `auctionId` on enterprise (A2Z) listings.
 */
export {};
