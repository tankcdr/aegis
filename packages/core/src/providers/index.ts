// Built-in signal providers — SPEC §6 (Signal Provider Interface)

// ── Phase 1: Web2 signals ─────────────────────────────────────────────────────
export { GitHubProvider }   from './github.js';
export { TwitterProvider }  from './twitter.js';

// ── Phase 2: Web3 signals ─────────────────────────────────────────────────────
export { ERC8004Provider }  from './erc8004.js';

// ── Phase 2: Agent community signals ─────────────────────────────────────────
export { MoltbookProvider } from './moltbook.js';

// ── Phase 3 (planned) ─────────────────────────────────────────────────────────
// export { SATIProvider }  from './sati.js';
// export { EASProvider }   from './eas.js';    // read EAS attestation history
