// Identity Graph — verified cross-namespace identity links (SPEC §8)
//
// Stores verified links between identifiers (e.g. erc8004:19077 ↔ twitter:@charon).
// In-memory for MVP; designed to be replaced with a persistent store in Phase 2.

export type VerificationMethod =
  | 'tweet_challenge'   // agent posted challenge string in tweet/bio
  | 'wallet_signature'  // agent signed challenge with wallet private key
  | 'erc8004_services'  // declared in ERC-8004 services array (auto-extracted)
  | 'manual';           // operator-verified out of band

export interface SubjectRef {
  namespace: string;
  id: string;
}

export interface IdentityLink {
  id: string;             // link UUID
  from: SubjectRef;
  to: SubjectRef;
  method: VerificationMethod;
  verifiedAt: string;     // ISO 8601
  confidence: number;     // [0,1] — wallet_sig > tweet > erc8004_services
  evidence: Record<string, unknown>;
  attestationUid?: string; // EAS UID if anchored on-chain
}

// Confidence levels by verification method
const METHOD_CONFIDENCE: Record<VerificationMethod, number> = {
  wallet_signature: 0.95,
  tweet_challenge:  0.80,
  erc8004_services: 0.70, // declared but not separately proven
  manual:           0.90,
};

export class IdentityGraph {
  // Store links indexed by canonical key for fast lookup
  private readonly links = new Map<string, IdentityLink>();

  // Index: "namespace:id" → set of link IDs involving that identifier
  private readonly index = new Map<string, Set<string>>();

  /** Add a verified link to the graph. Idempotent — updates if already exists. */
  addLink(
    from: SubjectRef,
    to: SubjectRef,
    method: VerificationMethod,
    evidence: Record<string, unknown> = {},
    attestationUid?: string,
  ): IdentityLink {
    const linkId = this.linkKey(from, to);
    const existing = this.links.get(linkId);

    const link: IdentityLink = {
      id: linkId,
      from,
      to,
      method,
      verifiedAt: new Date().toISOString(),
      confidence: METHOD_CONFIDENCE[method],
      evidence,
      attestationUid: attestationUid ?? existing?.attestationUid,
    };

    this.links.set(linkId, link);
    this.indexSubject(this.subjectKey(from), linkId);
    this.indexSubject(this.subjectKey(to), linkId);

    return link;
  }

  /** Get all identifiers linked to the given subject (one hop). */
  getLinked(subject: SubjectRef): IdentityLink[] {
    const key = this.subjectKey(subject);
    const linkIds = this.index.get(key);
    if (!linkIds || linkIds.size === 0) return [];

    return Array.from(linkIds)
      .map(id => this.links.get(id))
      .filter((l): l is IdentityLink => l !== undefined);
  }

  /** Walk the graph transitively — return ALL identifiers reachable from subject. */
  resolveAll(subject: SubjectRef, maxHops = 3): SubjectRef[] {
    const visited = new Set<string>();
    const queue: SubjectRef[] = [subject];
    const result: SubjectRef[] = [];

    visited.add(this.subjectKey(subject));

    let hops = 0;
    while (queue.length > 0 && hops < maxHops) {
      const batch = queue.splice(0);
      hops++;

      for (const current of batch) {
        const links = this.getLinked(current);
        for (const link of links) {
          const other = this.subjectKey(link.from) === this.subjectKey(current)
            ? link.to
            : link.from;
          const otherKey = this.subjectKey(other);
          if (!visited.has(otherKey)) {
            visited.add(otherKey);
            result.push(other);
            queue.push(other);
          }
        }
      }
    }

    return result;
  }

  /** Check if two subjects are directly linked. */
  areLinked(a: SubjectRef, b: SubjectRef): boolean {
    return this.links.has(this.linkKey(a, b));
  }

  /** Get a specific link. */
  getLink(from: SubjectRef, to: SubjectRef): IdentityLink | undefined {
    return this.links.get(this.linkKey(from, to));
  }

  /** All links as an array. */
  allLinks(): IdentityLink[] {
    return Array.from(this.links.values());
  }

  /** Total link count. */
  size(): number {
    return this.links.size;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  subjectKey(s: SubjectRef): string {
    return `${s.namespace}:${s.id}`;
  }

  /** Canonical link key — order-independent so A↔B === B↔A */
  private linkKey(a: SubjectRef, b: SubjectRef): string {
    const ka = this.subjectKey(a);
    const kb = this.subjectKey(b);
    return ka < kb ? `${ka}||${kb}` : `${kb}||${ka}`;
  }

  private indexSubject(key: string, linkId: string): void {
    if (!this.index.has(key)) this.index.set(key, new Set());
    this.index.get(key)!.add(linkId);
  }
}

// Singleton instance shared across the engine and API
export const identityGraph = new IdentityGraph();
