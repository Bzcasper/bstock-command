/**
 * Wire types for the B-Stock marketplace APIs.
 *
 * Every shape here was derived from live captures of the production frontend
 * (bstock.com, build 55.5.3) and its service hosts; see docs/RE-FINDINGS.md.
 * Optional fields are optional on the wire: the backend omits empty arrays for
 * some storefronts and always omits `auctionId` on enterprise (A2Z) listings.
 */

export type SortBy =
  | "endTime"
  | "startTime"
  | "numberOfBids"
  | "winningBidAmount"
  | "relevance"
  | "recommended"
  | "personalization";

export type SortOrder = "asc" | "desc";

export type BuyingFormat = "AUCTION" | "BUY_NOW" | "BINO_TO_AUCTION";

export type ListingType = "SPOT" | "CONTRACT";

/** Filter facet value as returned by /v1/all-listings/listings/filters. */
export interface FacetValue {
  count: number;
  value: string | boolean;
  position?: string[];
}

export interface FilterOptions {
  categories: FacetValue[];
  storefront: FacetValue[];
  shipmentType: FacetValue[];
  transportMode: FacetValue[];
  allowedShipmentTypes: FacetValue[];
  listingType: FacetValue[];
  inventoryType: FacetValue[];
  manufacturer: FacetValue[];
  productType: FacetValue[];
  model: FacetValue[];
  capacity: FacetValue[];
  carrier: FacetValue[];
  deals: FacetValue[];
  bstockGrade: FacetValue[];
  memory: FacetValue[];
  isCreditCardEnabled: FacetValue[];
  buyingFormat: FacetValue[];
  category: FacetValue[];
  condition: FacetValue[];
  region: FacetValue[];
  warehouseLocation: FacetValue[];
}

/**
 * Search body. The server validates strictly (400 + `messages[]`), so unknown
 * keys are a hard error. `sortBy` accepts the SortBy union only.
 */
export interface SearchRequest {
  limit?: number;
  offset?: number;
  sortBy?: SortBy;
  sortOrder?: SortOrder;
  q?: string;
  categories?: string[];
  category?: string[];
  storefront?: string[];
  storeFrontId?: string[];
  condition?: string[];
  inventoryType?: string[];
  productType?: string[];
  manufacturer?: string[];
  model?: string[];
  capacity?: string[];
  memory?: string[];
  carrier?: string[];
  sellerGrade?: string[];
  deals?: string[];
  starterLots?: boolean;
  isCreditCardEnabled?: boolean;
  eligibleOnly?: boolean;
  myBids?: boolean;
  bidStatus?: string;
  closesIn?: string;
  listingType?: ListingType[];
  buyingFormat?: BuyingFormat[];
  transportMode?: string[];
  allowedShipmentTypes?: string[];
  region?: string[];
  warehouseLocation?: string[];
  minEndTime?: string;
  maxEndTime?: string;
  minBidValue?: number;
  maxBidValue?: number;
  minRetailPrice?: number;
  maxRetailPrice?: number;
  maxPercentMsrp?: number;
  maxLandedCostPercentMsrp?: number;
  minUnits?: number;
  maxUnits?: number;
  minProblemFreeOrderRate?: number;
  categoryThreshold?: number | null;
  distanceRange?: { distance: number; coordinates: { lat: number; long: number }; zipCode: string | null };
}

export interface LotCategoryShare {
  category: string;
  percentageByQuantity: number;
  percentageByRetailValue: number;
}

