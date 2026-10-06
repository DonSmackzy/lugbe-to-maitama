// =============================================================================
// WorldRoomState — Colyseus Authoritative State Schema
// Synchronizes player positions, authoritative balances, energy, and inventory.
// =============================================================================

import { Schema, type, MapSchema } from "@colyseus/schema";

export class PlayerSchema extends Schema {
  @type("string") id: string = "";
  @type("string") accountId: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") balanceKobo: number = 0;
  @type("number") socialCapital: number = 0;
  @type("number") energy: number = 100;
  @type("string") districtId: string = "lugbe";
  @type({ map: "number" }) inventory = new MapSchema<number>();
}

export class WorldRoomState extends Schema {
  @type("number") tick: number = 0;
  @type("number") day: number = 1;
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
}
