// =============================================================================
// SimulationEngine — Top-level coordinator.
// Orchestrates movement, market, and ledger sub-engines per tick.
// Accepts a validated CityPack; produces state diffs for Colyseus to apply.
// =============================================================================

import type { CityPack } from "@ltm/city-schema";
import type { ClientIntent } from "@ltm/protocol";
import { MovementEngine } from "./movement.js";
import { MarketEngine } from "./market.js";
import { LedgerProcessor } from "./ledger.js";
import type { EngineState, PlayerState } from "./state.js";
import {
  calculateTransitFare,
  isTransitAvailable,
  ALONG_ENERGY_DELTA,
  BOLT_ENERGY_DELTA,
  BOLT_HIGHBROW_SC_BONUS,
  HIGHBROW_DISTRICT_IDS,
} from "./transit.js";

export type IntentResult =
  | { ok: true; mutations: StateMutation[] }
  | { ok: false; code: string; message: string };

export type StateMutation =
  | { kind: "PLAYER_MOVED"; playerId: string; toX: number; toY: number }
  | { kind: "INVENTORY_CHANGED"; playerId: string; itemId: string; delta: number }
  | { kind: "LEDGER_ENTRY"; entry: import("@ltm/protocol").LedgerEntryRecord }
  | { kind: "SOCIAL_CAPITAL_CHANGED"; playerId: string; delta: number }
  | { kind: "ENERGY_CHANGED"; playerId: string; delta: number };

/**
 * Instantiate once per Colyseus room.
 * The room passes in the validated CityPack; the engine never reads files.
 */
export class SimulationEngine {
  private readonly movement: MovementEngine;
  private readonly market: MarketEngine;

  constructor(private readonly pack: CityPack) {
    this.movement = new MovementEngine(pack);
    this.market = new MarketEngine(pack);
  }

  processIntent(
    state: EngineState,
    playerId: string,
    intent: ClientIntent,
    idemKey: string
  ): IntentResult {
    const player = state.players.get(playerId);
    if (!player) {
      return { ok: false, code: "INTERNAL_ERROR", message: `Player ${playerId} not in state` };
    }

    switch (intent.type) {
      case "MOVE":
        return this.handleMove(player, intent, idemKey);
      case "BUY":
        return this.handleBuy(state, player, intent, idemKey);
      case "SELL":
        return this.handleSell(state, player, intent, idemKey);
      case "TRANSIT":
        return this.handleTransit(state, player, intent, idemKey);
      default:
        // TALK, SUBMIT_DOCUMENT, PAY_BRIBE — stubbed for Phase 2
        return { ok: false, code: "INTERNAL_ERROR", message: `Intent '${intent.type}' not yet implemented` };
    }
  }

  private handleMove(
    player: PlayerState,
    intent: Extract<ClientIntent, { type: "MOVE" }>,
    _idemKey: string
  ): IntentResult {
    const result = this.movement.move(player.position, { x: intent.toX, y: intent.toY });
    if (!result.ok) {
      return { ok: false, code: "INVALID_MOVE", message: result.reason };
    }
    return {
      ok: true,
      mutations: [{ kind: "PLAYER_MOVED", playerId: player.playerId, toX: intent.toX, toY: intent.toY }],
    };
  }

  private handleBuy(
    state: EngineState,
    player: PlayerState,
    intent: Extract<ClientIntent, { type: "BUY" }>,
    idemKey: string
  ): IntentResult {
    const zoneMultiplier = state.marketMultipliers.get(this.currentZoneId(state, player)) ?? 1.0;
    const quote = this.market.quoteBuy(intent.itemId, intent.quantity, zoneMultiplier);
    if (!quote.ok) {
      return { ok: false, code: "ITEM_NOT_FOUND", message: quote.reason };
    }

    const ledgerResult = LedgerProcessor.debit(player.balanceKobo, {
      idemKey,
      accountId: player.accountId,
      kind: "PURCHASE",
      amountKobo: quote.quote.totalKobo,
      relatedEntityId: intent.itemId,
    });
    if (!ledgerResult.ok) {
      return { ok: false, code: "INSUFFICIENT_FUNDS", message: ledgerResult.reason };
    }

    return {
      ok: true,
      mutations: [
        { kind: "LEDGER_ENTRY", entry: ledgerResult.entry },
        { kind: "INVENTORY_CHANGED", playerId: player.playerId, itemId: intent.itemId, delta: intent.quantity },
      ],
    };
  }

