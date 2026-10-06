// =============================================================================
// PlayerSerial — Per-Player Concurrency Queue
// Guarantees that a single player's intents and ledger writes are strictly serialized.
// Prevents race conditions, double-spend attempts, and parallel ledger debits.
// =============================================================================

export class PlayerSerialQueue {
  private readonly queues = new Map<string, Promise<unknown>>();

  /**
   * Enqueues an asynchronous task for a given player.
   * Ensures that tasks for the same playerId run sequentially in FIFO order.
   * Tasks for different players execute concurrently without blocking each other.
   */
  async enqueue<T>(playerId: string, task: () => Promise<T>): Promise<T> {
    const currentPromise = this.queues.get(playerId) ?? Promise.resolve();

    let taskResolve!: (val: T) => void;
    let taskReject!: (err: unknown) => void;

    const taskCompletionPromise = new Promise<T>((resolve, reject) => {
      taskResolve = resolve;
      taskReject = reject;
    });

    const nextChain = currentPromise
      .catch(() => {
        // Ignore previous task failure in chain to avoid cascading unhandled rejections
      })
      .then(async () => {
        try {
          const result = await task();
          taskResolve(result);
        } catch (err) {
          taskReject(err);
        }
      })
      .finally(() => {
        // If this chain is the last one registered for this player, prune the map
        if (this.queues.get(playerId) === nextChain) {
          this.queues.delete(playerId);
        }
      });

    this.queues.set(playerId, nextChain);

    return taskCompletionPromise;
  }

  /**
   * Check if a player currently has pending operations in flight.
   */
  isBusy(playerId: string): boolean {
    return this.queues.has(playerId);
  }

  /**
   * Clear queue for a player on disconnect.
   */
  clear(playerId: string): void {
    this.queues.delete(playerId);
  }
}

export const playerSerial = new PlayerSerialQueue();
