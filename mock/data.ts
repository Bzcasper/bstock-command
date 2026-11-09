/**
 * Deterministic synthetic marketplace modelled on real captured payloads.
 * One template (a real Target/`TMP` listing) is cloned with varied economics so
 * scoring, sorting and paging have something meaningful to chew on offline.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AuctionState, BidRecord, Listing } from "@bstock/client";

export interface MockListing {
  listing: Listing;
  auction: AuctionState;
  bids: BidRecord[];
}

const here = import.meta.dirname;
const template = JSON.parse(readFileSync(path.join(here, "fixtures/listing-template.json"), "utf8")) as Listing;

export const filterFacets = JSON.parse(readFileSync(path.join(here, "fixtures/filters.json"), "utf8"));

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SITES = ["TMP", "AMZ", "WMT", "HD", "BBY", "LOW", "AMZE", "BJS"];
const CATEGORIES = [
  "Mixed Lots",
  "Electronics",
  "Home & Garden",
  "Cell Phones",
  "Small Appliances",
  "Tools",
  "Toys Kids & Baby",
  "Apparel Shoes & Accessories",
  "Furniture",
  "Sports & Outdoors",
];
const CITIES = ["Orangeburg, SC", "Dallas, TX", "Ontario, CA", "Atlanta, GA", "Joliet, IL", "Bethlehem, PA"];

const round2 = (n: number) => Math.round(n * 100) / 100;

function incrementFor(amount: number): number {
  if (amount < 500) return 25;
  if (amount < 2_000) return 50;
  if (amount < 10_000) return 100;
  return 250;
}

export function buildMarketplace(now: Date, count = 48, seed = 20261108): MockListing[] {
  const rand = mulberry32(seed);
  const out: MockListing[] = [];

  for (let i = 0; i < count; i += 1) {
    const site = SITES[i % SITES.length];
    const category = CATEGORIES[Math.floor(rand() * CATEGORIES.length)];
    const pallets = 1 + Math.floor(rand() * 39);
    const units = Math.max(12, Math.floor(pallets * (12 + rand() * 60)));
    const retail = round2(pallets * (3_000 + rand() * 42_000));
    const hoursToEnd = round2(1 + rand() * 119);
    const endsAt = new Date(now.getTime() + hoursToEnd * 3600_000).toISOString();
    const startsAt = new Date(now.getTime() - Math.floor(rand() * 48) * 3600_000).toISOString();
    const numberOfBids = Math.floor(rand() * 46);
    const startPrice = rand() > 0.5 ? 100 : 500;
    const increment = incrementFor(startPrice);
    const current = numberOfBids === 0 ? null : round2(startPrice + numberOfBids * increment * (0.6 + rand() * 0.9));

    const listingId = `mock${String(i).padStart(6, "0")}`;
    const auctionId = `mockauc${String(i).padStart(6, "0")}`;
    const lotId = `mocklot${String(i).padStart(6, "0")}`;

    const listing: Listing = {
      ...template,
      listingId,
      lotId,
      auctionId,
      auctionUrl: `https://bstock.com/buy/listings/details/${listingId}`,
      siteAbb: site,
      title:
        site === "AMZE"
          ? `${pallets} Pallets of ${category}, ${units} Pieces, Customer Returns, DE Stock`
          : `${pallets} Pallets of ${category} — ${units} Units, Customer Returns, ${CITIES[i % CITIES.length]}`,
      categories: [category],
      lotCategories: [{ category, percentageByQuantity: 100, percentageByRetailValue: 100 }],
      category: undefined,
      condition: [rand() > 0.4 ? "Used Good" : "New"],
      displayedCondition: rand() > 0.4 ? "Used Good" : "New",
      palletCount: pallets,
      units,
      retailPrice: retail,
      biddingStartTime: startsAt,
      endTime: endsAt,
      numberOfBids,
      winningBidAmount: current,
      currentBid: current,
      nextMinBidAmount: round2((current ?? startPrice) + increment),
      manifest: rand() > 0.25,
      problemFreeOrderRate: round2(0.62 + rand() * 0.36),
      region: CITIES[i % CITIES.length],
      sellerCity: CITIES[i % CITIES.length].split(",")[0],
      primaryImageUrl: template.primaryImageUrl,
      listingType: "SPOT",
      bidBasis: "PRICE",
      currency: "USD",
    } as Listing;

    const auction: AuctionState = {
      _id: auctionId,
      listingId,
      actualEndTime: endsAt,
      biddingEnabled: true,
      buyingFormatSequence: "AUCTION",
      startPrice,
      buyNow: { enabled: false },
      closed: false,
      canceled: false,
      nextMinBidAmount: listing.nextMinBidAmount as number,
      bidPrecision: 1,
      winningBidAmount: current,
      numberOfBids,
    };

    const bids: BidRecord[] = [];
    if (numberOfBids > 0) {
      const bidders = 1 + Math.floor(rand() * 5);
      const spanMs = Math.max(1, now.getTime() - Date.parse(startsAt));
      for (let b = 0; b < numberOfBids; b += 1) {
        const t = Date.parse(startsAt) + (spanMs * (b + 1)) / (numberOfBids + 1);
        bids.push({
          createdAt: new Date(t).toISOString(),
          bidAmount: round2(startPrice + (b + 1) * increment * (0.6 + rand() * 0.9)),
          uniqueId: `bidder-${(i + b) % bidders}-${bidders}`,
          winning: b === numberOfBids - 1,
          userBid: false,
          currency: "USD",
        });
      }
    }

    out.push({ listing, auction, bids });
  }
  return out;
}