  private handleSell(
    state: EngineState,
    player: PlayerState,
    intent: Extract<ClientIntent, { type: "SELL" }>,
    idemKey: string
  ): IntentResult {
    const currentQty = player.inventory.get(intent.itemId) ?? 0;
    if (currentQty < intent.quantity) {
      return { ok: false, code: "ITEM_NOT_FOUND", message: "Not enough items in inventory" };
    }

    const zoneMultiplier = state.marketMultipliers.get(this.currentZoneId(state, player)) ?? 1.0;
    const quote = this.market.quoteSell(intent.itemId, intent.quantity, zoneMultiplier);
    if (!quote.ok) {
      return { ok: false, code: "ITEM_NOT_FOUND", message: quote.reason };
    }

    const ledgerResult = LedgerProcessor.credit(player.balanceKobo, {
      idemKey,
      accountId: player.accountId,
      kind: "SALE",
      amountKobo: quote.quote.totalKobo,
      relatedEntityId: intent.itemId,
    });
    if (!ledgerResult.ok) {
      return { ok: false, code: "INTERNAL_ERROR", message: ledgerResult.reason };
    }

    return {
      ok: true,
      mutations: [
        { kind: "LEDGER_ENTRY", entry: ledgerResult.entry },
        { kind: "INVENTORY_CHANGED", playerId: player.playerId, itemId: intent.itemId, delta: -intent.quantity },
      ],
    };
  }

  private currentZoneId(state: EngineState, player: PlayerState): string {
    const zone = state.cityPack.zones.find(
      (z) =>
        player.position.x >= z.bounds.topLeft.x &&
        player.position.x <= z.bounds.bottomRight.x &&
        player.position.y >= z.bounds.topLeft.y &&
        player.position.y <= z.bounds.bottomRight.y
    );
    return zone?.id ?? "__no_zone__";
  }

  private handleTransit(
    state: EngineState,
    player: PlayerState,
    intent: Extract<ClientIntent, { type: "TRANSIT" }>,
    idemKey: string
  ): IntentResult {
    if (
      intent.toX < 0 ||
      intent.toX >= state.cityPack.gridWidth ||
      intent.toY < 0 ||
      intent.toY >= state.cityPack.gridHeight
    ) {
      return { ok: false, code: "INVALID_MOVE", message: "Destination is out of city bounds" };
    }

    if (state.navGrid.isBlocked(intent.toX, intent.toY)) {
      return { ok: false, code: "BLOCKED_TILE", message: "Transit drop-off point is impassable/blocked" };
    }

    const fromDistrict = state.navGrid.getDistrictAt(player.position.x, player.position.y)
      ?? (player.home?.districtId ? state.navGrid.getDistrictById(player.home.districtId) : undefined);

    let toDistrict = state.navGrid.getDistrictAt(intent.toX, intent.toY);
    if (!toDistrict && intent.toDistrictId) {
      toDistrict = state.navGrid.getDistrictById(intent.toDistrictId);
    }

    const availability = isTransitAvailable(intent.tier, fromDistrict, toDistrict, player);
    if (!availability.available) {
      return { ok: false, code: "TRANSIT_UNAVAILABLE", message: availability.reason };
    }

    const fareKobo = calculateTransitFare(
      intent.tier,
      player.position,
      { x: intent.toX, y: intent.toY },
      fromDistrict,
      toDistrict
    );

    const ledgerResult = LedgerProcessor.debit(player.balanceKobo, {
      idemKey,
      accountId: player.accountId,
      kind: "PURCHASE",
      amountKobo: fareKobo,
      relatedEntityId: intent.tier === "BOLT" ? "transit_bolt" : "transit_along",
    });

    if (!ledgerResult.ok) {
      return { ok: false, code: "INSUFFICIENT_FUNDS", message: ledgerResult.reason };
    }

    const energyDelta = intent.tier === "ALONG" ? ALONG_ENERGY_DELTA : BOLT_ENERGY_DELTA;
    if (intent.tier === "ALONG" && player.energy < Math.abs(energyDelta)) {
      return { ok: false, code: "INSUFFICIENT_ENERGY", message: "Too exhausted for Along commute" };
    }

    let scDelta = 0;
    if (intent.tier === "BOLT") {
      const toId = toDistrict?.id?.toLowerCase() ?? "";
      if (HIGHBROW_DISTRICT_IDS.has(toId) || toDistrict?.tier === "core") {
        scDelta = BOLT_HIGHBROW_SC_BONUS;
      }
    }

    const mutations: StateMutation[] = [
      { kind: "LEDGER_ENTRY", entry: ledgerResult.entry },
      { kind: "PLAYER_MOVED", playerId: player.playerId, toX: intent.toX, toY: intent.toY },
    ];

    if (energyDelta !== 0) {
      mutations.push({ kind: "ENERGY_CHANGED", playerId: player.playerId, delta: energyDelta });
    }
    if (scDelta !== 0) {
      mutations.push({ kind: "SOCIAL_CAPITAL_CHANGED", playerId: player.playerId, delta: scDelta });
    }

    return {
      ok: true,
      mutations,
    };
  }
}
