// =============================================================================
// MarketEngine — Price discovery for items within the simulation.
// Uses integer kobo for prices; fluctuation multipliers are floats (display only).
// =============================================================================

import type { CityPack, Item } from "@ltm/city-schema";

export type PriceQuote = {
  itemId: string;
  unitPriceKobo: number;
  quantity: number;
  totalKobo: number;
};

export type MarketError = { ok: false; reason: string };
export type MarketSuccess = { ok: true; quote: PriceQuote };

export class MarketEngine {
  constructor(private readonly pack: CityPack) {}

  /**
   * Get a buy-side price quote. Applies zone multiplier if provided.
   * Final price is always rounded to nearest kobo (integer).
   */
  quoteBuy(
    itemId: string,
    quantity: number,
    zoneMultiplier = 1.0
  ): MarketSuccess | MarketError {
    const item = this.findItem(itemId);
    if (!item) return { ok: false, reason: `Item '${itemId}' not found in city pack` };
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return { ok: false, reason: "Quantity must be a positive integer" };
    }

    const unitPriceKobo = Math.round(item.basePriceKobo * zoneMultiplier);
    const totalKobo = unitPriceKobo * quantity;

    return { ok: true, quote: { itemId, unitPriceKobo, quantity, totalKobo } };
  }

  /**
   * Get a sell-side price quote (50% of buy price by default).
   */
  quoteSell(
    itemId: string,
    quantity: number,
    zoneMultiplier = 1.0,
    sellFactor = 0.5
  ): MarketSuccess | MarketError {
    const buyResult = this.quoteBuy(itemId, quantity, zoneMultiplier);
    if (!buyResult.ok) return buyResult;

    const unitPriceKobo = Math.round(buyResult.quote.unitPriceKobo * sellFactor);
    const totalKobo = unitPriceKobo * quantity;

    return {
      ok: true,
      quote: { itemId, unitPriceKobo, quantity, totalKobo },
    };
  }

  private findItem(itemId: string): Item | undefined {
    return this.pack.items.find((i) => i.id === itemId);
  }
}
