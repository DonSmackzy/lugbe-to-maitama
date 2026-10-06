// =============================================================================
// Colyseus Network Client — apps/web/src/network/ColyseusClient.ts
// Handles real-time websocket connection, state synchronization,
// disclaimer payload enforcement, and intent dispatch.
// =============================================================================

import { Client, Room } from "colyseus.js";
import type { ClientIntent } from "@ltm/protocol";

export interface ConnectOptions {
  serverUrl?: string;
  username: string;
  startingDistrict?: string;
  accountId?: string;
  disclaimerAccepted: boolean;
  disclaimerAcceptedAt: number;
}

export type AckCallback = (ack: {
  idemKey: string;
  seq?: number;
  type: string;
  x?: number;
  y?: number;
  balanceKobo: number;
  effects: any[];
}) => void;

export type DialogueCallback = (dialogue: {
  npcId: string;
  npcName: string;
  archetype: string;
  text: string;
}) => void;

export type ErrorCallback = (err: { code: string; message: string }) => void;

export class ColyseusGameClient {
  private client: Client;
  private room: Room | null = null;
  private serverUrl: string;

  private onAckListeners: AckCallback[] = [];
  private onDialogueListeners: DialogueCallback[] = [];
  private onErrorListeners: ErrorCallback[] = [];

  constructor(serverUrl = "ws://localhost:2567") {
    this.serverUrl = serverUrl;
    this.client = new Client(this.serverUrl);
  }

  public async connect(options: ConnectOptions): Promise<Room> {
    // ENFORCE: The client-side layer refuses to proceed if disclaimer is not accepted
    if (!options.disclaimerAccepted) {
      throw new Error(
        "SECURITY: Satire and legal disclaimer must be explicitly accepted before connecting."
      );
    }

    try {
      this.room = await this.client.joinOrCreate("world_room", {
        accountId: options.accountId || `acc_${Math.random().toString(36).substring(2, 9)}`,
        username: options.username,
        startingDistrict: options.startingDistrict || "lugbe",
        disclaimerAccepted: options.disclaimerAccepted,
        disclaimerAcceptedAt: options.disclaimerAcceptedAt,
      });

      console.log(`[colyseus] Successfully joined room: ${this.room.roomId} (sessionId: ${this.room.sessionId})`);

      // Wire message handlers
      this.room.onMessage("ack", (message) => {
        for (const listener of this.onAckListeners) {
          listener(message);
        }
      });

      this.room.onMessage("dialogue", (message) => {
        for (const listener of this.onDialogueListeners) {
          listener(message);
        }
      });

      this.room.onMessage("error", (message) => {
        for (const listener of this.onErrorListeners) {
          listener(message);
        }
      });

      return this.room;
    } catch (err) {
      console.error("[colyseus] Failed to join world_room:", err);
      throw err;
    }
  }

  public sendIntent(intent: ClientIntent & { seq?: number; idemKey?: string }): void {
    if (!this.room) {
      console.warn("[colyseus] Cannot send intent, room is not connected");
      return;
    }
    this.room.send("intent", intent);
  }

  public onAck(callback: AckCallback): void {
    this.onAckListeners.push(callback);
  }

  public onDialogue(callback: DialogueCallback): void {
    this.onDialogueListeners.push(callback);
  }

  public onError(callback: ErrorCallback): void {
    this.onErrorListeners.push(callback);
  }

  public getRoom(): Room | null {
    return this.room;
  }

  public getSessionId(): string | null {
    return this.room?.sessionId || null;
  }

  public leave(): void {
    if (this.room) {
      this.room.leave();
      this.room = null;
    }
  }
}
