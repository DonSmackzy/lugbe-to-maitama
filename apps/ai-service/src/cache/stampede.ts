// =============================================================================
// Anti-Stampede Inflight Request Deduplication
// Prevents cache stampedes when multiple concurrent requests encounter a cache miss.
// Guarantees only 1 LLM invocation for identical contextHash during miss window.
// =============================================================================

export class InflightDeduplicator {
  private readonly inflight = new Map<string, Promise<string>>();

  /**
   * Deduplicates concurrent asynchronous tasks for the same context key.
   * If a task for `key` is already executing, subsequent callers await the same promise.
   */
  async execute(
    key: string,
    factory: () => Promise<string>
  ): Promise<{ text: string; wasDeduplicated: boolean }> {
    const existing = this.inflight.get(key);
    if (existing) {
      const text = await existing;
      return { text, wasDeduplicated: true };
    }

    // First caller creates and registers the in-memory inflight promise
    const promise = (async () => {
      try {
        return await factory();
      } finally {
        // Guaranteed cleanup once finished (success or failure)
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, promise);

    try {
      const text = await promise;
      return { text, wasDeduplicated: false };
    } catch (err) {
      throw err;
    }
  }

  isInflight(key: string): boolean {
    return this.inflight.has(key);
  }

  size(): number {
    return this.inflight.size;
  }
}

export const inflightDeduplicator = new InflightDeduplicator();
