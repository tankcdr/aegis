export { IdentityGraph, identityGraph } from './graph.js';
export type { IdentityLink, SubjectRef, VerificationMethod } from './graph.js';

export { issueChallenge, verifyChallenge, getChallenge } from './challenge.js';
export type { Challenge, ChallengeMethod, ChallengeStatus, VerifyResult } from './challenge.js';

export { resolveIdentity, linkedNamespaces } from './resolver.js';
export type { ResolvedIdentity } from './resolver.js';
