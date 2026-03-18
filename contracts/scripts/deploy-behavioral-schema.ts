/**
 * deploy-behavioral-schema.ts
 *
 * ONE-TIME SCRIPT — registers the BehavioralAttestation schema on EAS (Base Mainnet).
 * Companion to the existing AegisTrustEvaluation schema.
 *
 * Usage:
 *   cd contracts && pnpm tsx scripts/deploy-behavioral-schema.ts
 */

import { ethers } from 'ethers';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
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

// ─── Behavioral Attestation Schema ───────────────────────────────────────────
const BEHAVIORAL_SCHEMA =
  'string subject, string attester, string interactionType, uint8 outcome, uint8 rating, string evidenceURI, uint64 interactionAt, uint64 valueUSDC, bool disputed';

// Base OP Stack predeploy
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
  console.log(`📋  Schema:   ${BEHAVIORAL_SCHEMA}\n`);

  const registry = new ethers.Contract(SCHEMA_REGISTRY_ADDRESS, SCHEMA_REGISTRY_ABI, signer);

  console.log('📤  Registering behavioral attestation schema on EAS...');
  const tx = await registry.register(BEHAVIORAL_SCHEMA, ethers.ZeroAddress, true);
  console.log(`⏳  Transaction: ${tx.hash}`);
  console.log(`🔍  Basescan:   https://basescan.org/tx/${tx.hash}\n`);

  const receipt = await tx.wait();

  // Extract schema UID from the Registered event
  const registeredLog = receipt.logs.find(
    (log: ethers.Log) => log.topics[0] === '0x7d917fcbc9a29a9705ff9936ffa599500e4fd902e4486bae317414fe967b307c'
  );
  const schemaUID: string = registeredLog?.topics?.[1] ?? 'unknown';

  console.log(`✅  Behavioral schema registered!`);
  console.log(`    Schema UID: ${schemaUID}`);
  console.log(`\n👉  Add to your .env:`);
  console.log(`    AEGIS_BEHAVIORAL_SCHEMA_UID=${schemaUID}\n`);

  // Save config alongside existing base.json
  const configDir  = resolve(dirname(fileURLToPath(import.meta.url)), '../../config');
  const configFile = resolve(configDir, 'behavioral-schema.json');

  const config = {
    schemaUid: schemaUID,
    schema: BEHAVIORAL_SCHEMA,
    chainId: network.chainId.toString(),
    networkName: network.name,
    registryAddress: SCHEMA_REGISTRY_ADDRESS,
    txHash: tx.hash,
    registeredAt: new Date().toISOString(),
  };

  await mkdir(configDir, { recursive: true });
  await writeFile(configFile, JSON.stringify(config, null, 2));
  console.log(`💾  Config saved to config/behavioral-schema.json`);
}

main().catch((err) => {
  console.error('❌  Behavioral schema deployment failed:', err.message);
  process.exit(1);
});
