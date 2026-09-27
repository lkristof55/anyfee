/** Tiny in-memory TTL cache with a size cap (per instance; serverless instances each have one). */
export class TtlCache<V> {
  private readonly max: number;
  private readonly nowMs: () => number;
  private map = new Map<string, { v: V; until: number }>();

  constructor(max = 1000, nowMs: () => number = Date.now) {
    this.max = max;
    this.nowMs = nowMs;
  }

  get(key: string): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (this.nowMs() >= e.until) {
      this.map.delete(key);
      return undefined;
    }
    return e.v;
  }

  set(key: string, v: V, ttlMs: number): void {
    if (this.map.size >= this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { v, until: this.nowMs() + ttlMs });
  }
}
