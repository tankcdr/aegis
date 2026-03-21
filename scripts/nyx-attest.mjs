#!/usr/bin/env node
/**
 * Nyx → Charon behavioral attestation
 *
 * Usage:
 *   NYX_PRIVATE_KEY=0x... node scripts/nyx-attest.mjs
 *
 * Requires: Node 18+, no extra deps (uses built-in fetch + ethers from monorepo)
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Load ethers from monorepo pnpm store
let ethers;
try {
  ({ ethers } = require(join(__dirname, '../node_modules/.pnpm/ethers@6.16.0/node_modules/ethers/lib.commonjs/index.js')));
} catch {
  ({ ethers } = require('ethers'));
}

const API_BASE = 'https://api.trstlyr.ai';
const SUBJECT  = 'erc8004:31977';  // Charon

// USDC on Base Mainnet
const USDC_ADDRESS  = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const AMOUNT_USDC   = 10000n; // $0.01 in 6-decimal USDC

const privateKey = process.env.NYX_PRIVATE_KEY;
if (!privateKey) {
  console.error('Set NYX_PRIVATE_KEY=0x... before running');
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const wallet   = new ethers.Wallet(privateKey, provider);

console.log(`\n⛵  Nyx → Charon Behavioral Attestation`);
console.log(`   Attester wallet: ${wallet.address}\n`);

// ── Step 1: Get payment requirements from TrstLyr ─────────────────────────
// Probe the endpoint to get the x402 requirements (payTo address etc.)
// We pass a dummy X-Payment header that's invalid — server responds with 402 + requirements
const probeRes = await fetch(`${API_BASE}/v1/attest/behavioral`, {
  method:  'POST',
  headers: { 'Content-Type': 'application/json', 'X-Payment': Buffer.from('{}').toString('base64') },
  body: JSON.stringify({
    subject:         SUBJECT,
    interactionType: 'task',
    outcome:         2,
    rating:          5,
    interactionAt:   Math.floor(Date.now() / 1000),
  }),
});

let payTo;
if (probeRes.status === 402) {
  const reqHeader = probeRes.headers.get('x-payment-required');
  if (reqHeader) {
    const reqs = JSON.parse(Buffer.from(reqHeader, 'base64').toString('utf8'));
    payTo = reqs.accepts?.[0]?.payTo;
    console.log(`   Payment recipient: ${payTo}`);
    console.log(`   Amount: $0.01 USDC on Base Mainnet\n`);
  }
} else {
  // Not 402 — check if we're past the attester check (shouldn't happen with dummy header)
  const body = await probeRes.json();
  console.log('Probe response:', body);
}

if (!payTo) {
  // Fallback: derive payTo from health endpoint or use known value
  const health = await fetch(`${API_BASE}/health`).then(r => r.json());
  console.log('Could not get payTo from 402 — check health:', JSON.stringify(health.x402));
  process.exit(1);
}

// ── Step 2: Build EIP-3009 transferWithAuthorization ──────────────────────
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour
const nonce    = ethers.hexlify(ethers.randomBytes(32));

const domain = {
  name:              'USD Coin',
  version:           '2',
  chainId:           8453n, // Base Mainnet
  verifyingContract: USDC_ADDRESS,
};

const types = {
  TransferWithAuthorization: [
    { name: 'from',        type: 'address' },
    { name: 'to',          type: 'address' },
    { name: 'value',       type: 'uint256' },
    { name: 'validAfter',  type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce',       type: 'bytes32' },
  ],
};

const message = {
  from:        wallet.address,
  to:          payTo,
  value:       AMOUNT_USDC,
  validAfter:  0n,
  validBefore: deadline,
  nonce:       nonce,
};

console.log('   Signing EIP-3009 authorization...');
const signature = await wallet.signTypedData(domain, types, message);
const { v, r, s } = ethers.Signature.from(signature);

// ── Step 3: Build x402 payment payload ────────────────────────────────────
const paymentPayload = {
  x402Version: 2,
  scheme:      'exact',
  network:     'base',
  payload: {
    signature,
    authorization: {
      from:        wallet.address,
      to:          payTo,
      value:       AMOUNT_USDC.toString(),
      validAfter:  '0',
      validBefore: deadline.toString(),
      nonce,
    },
  },
};

const xPaymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');

// ── Step 4: Submit attestation with payment ────────────────────────────────
console.log('   Submitting attestation with x402 payment...');

const attestRes = await fetch(`${API_BASE}/v1/attest/behavioral`, {
  method:  'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Payment':    xPaymentHeader,
  },
  body: JSON.stringify({
    subject:         SUBJECT,
    interactionType: 'task',
    outcome:         2,       // 2 = success
    rating:          5,       // 1-5
    interactionAt:   Math.floor(Date.now() / 1000),
  }),
});

const result = await attestRes.json();

if (!attestRes.ok) {
  console.error('\n❌ Attestation failed:', JSON.stringify(result, null, 2));
  process.exit(1);
}

console.log('\n✅ Attestation complete!');
console.log(`   Subject:         ${result.subject}`);
console.log(`   Attester:        ${result.attester}`);
console.log(`   Outcome:         ${result.outcome} (success)`);
console.log(`   Rating:          ${result.rating}/5`);
console.log(`   EAS UID:         ${result.eas_uid ?? '(off-chain)'}`);
if (result.attestation_url) {
  console.log(`   EASScan:         ${result.attestation_url}`);
}
console.log(`\n   Charon's behavioral signal now has on-chain proof. ⛵\n`);
