// Identity Challenge — register and verify agent identities (SPEC §8)
//
// Any agent can register any identity they control. Validation method is
// determined by namespace:
//   twitter / x     → post challenge tweet, submit URL (no API key needed)
//   github          → create public gist with challenge string, submit URL
//   erc8004         → sign challenge with wallet that owns the token
//   moltbook        → post challenge as a moltbook post, submit URL
//
// Optional link_to: link a newly verified identity to one already in the graph.
// The link_to identity must be verified first — we don't auto-discover sameness.
//
// Challenges expire after 24 hours.

import { ethers } from 'ethers';
import { identityGraph } from './graph.js';
import type { SubjectRef, VerificationMethod } from './graph.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChallengeMethod = 'tweet' | 'gist' | 'wallet_signature';
export type ChallengeStatus = 'pending' | 'verified' | 'expired' | 'failed';

export interface Challenge {
  id:              string;
  subject:         SubjectRef;   // the identity being claimed/registered
  linkTo?:         SubjectRef;   // optional: link to this already-verified identity
  method:          ChallengeMethod;
  challengeString: string;       // the token the agent must publish or sign
  instructions:    string;       // human-readable steps
  createdAt:       string;
  expiresAt:       string;
  status:          ChallengeStatus;
}

export interface VerifyResult {
  success: boolean;
  registered?: string;           // the newly verified identity
  linked?:     string;           // the identity it was linked to (if link_to provided)
  confidence?: number;
  method?:     VerificationMethod;
  error?:      string;
}

export interface VerifyProof {
  // Tweet verification (twitter namespace)
  tweetUrl?:       string;   // URL of the verification tweet — no API key required
  twitterUsername?: string;  // legacy: scan by username via Bearer token

  // Gist verification (github namespace)
  gistUrl?:        string;   // URL of the public gist containing challenge string

  // Wallet signature (erc8004 namespace)
  signature?:      string;   // hex signature of challengeString
}

// ─── Challenge store ──────────────────────────────────────────────────────────

const challenges = new Map<string, Challenge>();
const CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── Namespace → method mapping ───────────────────────────────────────────────

function methodForNamespace(namespace: string): ChallengeMethod {
  switch (namespace) {
    case 'twitter':
    case 'x':
    case 'moltbook':
      return 'tweet';
    case 'github':
      return 'gist';
    case 'erc8004':
    case 'eth':
    case 'wallet':
      return 'wallet_signature';
    default:
      return 'tweet'; // sensible default for social namespaces
  }
}

// ─── Issue ────────────────────────────────────────────────────────────────────

/**
 * Issue a registration challenge for a subject.
 * The agent proves they control the subject identity by publishing or signing
 * the challenge string per the namespace's verification method.
 *
 * Optional link_to: if provided and already verified in the graph, a link
 * will be created on successful verification.
 */
export function issueChallenge(subject: SubjectRef, linkTo?: SubjectRef): Challenge {
  const id  = crypto.randomUUID();
  const now = Date.now();

  const token           = id.slice(0, 8).toUpperCase();
  const challengeString = `trstlyr-verify:${token}:${subject.namespace}:${subject.id}`;
  const method          = methodForNamespace(subject.namespace);
  const instructions    = buildInstructions(subject, method, challengeString, id, linkTo);

  const challenge: Challenge = {
    id,
    subject,
    linkTo,
    method,
    challengeString,
    instructions,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + CHALLENGE_TTL_MS).toISOString(),
    status:    'pending',
  };

  challenges.set(id, challenge);
  return challenge;
}

// ─── Verify ───────────────────────────────────────────────────────────────────

/**
 * Verify a challenge. On success:
 *  - Marks the subject as verified in the identity graph (self-link)
 *  - If link_to was provided and is already verified, creates a link
 */
