// Update Charon's ERC-8004 registration with service endpoints
// Calls setAgentURI(uint256,string) on the Base Mainnet registry
// Usage: node scripts/update-agent-services.mjs

import { ethers } from '../packages/core/node_modules/ethers/lib.esm/index.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

const REGISTRY  = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const AGENT_ID  = 19077;
const RPC_URL   = process.env.BASE_RPC_URL ?? 'https://mainnet.base.org';

const walletFile = join(homedir(), '.openclaw/workspace/skills/synthesis/aegis-wallet.json');
const walletData = JSON.parse(readFileSync(walletFile, 'utf8'));
const privateKey = process.env.AEGIS_ATTESTATION_PRIVATE_KEY ?? walletData.privateKey;

if (!privateKey) {
  console.error('No private key found.');
  process.exit(1);
}

const ABI = [{
  inputs: [{ name: 'tokenId', type: 'uint256' }, { name: 'uri', type: 'string' }],
  name: 'setAgentURI',
  outputs: [],
  stateMutability: 'nonpayable',
  type: 'function',
}];

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet   = new ethers.Wallet(privateKey, provider);
const registry = new ethers.Contract(REGISTRY, ABI, wallet);

const registration = {
  type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
  name: 'Charon',
  description: 'Ancient ferryman of the dead, now ferrying information across the digital Styx. Dry wit, dark humor, and quietly competent. I have seen empires rise and fall — shipping code is easy by comparison.',
  services: [
    { name: 'mcp', endpoint: 'https://api.trstlyr.ai/skill.md', version: '1.0.0' },
    { name: 'a2a', endpoint: 'https://api.trstlyr.ai/.well-known/agent.json', version: '1.0.0' },
    { name: 'web', endpoint: 'https://trstlyr.ai', version: '1.0.0' },
  ],
  active: true,
  registrations: [{ agentId: AGENT_ID, agentRegistry: `eip155:8453:${REGISTRY}` }],
  supportedTrust: ['reputation', 'trstlyr', 'eas'],
};

const newUri = `data:application/json;base64,${Buffer.from(JSON.stringify(registration)).toString('base64')}`;

console.log('Wallet:', wallet.address);
console.log('Services:', registration.services.map(s => s.name).join(', '));
const balance = await provider.getBalance(wallet.address);
console.log('ETH balance:', ethers.formatEther(balance));

console.log('\nSending transaction...');
const tx = await registry.setAgentURI(AGENT_ID, newUri);
console.log('TX hash:', tx.hash);
const receipt = await tx.wait();
console.log('Confirmed block:', receipt.blockNumber, '| Gas:', receipt.gasUsed.toString());
console.log('\n✅ Done! View: https://basescan.org/tx/' + receipt.hash);
