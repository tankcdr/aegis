// Identity Challenge — issue and verify cross-namespace link proofs (SPEC §8)
//
// Supported methods:
//   tweet_challenge   — agent posts a challenge string in a tweet or bio
//   wallet_signature  — agent signs a challenge with their wallet private key
//
// Challenges expire after 24 hours. Verified links are added to the identity graph.

import { ethers } from 'ethers';
import { identityGraph } from './graph.js';
import type { SubjectRef, VerificationMethod } from './graph.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChallengeMethod = 'tweet' | 'wallet_signature';
export type ChallengeStatus = 'pending' | 'verified' | 'expired' | 'failed';

export interface Challenge {
  id: string;
  from: SubjectRef;          // the identity claiming to own the target
  to: SubjectRef;            // the identity being claimed
  method: ChallengeMethod;
  challengeString: string;   // what to tweet (tweet method) or sign (wallet method)
  instructions: string;      // human-readable steps
  createdAt: string;
  expiresAt: string;
  status: ChallengeStatus;
}

export interface VerifyResult {
  success: boolean;
  link?: {
    from: string;
    to: string;
    method: VerificationMethod;
    confidence: number;
    attestationUid?: string;
  };
  error?: string;
}

export interface VerifyProof {
  signature?: string;       // wallet_signature: hex signature
  twitterUsername?: string; // tweet: which account to check (legacy Bearer-token flow)
  tweetUrl?: string;        // tweet: direct URL to the post — no API key required
}

// ─── Challenge store ──────────────────────────────────────────────────────────

const challenges = new Map<string, Challenge>();
const CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── Issue ────────────────────────────────────────────────────────────────────

/**
 * Issue a new identity link challenge.
 * Returns a Challenge with instructions for the agent.
 */
export function issueChallenge(
  from: SubjectRef,
  to: SubjectRef,
  method: ChallengeMethod,
): Challenge {
  const id = crypto.randomUUID();
  const now = Date.now();

  // Challenge string is short, unique, and human-readable
  const token = id.slice(0, 8).toUpperCase();
  const challengeString = `trstlyr-verify:${token}:${from.namespace}:${from.id}`;

  const instructions = buildInstructions(from, to, method, challengeString, id);

  const challenge: Challenge = {
    id,
    from,
    to,
    method,
    challengeString,
    instructions,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + CHALLENGE_TTL_MS).toISOString(),
    status: 'pending',
  };

  challenges.set(id, challenge);
  return challenge;
}

// ─── Verify ───────────────────────────────────────────────────────────────────

/**
 * Verify a challenge. On success, adds the link to the identity graph.
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
    return { success: false, error: 'Challenge has expired (24h limit)' };
  }

  try {
    let verified = false;
    const evidenceBase = {
      challenge_id: challengeId,
      method: challenge.method,
      verified_at: new Date().toISOString(),
    };

    if (challenge.method === 'wallet_signature') {
      verified = await verifyWalletSignature(challenge, proof.signature);
    } else if (challenge.method === 'tweet') {
      verified = await verifyTweet(challenge, proof.tweetUrl, proof.twitterUsername);
    }

    if (!verified) {
      return { success: false, error: 'Proof verification failed — challenge string not found or signature invalid' };
    }

    // Mark verified
    challenge.status = 'verified';

    // Determine verification method for the graph
    const graphMethod: VerificationMethod =
      challenge.method === 'wallet_signature' ? 'wallet_signature' : 'tweet_challenge';

    // Add to identity graph
    const link = identityGraph.addLink(
      challenge.from,
      challenge.to,
      graphMethod,
      { ...evidenceBase, proof: sanitizeProof(proof) },
    );

    return {
      success: true,
      link: {
        from: identityGraph.subjectKey(challenge.from),
        to: identityGraph.subjectKey(challenge.to),
        method: graphMethod,
        confidence: link.confidence,
        attestationUid: link.attestationUid,
      },
    };

  } catch (err) {
    challenge.status = 'failed';
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown verification error',
    };
  }
}

// ─── Get challenge ────────────────────────────────────────────────────────────

export function getChallenge(id: string): Challenge | undefined {
  return challenges.get(id);
}

// ─── Verification helpers ─────────────────────────────────────────────────────

async function verifyWalletSignature(
  challenge: Challenge,
  signature?: string,
): Promise<boolean> {
  if (!signature) throw new Error('signature is required for wallet_signature method');

  // The agent must have signed the challenge string with their wallet
  // We recover the address from the signature and compare with the ERC-8004 owner
  const recovered = ethers.verifyMessage(challenge.challengeString, signature);

  // For ERC-8004 subjects, verify recovered address matches the token owner
  if (challenge.from.namespace === 'erc8004') {
    const ownerAddress = await getERC8004Owner(challenge.from.id);
    return recovered.toLowerCase() === ownerAddress.toLowerCase();
  }

  // For wallet subjects, the id IS the address
  if (challenge.from.namespace === 'wallet' || challenge.from.namespace === 'eth') {
    return recovered.toLowerCase() === challenge.from.id.toLowerCase();
  }

  // For other namespaces — signature proves key control but not namespace ownership
  // Still store it, just with lower confidence handled at graph level
  return recovered !== ethers.ZeroAddress;
}

// ─── Tweet URL verification (no API key required) ────────────────────────────
//
// Primary method: agent provides the URL of the tweet they posted.
// We use Twitter's public oEmbed endpoint to fetch the tweet text — no auth.
// Falls back to raw HTML scrape if oEmbed fails.
// Legacy Bearer-token flow (twitterUsername) still supported as fallback.

async function verifyTweet(
  challenge: Challenge,
  tweetUrl?: string,
  twitterUsername?: string,
): Promise<boolean> {
  // Preferred: agent gives us the tweet URL — no API key needed
  if (tweetUrl) {
    return verifyTweetByUrl(tweetUrl, challenge.challengeString);
  }

  // Legacy fallback: scan via Bearer token if no URL provided
  const bearerToken = process.env['TWITTER_BEARER_TOKEN'];
  if (bearerToken && twitterUsername) {
    return verifyTweetByBearerToken(twitterUsername, challenge.challengeString, bearerToken);
  }

  throw new Error(
    'Provide tweet_url (the URL of your verification tweet) — no API key required.',
  );
}

/**
 * Verify by fetching the tweet URL directly.
 * Uses Twitter oEmbed (public, no auth) then falls back to HTML scrape.
 */
