// x402 attestation store — tracks free tier usage and payment nonces
// In-memory for now; swap for Redis/DB in production

// One free attestation per subject string (e.g. "github:tankcdr")
const freeUsed = new Set<string>();

// Used EIP-3009 nonces — prevents replay attacks
const usedNonces = new Set<string>();

export function hasUsedFree(subject: string): boolean {
  return freeUsed.has(subject.toLowerCase());
}

export function markFreeUsed(subject: string): void {
  freeUsed.add(subject.toLowerCase());
}

export function isNonceUsed(nonce: string): boolean {
  return usedNonces.has(nonce.toLowerCase());
}

export function markNonceUsed(nonce: string): void {
  usedNonces.add(nonce.toLowerCase());
}

// Stats — useful for health endpoint
export function storeStats(): { freeUsedCount: number; usedNonceCount: number } {
  return {
    freeUsedCount: freeUsed.size,
    usedNonceCount: usedNonces.size,
  };
}