/** One row of POST /v1/all-listings/listings. */
export interface Listing {
  listingId: string;
  lotId: string;
  /** Null for enterprise (A2Z) storefronts, which use the numeric id in auctionUrl. */
  auctionId: string | null;
  auctionUrl: string;
  sellerId: string;
  sellerLotId: string[];
  sellerCity?: string;
  sellerZipCode?: string;
  region: string;
  countryCode: string;
  provinceCode?: string;
  currency: string;
  siteAbb: string;
  siteLogoUrl?: string;
  title?: string;
  listingType: ListingType;
  pricingStrategy: string;
  buyingFormat?: BuyingFormat;
  bidBasis: "PRICE" | "UNIT";
  bidUnits: number | null;
  inventoryType: string;
  condition: string[];
  displayedCondition?: string;
  packagingCondition?: string[];
  categories: string[];
  lotCategories?: LotCategoryShare[];
  bstockGrade?: string[];
  sellerGrade?: string[];
  manifest: boolean;
  buyNow: boolean;
  buyNowEndTime?: string | null;
  biddingStartTime?: string;
  startTime?: string;
  endTime: string;
  palletCount: number | null;
  units: number | null;
  retailPrice: number | null;
  unitRetail?: number | null;
  numberOfBids: number;
  winningBidAmount?: number | null;
  currentBid?: number | null;
  nextMinBidAmount?: number | null;
  problemFreeOrderRate?: number | null;
  shipmentType?: string;
  allowedShipmentTypes?: string[];
  carrier?: string[];
  capacity?: string[];
  memory?: string[];
  manufacturer?: string[];
  model?: string[];
  inspection?: string[];
  isCreditCardEnabled?: boolean;
  offeringId?: string | null;
  customRank?: number;
  nPopcorn?: number;
  randomSetLabel?: number;
  primaryImageUrl?: string;
  images?: string[];
  warehouseLocation?: string;
  distance?: number | null;
  [key: string]: unknown;
}

export interface SearchResponse {
  listings: Listing[];
  total: number;
  offset?: number;
  limit?: number;
  metadata?: Record<string, unknown>;
}

/** GET /v1/auctions?listingId=a,b,c */
export interface AuctionState {
  _id: string;
  listingId: string;
  actualEndTime: string;
  biddingEnabled: boolean;
  buyingFormatSequence: BuyingFormat | string;
  startPrice: number;
  buyNow?: { enabled: boolean; price?: number; endTime?: string };
  closed: boolean;
  canceled: boolean;
  nextMinBidAmount: number;
  bidPrecision: number;
  winningBidAmount?: number | null;
  numberOfBids?: number;
  uniqueBidders?: number;
  attributes?: Record<string, unknown>;
}

export interface AuctionsResponse {
  auctions: AuctionState[];
  total?: number;
  offset?: number;
  limit?: number;
}

/** One row of GET /v1/auctions/{id}/bids. */
export interface BidRecord {
  createdAt: string;
  bidAmount: number;
  /** Stable per-bidder proxy hash; two bids from the same hash are one bidder. */
  uniqueId: string;
  winning: boolean;
  userBid: boolean;
  currency: string;
}

export interface AuctionBidsResponse {
  uniqueBidders: number;
  numberOfBids: number;
  bids: BidRecord[];
  total?: number;
}

/** Enterprise (A2Z) auction row from bridge.bstock.com/v1/ent-auctions. */
export interface EntAuction {
  auctionId: string;
  title: string;
  sku: string;
  siteName: string;
  units: number | null;
  winningBidAmount: number | null;
  numberOfBids: number;
  closed: boolean;
  canceled: boolean;
  startPrice: number;
  startTime: string;
  endTime: string;
  buyerBidStatus: string;
  [key: string]: unknown;
}

export interface PlaceBidBody {
  amount: number;
  /** Optional buyer group / account override used by B-Stock's own UI. */
  buyerGroupId?: string;
}

export interface PlaceBidResponse {
  _id?: string;
  id?: string;
  auctionId?: string;
  amount?: number;
  status?: string;
  [key: string]: unknown;
}

export interface LoginResponse {
  token?: string;
  access_token?: string;
  refreshToken?: string;
  refresh_token?: string;
  tokenExpirationInstant?: number;
  user?: { id?: string; email?: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface AccountBidRecord extends BidRecord {
  auctionId?: string;
  listingId?: string;
  status?: string;
  [key: string]: unknown;
}

export interface ContractsResponse {
  contracts: Array<Record<string, unknown>>;
  total?: number;
  [key: string]: unknown;
}

export interface LotItem {
  _id: string;
  attributes: Record<string, unknown>;
  [key: string]: unknown;
}

export interface LotItemsResponse {
  items: LotItem[];
  total: number;
  offset?: number;
  limit?: number;
  availableFilters?: Record<string, unknown>;
}

export interface Lot {
  _id: string;
  accountId: string;
  locationId: string;
  sellerLotId: string[];
  groups: string[];
  documents: unknown[];
  [key: string]: unknown;
}

export interface AuctionGroup {
  _id: string;
  accountId: string;
  [key: string]: unknown;
}

export interface GroupsResponse {
  groups: AuctionGroup[];
  total: number;
  offset?: number;
  limit?: number;
}