async function verifyTweetByUrl(tweetUrl: string, challengeString: string): Promise<boolean> {
  // Normalise: accept x.com or twitter.com URLs
  const normalised = tweetUrl.replace('x.com/', 'twitter.com/');

  // 1. Try oEmbed — Twitter's public endpoint, no auth needed
  try {
    const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(normalised)}&omit_script=true`;
    const res = await globalThis.fetch(oembedUrl, {
      headers: { 'User-Agent': 'AegisProtocol/1.0 (+https://trstlyr.ai)' },
    });
    if (res.ok) {
      const body = await res.json() as { html?: string; author_name?: string };
      if (body.html && body.html.includes(challengeString)) return true;
      // If oEmbed succeeded but string not found, don't bother with fallback
      if (body.html) return false;
    }
  } catch {
    // oEmbed failed — fall through to HTML scrape
  }

  // 2. Fallback: fetch the page HTML and look for the challenge string
  try {
    const res = await globalThis.fetch(normalised, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AegisBot/1.0; +https://trstlyr.ai)',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });
    if (!res.ok) return false;
    const html = await res.text();
    return html.includes(challengeString);
  } catch {
    return false;
  }
}

/**
 * Legacy: verify by scanning recent tweets via Bearer token.
 * Only used when no tweet_url is provided.
 */
async function verifyTweetByBearerToken(
  username: string,
  challengeString: string,
  bearerToken: string,
): Promise<boolean> {
  const clean = username.replace(/^@/, '');

  // Check bio first
  const bioRes = await globalThis.fetch(
    `https://api.twitter.com/2/users/by/username/${encodeURIComponent(clean)}?user.fields=description`,
    { headers: { Authorization: `Bearer ${bearerToken}` } },
  );
  if (bioRes.ok) {
    const body = await bioRes.json() as { data?: { description?: string; id?: string } };
    if ((body.data?.description ?? '').includes(challengeString)) return true;

    // Scan recent tweets
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
  }
  return false;
}

async function getERC8004Owner(agentId: string): Promise<string> {
  const rpcUrl = process.env['BASE_RPC_URL'] ?? 'https://mainnet.base.org';
  const registry = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
  const OWNER_OF = '0x6352211e'; // ownerOf(uint256)

  const numericId = parseInt(agentId.split(':').pop() ?? agentId, 10);
  const paddedId = numericId.toString(16).padStart(64, '0');

  const res = await globalThis.fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'eth_call',
      params: [{ to: registry, data: OWNER_OF + paddedId }, 'latest'],
    }),
  });

  const json = await res.json() as { result?: string };
  const raw = json.result ?? '0x';
  // Result is a 32-byte padded address — take last 20 bytes
  return '0x' + raw.slice(-40);
}

// ─── Instruction builder ──────────────────────────────────────────────────────

function buildInstructions(
  from: SubjectRef,
  to: SubjectRef,
  method: ChallengeMethod,
  challengeString: string,
  challengeId: string,
): string {
  if (method === 'tweet') {
    const tweetText = [
      `Verifying my AI agent identity on TrstLyr Protocol.`,
      ``,
      `${challengeString}`,
      ``,
      `https://trstlyr.ai`,
    ].join('\n');

    return [
      `To link ${from.namespace}:${from.id} → ${to.namespace}:${to.id}:`,
      ``,
      `1. Post the following tweet from @${to.id}:`,
      ``,
      `---`,
      tweetText,
      `---`,
      ``,
      `2. Copy the URL of that tweet, then call POST /v1/identity/verify with:`,
      `   {`,
      `     "challenge_id": "${challengeId}",`,
      `     "tweet_url": "https://x.com/${to.id}/status/<tweet_id>"`,
      `   }`,
      ``,
      `No API key required — we fetch the tweet URL directly.`,
      `Challenge expires in 24 hours.`,
    ].join('\n');
  }

  return [
    `To link ${from.namespace}:${from.id} → ${to.namespace}:${to.id}:`,
    ``,
    `1. Sign the following message with your wallet private key:`,
    `   ${challengeString}`,
    ``,
    `   Example (ethers.js):`,
    `   const sig = await wallet.signMessage("${challengeString}");`,
    ``,
    `2. Call POST /v1/identity/verify with:`,
    `   { "challenge_id": "${challengeId}", "signature": "<0x...>" }`,
    ``,
    `Challenge expires in 24 hours.`,
  ].join('\n');
}

function sanitizeProof(proof: VerifyProof): Record<string, unknown> {
  return {
    tweet_url: proof.tweetUrl ?? null,
    twitter_username: proof.twitterUsername ?? null,
    signature_present: Boolean(proof.signature),
  };
}
