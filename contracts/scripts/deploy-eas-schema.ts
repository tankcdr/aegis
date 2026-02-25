/**
 * deploy-eas-schema.ts
 *
 * ONE-TIME SCRIPT — registers the AegisTrustEvaluation schema on EAS (Base L2).
 * Uses ethers directly (no EAS SDK) for Node 24 compatibility.
 *
 * Usage:
 *   pnpm deploy:schema
 *
 * SPEC reference: §9.1 (Ethereum Attestation Service)
 */

import { ethers } from 'ethers';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

// ─── Load .env manually ───────────────────────────────────────────────────────
const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../.env');
try {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...rest] = trimmed.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  }
} catch { /* .env optional */ }

// ─── Aegis EAS Schema (SPEC §9.1) ────────────────────────────────────────────
const AEGIS_SCHEMA =
  'string subject, uint256 trustScore, uint256 confidence, uint8 riskLevel, string signalSummary, string queryId';

// Base (OP Stack predeploy address — same on mainnet + Sepolia)
const SCHEMA_REGISTRY_ADDRESS = '0x4200000000000000000000000000000000000020';

const SCHEMA_REGISTRY_ABI = [
  'function register(string schema, address resolver, bool revocable) returns (bytes32)',
  'event Registered(bytes32 indexed uid, address indexed registerer, tuple(bytes32 uid, address resolver, bool revocable, string schema) schema)',
];

async function main() {
  const rpcUrl     = process.env.BASE_RPC_URL;
  const privateKey = process.env.AEGIS_ATTESTATION_PRIVATE_KEY;

  if (!rpcUrl || !privateKey) {
    console.error('❌  Set BASE_RPC_URL and AEGIS_ATTESTATION_PRIVATE_KEY in .env');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer   = new ethers.Wallet(privateKey, provider);
  const network  = await provider.getNetwork();
  const balance  = await provider.getBalance(signer.address);

  console.log(`\n🔗  Network:  ${network.name} (chainId: ${network.chainId})`);
  console.log(`📍  Wallet:   ${signer.address}`);
  console.log(`💰  Balance:  ${ethers.formatEther(balance)} ETH`);
  console.log(`📋  Schema:   ${AEGIS_SCHEMA}\n`);

  const registry = new ethers.Contract(SCHEMA_REGISTRY_ADDRESS, SCHEMA_REGISTRY_ABI, signer);

  console.log('📤  Registering schema on EAS...');
  const tx = await registry.register(AEGIS_SCHEMA, ethers.ZeroAddress, true);
  console.log(`⏳  Transaction: ${tx.hash}`);
  console.log(`🔍  Basescan:   https://basescan.org/tx/${tx.hash}\n`);

  const receipt = await tx.wait();

  // Extract schema UID from the Registered event
  // The event emits: Registered(bytes32 indexed uid, address indexed registerer, ...)
  // uid is the first indexed topic (topics[1])
  const registeredLog = receipt.logs.find(
    (log: ethers.Log) => log.topics[0] === '0x7d917fcbc9a29a9705ff9936ffa599500e4fd902e4486bae317414fe967b307c'
  );
  const schemaUID: string = registeredLog?.topics?.[1] ?? 'unknown';

  console.log(`✅  Schema registered!`);
  console.log(`    Schema UID: ${schemaUID}`);
  console.log(`\n👉  Add to your .env:`);
  console.log(`    AEGIS_EAS_SCHEMA_UID=${schemaUID}\n`);

  // Save config
  const config = {
    schemaUID,
    schema: AEGIS_SCHEMA,
    chainId: network.chainId.toString(),
    networkName: network.name,
    registryAddress: SCHEMA_REGISTRY_ADDRESS,
    txHash: tx.hash,
    registeredAt: new Date().toISOString(),
  };

  const configDir  = resolve(dirname(fileURLToPath(import.meta.url)), '../../config');
  const configFile = resolve(configDir, `${network.name.replace(' ', '-')}.json`);

  await mkdir(configDir, { recursive: true });
  await writeFile(configFile, JSON.stringify(config, null, 2));
  console.log(`💾  Config saved to config/${network.name.replace(' ', '-')}.json`);
}

main().catch((err) => {
  console.error('❌  Schema deployment failed:', err.message);
  process.exit(1);
});
