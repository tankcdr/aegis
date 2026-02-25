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
  const challengeString = `aegis-verify:${token}:${from.namespace}:${from.id}`;

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
  proof: {
    signature?: string;      // wallet_signature: hex signature
    twitterUsername?: string; // tweet: which account to check
  },
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
      verified = await verifyTweet(challenge, proof.twitterUsername);
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

async function verifyTweet(
  challenge: Challenge,
  twitterUsername?: string,
): Promise<boolean> {
  const bearerToken = process.env['TWITTER_BEARER_TOKEN'];
  if (!bearerToken) {
    throw new Error('TWITTER_BEARER_TOKEN required for tweet challenge verification');
  }

  const username = twitterUsername ?? challenge.to.id.replace(/^@/, '');

  // Check Twitter bio first (faster, doesn't require recent tweets)
  const bioResult = await checkTwitterBio(username, challenge.challengeString, bearerToken);
  if (bioResult) return true;

  // Fall back to checking recent tweets
  return checkRecentTweets(username, challenge.challengeString, bearerToken);
}

async function checkTwitterBio(
  username: string,
  challengeString: string,
  bearerToken: string,
): Promise<boolean> {
  const res = await globalThis.fetch(
    `https://api.twitter.com/2/users/by/username/${encodeURIComponent(username)}?user.fields=description`,
    { headers: { Authorization: `Bearer ${bearerToken}` } },
  );
  if (!res.ok) return false;
  const body = await res.json() as { data?: { description?: string } };
  return (body.data?.description ?? '').includes(challengeString);
}

async function checkRecentTweets(
  username: string,
  challengeString: string,
  bearerToken: string,
): Promise<boolean> {
  // First get the user ID
  const userRes = await globalThis.fetch(
    `https://api.twitter.com/2/users/by/username/${encodeURIComponent(username)}`,
    { headers: { Authorization: `Bearer ${bearerToken}` } },
  );
  if (!userRes.ok) return false;
  const userBody = await userRes.json() as { data?: { id?: string } };
  const userId = userBody.data?.id;
  if (!userId) return false;

  // Check their last 10 tweets
  const tweetsRes = await globalThis.fetch(
    `https://api.twitter.com/2/users/${userId}/tweets?max_results=10`,
    { headers: { Authorization: `Bearer ${bearerToken}` } },
  );
  if (!tweetsRes.ok) return false;
  const tweetsBody = await tweetsRes.json() as { data?: Array<{ text: string }> };

  return (tweetsBody.data ?? []).some(tweet => tweet.text.includes(challengeString));
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
    return [
      `To link ${from.namespace}:${from.id} → ${to.namespace}:${to.id}:`,
      ``,
      `1. Post the following string in your Twitter/X bio OR as a tweet:`,
      `   ${challengeString}`,
      ``,
      `2. Call POST /v1/identity/verify with:`,
      `   { "challenge_id": "${challengeId}", "twitter_username": "${to.id}" }`,
      ``,
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

function sanitizeProof(proof: { signature?: string; twitterUsername?: string }): Record<string, unknown> {
  return {
    twitter_username: proof.twitterUsername ?? null,
    signature_present: Boolean(proof.signature),
  };
}