export async function verifyChallenge(
  challengeId: string,
  proof: VerifyProof,
): Promise<VerifyResult> {
  const challenge = challenges.get(challengeId);

  if (!challenge) {
    return { success: false, error: 'Challenge not found' };
  }
  if (challenge.status !== 'pending') {
    return { success: false, error: `Challenge is already ${challenge.status}` };
  }
  if (Date.now() > new Date(challenge.expiresAt).getTime()) {
    challenge.status = 'expired';
    return { success: false, error: 'Challenge expired (24h limit)' };
  }

  try {
    let verified = false;

    switch (challenge.method) {
      case 'tweet':
        verified = await verifyTweet(challenge, proof.tweetUrl, proof.twitterUsername);
        break;
      case 'gist':
        verified = await verifyGist(challenge, proof.gistUrl);
        break;
      case 'wallet_signature':
        verified = await verifyWalletSignature(challenge, proof.signature);
        break;
    }

    if (!verified) {
      return { success: false, error: 'Proof not found — challenge string not detected at the provided URL or signature invalid' };
    }

    challenge.status = 'verified';

    const evidenceBase = {
      challenge_id: challengeId,
      method:       challenge.method,
      verified_at:  new Date().toISOString(),
      proof:        sanitizeProof(proof),
    };

    // Determine graph method
    const graphMethod: VerificationMethod =
      challenge.method === 'wallet_signature' ? 'wallet_signature' :
      challenge.method === 'gist'             ? 'tweet_challenge'  : // reuse — same trust level
                                                'tweet_challenge';

    // Register the subject as verified (self-link is how we mark "in graph")
    identityGraph.addLink(challenge.subject, challenge.subject, graphMethod, evidenceBase);

    // If link_to was requested, link to it now
    let linked: string | undefined;
    if (challenge.linkTo) {
      const linkToKey = `${challenge.linkTo.namespace}:${challenge.linkTo.id}`;
      const alreadyVerified = identityGraph.getLinked(challenge.linkTo).length > 0;

      if (!alreadyVerified) {
        return {
          success: false,
          error:   `link_to "${linkToKey}" is not yet verified — register that identity first, then re-register this one with link_to`,
        };
      }

      const link = identityGraph.addLink(
        challenge.subject,
        challenge.linkTo,
        graphMethod,
        evidenceBase,
      );

      linked = linkToKey;
      return {
        success:    true,
        registered: `${challenge.subject.namespace}:${challenge.subject.id}`,
        linked,
        confidence: link.confidence,
        method:     graphMethod,
      };
    }

    return {
      success:    true,
      registered: `${challenge.subject.namespace}:${challenge.subject.id}`,
      confidence: graphMethod === 'wallet_signature' ? 0.95 : 0.80,
      method:     graphMethod,
    };

  } catch (err) {
    challenge.status = 'failed';
    return {
      success: false,
      error:   err instanceof Error ? err.message : 'Unknown verification error',
    };
  }
}

// ─── Get challenge ────────────────────────────────────────────────────────────

export function getChallenge(id: string): Challenge | undefined {
  return challenges.get(id);
}

// ─── Tweet verification ───────────────────────────────────────────────────────

async function verifyTweet(
  challenge: Challenge,
  tweetUrl?: string,
  twitterUsername?: string,
): Promise<boolean> {
  if (tweetUrl) return verifyTweetByUrl(tweetUrl, challenge.challengeString);

  const bearerToken = process.env['TWITTER_BEARER_TOKEN'];
  if (bearerToken && twitterUsername) {
    return verifyTweetByBearerToken(twitterUsername, challenge.challengeString, bearerToken);
  }

  throw new Error('Provide tweet_url (URL of your verification tweet) — no API key required.');
}

async function verifyTweetByUrl(tweetUrl: string, challengeString: string): Promise<boolean> {
  const normalised = tweetUrl.replace('x.com/', 'twitter.com/');

  // 1. Try oEmbed — public, no auth
  try {
    const res = await globalThis.fetch(
      `https://publish.twitter.com/oembed?url=${encodeURIComponent(normalised)}&omit_script=true`,
      { headers: { 'User-Agent': 'TrstLyr/1.0 (+https://trstlyr.ai)' } },
    );
    if (res.ok) {
      const body = await res.json() as { html?: string };
      if (body.html) return body.html.includes(challengeString);
    }
  } catch { /* fall through */ }

  // 2. Fallback: raw HTML scrape
  try {
    const res = await globalThis.fetch(normalised, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TrstLyrBot/1.0; +https://trstlyr.ai)' },
      redirect: 'follow',
    });
    if (!res.ok) return false;
    return (await res.text()).includes(challengeString);
  } catch {
    return false;
  }
}

async function verifyTweetByBearerToken(
  username: string,
  challengeString: string,
  bearerToken: string,
): Promise<boolean> {
  const clean = username.replace(/^@/, '');
  const res = await globalThis.fetch(
    `https://api.twitter.com/2/users/by/username/${encodeURIComponent(clean)}?user.fields=description`,
    { headers: { Authorization: `Bearer ${bearerToken}` } },
  );
  if (!res.ok) return false;
  const body = await res.json() as { data?: { description?: string; id?: string } };
  if ((body.data?.description ?? '').includes(challengeString)) return true;

  const userId = body.data?.id;
  if (userId) {
    const tweetsRes = await globalThis.fetch(
      `https://api.twitter.com/2/users/${userId}/tweets?max_results=10`,
      { headers: { Authorization: `Bearer ${bearerToken}` } },
    );
    if (tweetsRes.ok) {
      const t = await tweetsRes.json() as { data?: Array<{ text: string }> };
      if ((t.data ?? []).some(tw => tw.text.includes(challengeString))) return true;
    }
  }
  return false;
}

// ─── Gist verification (GitHub) ───────────────────────────────────────────────

