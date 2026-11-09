import { BStockAdapter } from "./bstock.ts";
import { LiquidationComAdapter } from "./liquidation-com.ts";
import { BulqAdapter } from "./bulq.ts";
import type { MarketplaceAdapter, AdapterRegistry } from "./types.ts";
import type { BStockClient } from "@bstock/client";

export function createAdapterRegistry(client: BStockClient): AdapterRegistry {
  const adapters: MarketplaceAdapter[] = [
    new BStockAdapter(client),
    new LiquidationComAdapter(),
    new BulqAdapter(),
  ];
  const map = new Map(adapters.map((a) => [a.id, a]));
  return {
    adapters,
    get: (id) => map.get(id),
    all: () => adapters,
  };
}

export { BStockAdapter, LiquidationComAdapter, BulqAdapter };
