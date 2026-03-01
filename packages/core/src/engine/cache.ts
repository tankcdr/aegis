// In-memory TTL cache for TrustResult objects.
// Zero external dependencies — uses only built-in Map.
// SPEC §4 — caching layer between engine and API

import type { TrustResult } from '../types/index.js';

interface CacheEntry {
  result: TrustResult;
  expiresAt: number; // epoch ms
}

export class TrustCache {
  private readonly store = new Map<string, CacheEntry>();
  private readonly defaultTtl: number; // seconds

  constructor(defaultTtlSeconds = 300) {
    this.defaultTtl = defaultTtlSeconds;
    // Periodically evict expired entries to prevent unbounded memory growth.
    // unref() so the timer doesn't keep the process alive during tests.
    const timer = setInterval(() => this.evictExpired(), 60_000);
    if (typeof timer === 'object' && 'unref' in timer) (timer as NodeJS.Timeout).unref();
  }

  /** Return a cached result if it exists and hasn't expired. */
  get(key: string): TrustResult | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.result;
  }

  /** Cache a result with an optional TTL override (seconds). */
  set(key: string, result: TrustResult, ttlSeconds?: number): void {
    const ttl = (ttlSeconds ?? this.defaultTtl) * 1000;
    this.store.set(key, { result, expiresAt: Date.now() + ttl });
  }

  /** Remove a specific entry. */
  invalidate(key: string): void {
    this.store.delete(key);
  }

  /** Clear all entries. */
  clear(): void {
    this.store.clear();
  }

  /** Current number of stored entries (including expired ones not yet evicted). */
  size(): number {
    return this.store.size;
  }

  /** Evict all expired entries. Call periodically if you care about memory. */
  evictExpired(): number {
    const now = Date.now();
    let evicted = 0;
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        evicted++;
      }
    }
    return evicted;
  }
}
