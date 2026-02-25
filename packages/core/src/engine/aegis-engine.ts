// AegisEngine — the embeddable trust engine (SPEC §4)
//
// Embedding example (OpenClaw, custom platform, etc.):
//   import { AegisEngine } from '@aegis-protocol/core';
//   const engine = new AegisEngine({ providers: ['github', 'moltbook'] });
//   const result = await engine.query({ subject: { type: 'skill', namespace: 'clawhub', id: 'author/skill' } });

import type { AegisConfig, EvaluateRequest, TrustResult } from '../types/index.js';

export class AegisEngine {
  constructor(_config: AegisConfig = {}) {
    // TODO: initialise provider registry, cache, scoring config
  }

  async query(_request: EvaluateRequest): Promise<TrustResult> {
    // TODO: implement full pipeline —
    //   1. Identity resolution (SPEC §8)
    //   2. Signal dispatch — fan out to providers in parallel (SPEC §4)
    //   3. Fraud detection meta-layer (SPEC §12)
    //   4. Subjective Logic opinion fusion (SPEC §7.1)
    //   5. Ev-Trust evolutionary stability adjustment (SPEC §7.9)
    //   6. Risk level mapping with context multiplier (SPEC §7.7)
    //   7. Optional EAS attestation anchoring (SPEC §9.1)
    throw new Error('AegisEngine.query() — implementation pending');
  }
}
