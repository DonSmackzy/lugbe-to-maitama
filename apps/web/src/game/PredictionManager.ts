// =============================================================================
// Client-Side Prediction & Sequence-Based Reconciliation — PredictionManager.ts
// Rubber-Banding Defense:
// Client renders at 30Hz while server ticks at 10Hz.
// Predicts movements immediately for local responsiveness.
// When authoritative server updates or ACKs arrive, snaps baseline and re-applies
// pending unacknowledged intents sequentially.
// =============================================================================

export interface MoveIntentPayload {
  seq: number;
  dx: number;
  dy: number;
  targetX: number;
  targetY: number;
  idemKey: string;
  timestamp: number;
}

export class PredictionManager {
  private clientSeq = 0;
  private pendingIntents: MoveIntentPayload[] = [];

  // Authoritative server coordinates
  public authoritativeX: number;
  public authoritativeY: number;
  private lastAcknowledgedSeq = 0;

  // Local predicted coordinates
  public predictedX: number;
  public predictedY: number;

  constructor(startX = 10, startY = 10) {
    this.authoritativeX = startX;
    this.authoritativeY = startY;
    this.predictedX = startX;
    this.predictedY = startY;
  }

  /**
   * Generates a new predicted move intent.
   * Immediately updates local predicted position and queues intent for dispatch.
   */
  public predictMove(
    dx: number,
    dy: number,
    isWalkable: (x: number, y: number) => boolean = () => true
  ): MoveIntentPayload | null {
    // Only accept cardinal directions (1 tile per step)
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) {
      return null;
    }

    const nextX = Math.max(0, Math.min(119, this.predictedX + dx));
    const nextY = Math.max(0, Math.min(119, this.predictedY + dy));

    if (!isWalkable(nextX, nextY)) {
      return null; // Blocked tile rejected locally
    }

    this.clientSeq++;
    const idemKey = `move_${Date.now()}_seq${this.clientSeq}`;

    const intent: MoveIntentPayload = {
      seq: this.clientSeq,
      dx,
      dy,
      targetX: nextX,
      targetY: nextY,
      idemKey,
      timestamp: Date.now(),
    };

    this.pendingIntents.push(intent);

    // Apply prediction immediately
    this.predictedX = nextX;
    this.predictedY = nextY;

    return intent;
  }

  /**
   * Sequence-based reconciliation:
   * Called when an authoritative ACK or server state snapshot arrives.
   * 1. Snaps baseline to server's confirmed position.
   * 2. Prunes all local intents where seq <= ackSeq.
   * 3. Re-applies remaining unacknowledged intents sequentially.
   */
  public reconcile(
    serverX: number,
    serverY: number,
    ackSeq?: number
  ): { x: number; y: number; replayedCount: number } {
    this.authoritativeX = serverX;
    this.authoritativeY = serverY;

    if (ackSeq !== undefined) {
      this.lastAcknowledgedSeq = Math.max(this.lastAcknowledgedSeq, ackSeq);
      // Prune acknowledged intents
      this.pendingIntents = this.pendingIntents.filter(
        (it) => it.seq > this.lastAcknowledgedSeq
      );
    }

    // Start reconciliation from authoritative server baseline
    let simulatedX = this.authoritativeX;
    let simulatedY = this.authoritativeY;

    // Re-apply remaining unacknowledged intents in sequence
    for (const intent of this.pendingIntents) {
      simulatedX = Math.max(0, Math.min(119, simulatedX + intent.dx));
      simulatedY = Math.max(0, Math.min(119, simulatedY + intent.dy));
    }

    this.predictedX = simulatedX;
    this.predictedY = simulatedY;

    return {
      x: this.predictedX,
      y: this.predictedY,
      replayedCount: this.pendingIntents.length,
    };
  }

  public getPendingCount(): number {
    return this.pendingIntents.length;
  }

  public getClientSeq(): number {
    return this.clientSeq;
  }

  public reset(x: number, y: number): void {
    this.authoritativeX = x;
    this.authoritativeY = y;
    this.predictedX = x;
    this.predictedY = y;
    this.pendingIntents = [];
  }
}
