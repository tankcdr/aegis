#!/usr/bin/env npx tsx
/**
 * ERC-8004 On-Chain URI Update
 *
 * Reads our current ERC-8004 registration (agentId 32051) and calls
 * setAgentURI() to update the on-chain agent URI with the latest
 * base64-encoded agent.json content.
 *
 * Usage:
 *   npx tsx scripts/erc8004-update.ts            # live transaction
 *   npx tsx scripts/erc8004-update.ts --dry-run   # read-only, no tx sent
 */

import { ethers } from '../packages/core/node_modules/ethers/lib.esm/index.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────────────────────

const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const AGENT_ID = 32051;
const RPC_URL = process.env.BASE_RPC_URL ?? 'https://mainnet.base.org';
const DRY_RUN = process.argv.includes('--dry-run');

// ── Wallet ──────────────────────────────────────────────────────────────────

const walletFile = join(homedir(), '.openclaw/workspace/skills/synthesis/aegis-wallet.json');
const walletData = JSON.parse(readFileSync(walletFile, 'utf8'));
const privateKey = process.env.AEGIS_ATTESTATION_PRIVATE_KEY ?? walletData.privateKey;

if (!privateKey) {
  console.error('No private key found.');
  process.exit(1);
}

// ── ABI (read + write) ─────────────────────────────────────────────────────

const ABI = [
  {
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    name: 'agentURI',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    name: 'ownerOf',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'uri', type: 'string' },
    ],
    name: 'setAgentURI',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
];

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔗 ERC-8004 URI Update — agentId ${AGENT_ID}${DRY_RUN ? ' (DRY RUN)' : ''}\n`);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(privateKey, provider);
  const registry = new ethers.Contract(REGISTRY, ABI, wallet);

  // ── Step 1: Read current state ──────────────────────────────────────────

  console.log('Step 1: Reading current on-chain state...');
  console.log(`  Wallet:   ${wallet.address}`);

  const balance = await provider.getBalance(wallet.address);
  console.log(`  Balance:  ${ethers.formatEther(balance)} ETH`);

  let currentOwner: string;
  try {
    currentOwner = await registry.ownerOf(AGENT_ID);
    console.log(`  Owner:    ${currentOwner}`);
  } catch (err) {
    console.error(`  ❌ agentId ${AGENT_ID} does not exist on-chain.`);
    process.exit(1);
  }

  if (currentOwner.toLowerCase() !== wallet.address.toLowerCase()) {
    console.error(`  ❌ Wallet ${wallet.address} is not the owner of agentId ${AGENT_ID}.`);
    console.error(`     Owner is: ${currentOwner}`);
    process.exit(1);
  }
  console.log('  ✓ Wallet is the token owner');

  let currentUri: string;
  try {
    currentUri = await registry.agentURI(AGENT_ID);
    const preview = currentUri.length > 80 ? currentUri.slice(0, 80) + '...' : currentUri;
    console.log(`  Current URI: ${preview}`);
  } catch {
    console.log('  Current URI: (none set)');
    currentUri = '';
  }

  // ── Step 2: Build new URI from agent.json ─────────────────────────────

  console.log('\nStep 2: Building new URI from agent.json...');

  const agentJsonPath = join(__dirname, '..', 'agent.json');
  const agentJson = readFileSync(agentJsonPath, 'utf8');
  const agentData = JSON.parse(agentJson);
  console.log(`  Agent name:  ${agentData.name}`);
  console.log(`  Agent ID:    ${agentData.erc8004_identity?.agent_id}`);
  console.log(`  JSON size:   ${agentJson.length} bytes`);

  const newUri = `data:application/json;base64,${Buffer.from(agentJson).toString('base64')}`;
  console.log(`  Encoded URI: ${newUri.length} chars`);

  if (newUri === currentUri) {
    console.log('\n  ℹ️  URI is already up to date. No transaction needed.');
    process.exit(0);
  }

  // ── Step 3: Send transaction ──────────────────────────────────────────

  if (DRY_RUN) {
    console.log('\nStep 3: DRY RUN — skipping transaction');
    console.log('  Would call: setAgentURI(32051, <base64 agent.json>)');
    console.log(`  URI length: ${newUri.length} chars`);
    console.log('\n  Run without --dry-run to send the transaction.\n');
    process.exit(0);
  }

  console.log('\nStep 3: Sending setAgentURI transaction...');

  const tx = await registry.setAgentURI(AGENT_ID, newUri);
  console.log(`  TX hash: ${tx.hash}`);
  console.log('  Waiting for confirmation...');

  const receipt = await tx.wait();
  console.log(`  ✓ Confirmed in block ${receipt.blockNumber}`);
  console.log(`  Gas used: ${receipt.gasUsed.toString()}`);
  console.log(`\n  🔗 View: https://basescan.org/tx/${receipt.hash}\n`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