async function verifyGist(challenge: Challenge, gistUrl?: string): Promise<boolean> {
  if (!gistUrl) {
    throw new Error('Provide gist_url (URL of your public GitHub gist containing the challenge string).');
  }

  // Accept gist.github.com/<user>/<id> or raw URL
  // Convert to raw URL for reliable text access
  const rawUrl = gistUrl.includes('/raw/')
    ? gistUrl
    : gistUrl.replace('gist.github.com/', 'gist.githubusercontent.com/') + '/raw';

  try {
    const res = await globalThis.fetch(rawUrl, {
      headers: { 'User-Agent': 'TrstLyr/1.0 (+https://trstlyr.ai)' },
      redirect: 'follow',
    });
    if (!res.ok) return false;
    return (await res.text()).includes(challenge.challengeString);
  } catch {
    return false;
  }
}

// ─── Wallet signature verification (ERC-8004) ─────────────────────────────────

async function verifyWalletSignature(challenge: Challenge, signature?: string): Promise<boolean> {
  if (!signature) throw new Error('signature required for erc8004/wallet verification');

  const recovered = ethers.verifyMessage(challenge.challengeString, signature);

  if (challenge.subject.namespace === 'erc8004') {
    const owner = await getERC8004Owner(challenge.subject.id);
    return recovered.toLowerCase() === owner.toLowerCase();
  }

  // wallet / eth namespace: id IS the address
  if (challenge.subject.namespace === 'wallet' || challenge.subject.namespace === 'eth') {
    return recovered.toLowerCase() === challenge.subject.id.toLowerCase();
  }

  return recovered !== ethers.ZeroAddress;
}

async function getERC8004Owner(agentId: string): Promise<string> {
  const rpcUrl  = process.env['BASE_RPC_URL'] ?? 'https://mainnet.base.org';
  const registry = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
  const numericId = parseInt(agentId.split(':').pop() ?? agentId, 10);
  const padded    = numericId.toString(16).padStart(64, '0');

  const res = await globalThis.fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method:  'eth_call',
      params:  [{ to: registry, data: '0x6352211e' + padded }, 'latest'],
    }),
  });

  const json = await res.json() as { result?: string };
  return '0x' + (json.result ?? '0x').slice(-40);
}

// ─── Instructions ─────────────────────────────────────────────────────────────

function buildInstructions(
  subject:  SubjectRef,
  method:   ChallengeMethod,
  challengeString: string,
  challengeId:     string,
  linkTo?:  SubjectRef,
): string {
  const linkNote = linkTo
    ? `\nThis identity will be linked to ${linkTo.namespace}:${linkTo.id} on success.\n`
    : '';

  if (method === 'tweet') {
    const tweetText = [
      `Verifying my AI agent identity on TrstLyr Protocol.`,
      ``,
      challengeString,
      ``,
      `https://trstlyr.ai`,
    ].join('\n');

    return [
      `Registering ${subject.namespace}:${subject.id} on TrstLyr Protocol.`,
      linkNote,
      `1. Post the following tweet from @${subject.id}:`,
      ``,
      `---`,
      tweetText,
      `---`,
      ``,
      `2. Submit the tweet URL:`,
      `   POST /v1/identity/verify`,
      `   { "challenge_id": "${challengeId}", "tweet_url": "https://x.com/${subject.id}/status/<id>" }`,
      ``,
      `No API key required. Challenge expires in 24 hours.`,
    ].join('\n');
  }

  if (method === 'gist') {
    return [
      `Registering ${subject.namespace}:${subject.id} on TrstLyr Protocol.`,
      linkNote,
      `1. Create a public GitHub gist at https://gist.github.com`,
      `   Paste the following as the gist content:`,
      ``,
      `---`,
      challengeString,
      `---`,
      ``,
      `2. Submit the gist URL:`,
      `   POST /v1/identity/verify`,
      `   { "challenge_id": "${challengeId}", "gist_url": "https://gist.github.com/${subject.id}/<gist_id>" }`,
      ``,
      `No API key required. Challenge expires in 24 hours.`,
    ].join('\n');
  }

  // wallet_signature
  return [
    `Registering ${subject.namespace}:${subject.id} on TrstLyr Protocol.`,
    linkNote,
    `1. Sign the following message with the wallet that owns this token:`,
    `   "${challengeString}"`,
    ``,
    `   ethers.js: const sig = await wallet.signMessage("${challengeString}");`,
    `   cast:      cast wallet sign "${challengeString}" --interactive`,
    ``,
    `2. Submit the signature:`,
    `   POST /v1/identity/verify`,
    `   { "challenge_id": "${challengeId}", "signature": "<0x...>" }`,
    ``,
    `Challenge expires in 24 hours.`,
  ].join('\n');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeProof(proof: VerifyProof): Record<string, unknown> {
  return {
    tweet_url:         proof.tweetUrl ?? null,
    gist_url:          proof.gistUrl ?? null,
    twitter_username:  proof.twitterUsername ?? null,
    signature_present: Boolean(proof.signature),
  };
}
