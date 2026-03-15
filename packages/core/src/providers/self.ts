// Self Protocol Provider — ZK proof-of-human signals
// Checks whether an agent wallet has a verified Self Agent ID on Celo Mainnet
// Registry: 0xaC3DF9ABf80d0F5c020C06B04Cced27763355944 (soulbound ERC-721)

import type {
  EvaluateRequest,
  HealthStatus,
  Provider,
  ProviderMetadata,
  Signal,
  Subject,
} from '../types/index.js';

// ─── Constants ──────────────────────────────────────────────────────────────────

const SELF_REGISTRY = '0xaC3DF9ABf80d0F5c020C06B04Cced27763355944';
const CELO_RPC = 'https://forno.celo.org';

const ERC8004_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const BASE_RPC = 'https://mainnet.base.org';

// Function selectors
const BALANCE_OF_SELECTOR = '0x70a08231'; // balanceOf(address)
const OWNER_OF_SELECTOR   = '0x6352211e'; // ownerOf(uint256)

const TTL_SECONDS = 86400; // 24h — passport proofs valid up to 1 year

// ─── Provider ───────────────────────────────────────────────────────────────────

export class SelfProtocolProvider implements Provider {
  private readonly celoRpc: string;
  private readonly baseRpc: string;

  constructor(_config?: Record<string, unknown>) {
    this.celoRpc = (typeof _config?.celoRpc === 'string' ? _config.celoRpc : null)
      ?? process.env['CELO_RPC_URL'] ?? CELO_RPC;
    this.baseRpc = (typeof _config?.baseRpc === 'string' ? _config.baseRpc : null)
      ?? process.env['BASE_RPC_URL'] ?? BASE_RPC;
  }

  metadata(): ProviderMetadata {
    return {
      name: 'self',
      version: '1.0.0',
      description: 'Self Protocol ZK proof-of-human — checks soulbound Self Agent ID on Celo Mainnet',
      supported_subjects: ['agent'],
      supported_namespaces: ['self', 'erc8004'],
      signal_types: [
        {
          type: 'proof_of_human',
          description: 'Whether the agent wallet holds a verified Self Agent ID (soulbound ERC-721 on Celo)',
        },
      ],
      rate_limit: { requests_per_minute: 300, burst: 50 },
    };
  }

  supported(subject: Subject): boolean {
    return subject.namespace === 'self' || subject.namespace === 'erc8004';
  }

  async evaluate(request: EvaluateRequest): Promise<Signal[]> {
    const { subject } = request;
    if (!this.supported(subject)) return [];

    const timestamp = new Date().toISOString();

    try {
      const wallet = await this.resolveWallet(subject);
      if (!wallet) return []; // graceful degradation — cannot determine wallet

      const balance = await this.getBalanceOf(wallet);
      const hasSelfId = balance > 0;

      return [{
        provider: 'self',
        signal_type: 'proof_of_human',
        score: hasSelfId ? 0.95 : 0,
        confidence: hasSelfId ? 0.85 : 0.7,
        evidence: hasSelfId
          ? {
              has_self_id: true,
              wallet,
              registry: `celo:${SELF_REGISTRY}`,
              verified_human: true,
            }
          : {
              has_self_id: false,
              wallet,
            },
        timestamp,
        ttl: TTL_SECONDS,
      }];
    } catch {
      return []; // graceful degradation
    }
  }

  async health(): Promise<HealthStatus> {
    const lastCheck = new Date().toISOString();
    try {
      const res = await this.rpcCall(this.celoRpc, 'eth_blockNumber', []);
      const block = parseInt(res as string, 16);
      return {
        status: block > 0 ? 'healthy' : 'degraded',
        last_check: lastCheck,
        avg_response_ms: 0,
        error_rate_1h: 0,
        dependencies: { 'celo-mainnet-rpc': 'healthy' },
      };
    } catch {
      return {
        status: 'unhealthy',
        last_check: lastCheck,
        avg_response_ms: 0,
        error_rate_1h: 1,
        dependencies: { 'celo-mainnet-rpc': 'unhealthy' },
      };
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async resolveWallet(subject: Subject): Promise<string | null> {
    if (subject.namespace === 'self') {
      // self:0xAddress — direct wallet
      const addr = subject.id;
      if (/^0x[0-9a-fA-F]{40}$/.test(addr)) return addr.toLowerCase();
      return null;
    }

    if (subject.namespace === 'erc8004') {
      // erc8004:31977 — look up owner wallet from ERC-8004 registry on Base
      return this.getERC8004Owner(subject.id);
    }

    return null;
  }

  private async getERC8004Owner(id: string): Promise<string | null> {
    // Parse agentId
    const numeric = id.split(':').pop() ?? id;
    let agentId: number;
    if (/^\d+$/.test(numeric)) {
      agentId = parseInt(numeric, 10);
    } else if (/^0x[0-9a-f]+$/i.test(numeric)) {
      agentId = parseInt(numeric, 16);
    } else {
      return null;
    }

    try {
      const paddedId = agentId.toString(16).padStart(64, '0');
      const data = OWNER_OF_SELECTOR + paddedId;

      const raw = await this.rpcCall(this.baseRpc, 'eth_call', [
        { to: ERC8004_REGISTRY, data },
        'latest',
      ]) as string;

      if (!raw || raw === '0x' || raw.length < 66) return null;

      // ABI-encoded address: last 40 hex chars of the 32-byte word
      const addr = '0x' + raw.slice(-40);
      return addr.toLowerCase();
    } catch {
      return null;
    }
  }

  private async getBalanceOf(wallet: string): Promise<number> {
    // Encode: balanceOf(address) — pad address to 32 bytes
    const paddedAddr = wallet.slice(2).toLowerCase().padStart(64, '0');
    const data = BALANCE_OF_SELECTOR + paddedAddr;

    const raw = await this.rpcCall(this.celoRpc, 'eth_call', [
      { to: SELF_REGISTRY, data },
      'latest',
    ]) as string;

    if (!raw || raw === '0x') return 0;
    return parseInt(raw, 16);
  }

  private async rpcCall(rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
    const res = await globalThis.fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
    const json = await res.json() as { result?: unknown; error?: { message: string } };
    if (json.error) throw new Error(`RPC error: ${json.error.message}`);
    return json.result;
  }
}
