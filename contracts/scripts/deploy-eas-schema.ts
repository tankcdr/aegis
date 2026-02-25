/**
 * deploy-eas-schema.ts
 *
 * ONE-TIME SCRIPT — registers the AegisTrustEvaluation schema on EAS (Base L2).
 *
 * Run once per network (mainnet / testnet). After running, save the returned
 * schemaUID to your .env as AEGIS_EAS_SCHEMA_UID and commit config/base.json.
 *
 * Usage:
 *   cp .env.example .env          # fill in BASE_RPC_URL + AEGIS_ATTESTATION_PRIVATE_KEY
 *   pnpm deploy:schema            # runs this script
 *
 * What it does:
 *   1. Connects to Base L2 via BASE_RPC_URL
 *   2. Calls SchemaRegistry.register() on the EAS contract with the Aegis schema
 *   3. Prints the schema UID — save this, it never changes
 *   4. Writes config/base.json with the UID for use by the attestation bridge
 *
 * SPEC reference: §9.1 (Ethereum Attestation Service)
 */

import 'dotenv/config';
import { ethers } from 'ethers';
import { SchemaRegistry } from '@ethereum-attestation-service/eas-sdk';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// ─── Aegis EAS Schema (SPEC §9.1) ────────────────────────────────────────────
//
// subject     — Full Aegis subject identifier string
//               e.g. "erc8004://eip155:8453:0x.../42", "clawhub://author/skill"
//               string (not address) for cross-namespace support — see SPEC §9.1
//
// trustScore  — Projected trust score scaled by 1e18
//               e.g. 0.87 → 870000000000000000
//
// confidence  — Composite confidence, same 1e18 scaling
//
// riskLevel   — 0=minimal, 1=low, 2=medium, 3=high, 4=critical
//
// signalSummary — IPFS CID of the full signal JSON evidence
//                 Keeps PII off-chain, evidence verifiable — SPEC §10.6
//
// queryId     — Off-chain query correlation ID

const AEGIS_SCHEMA =
  'string subject, uint256 trustScore, uint256 confidence, uint8 riskLevel, string signalSummary, string queryId';

// EAS SchemaRegistry on Base (mainnet + testnet share the same address)
const SCHEMA_REGISTRY_ADDRESS = '0xA7b39296258348C78294F95B872b282dA851F1b';

async function main() {
  const rpcUrl = process.env.BASE_RPC_URL;
  const privateKey = process.env.AEGIS_ATTESTATION_PRIVATE_KEY;

  if (!rpcUrl || !privateKey) {
    console.error('❌  Set BASE_RPC_URL and AEGIS_ATTESTATION_PRIVATE_KEY in .env');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(privateKey, provider);
  const network = await provider.getNetwork();

  console.log(`\n🔗  Connected to chain ${network.chainId} (${network.name})`);
  console.log(`📋  Schema: ${AEGIS_SCHEMA}\n`);

  const registry = new SchemaRegistry(SCHEMA_REGISTRY_ADDRESS);
  registry.connect(signer);

  console.log('📤  Registering schema...');
  const tx = await registry.register({
    schema: AEGIS_SCHEMA,
    resolverAddress: ethers.ZeroAddress, // no custom resolver
    revocable: true,
  });

  console.log(`⏳  Transaction: ${tx.tx.hash}`);
  const schemaUID = await tx.wait();

  console.log(`\n✅  Schema registered!`);
  console.log(`    Schema UID: ${schemaUID}`);
  console.log(`\n👉  Add to your .env:`);
  console.log(`    AEGIS_EAS_SCHEMA_UID=${schemaUID}\n`);

  // Write config for use by the attestation bridge
  const config = {
    schemaUID,
    schema: AEGIS_SCHEMA,
    chainId: network.chainId.toString(),
    registeredAt: new Date().toISOString(),
    registryAddress: SCHEMA_REGISTRY_ADDRESS,
  };

  const configPath = resolve(process.cwd(), '../../config/base.json');
  await writeFile(configPath, JSON.stringify(config, null, 2));
  console.log(`💾  Config saved to config/base.json`);
}

main().catch((err) => {
  console.error('❌  Schema deployment failed:', err.message);
  process.exit(1);
});
