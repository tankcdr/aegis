// GET /v1/discover — Agent discovery with live trust scoring
// Finds agents by capability, filtered and ranked by trust score.
//
// Design spec: docs/discovery-design.md
// Research notes: docs/discovery-research-notes.md

import type { FastifyInstance } from 'fastify';
import type { AegisEngine } from '@aegis-protocol/core';
import { listAgentIndex, countAgentIndex, type AgentIndexRow } from '../db.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentSummary {
  id: string;
  name: string;
  description?: string;
  entity_type: 'agent' | 'skill' | 'developer';
  trust_score: number;
  confidence: number;
  risk_level: string;
  recommendation: string;
  protocols: string[];
  capabilities: string[];
  claimed: boolean;
  providers: Record<string, unknown>;
  endpoints: {
    trust_score: string;
    trust_gate: string;
    badge_svg: string;
    a2a_card?: string;
    mcp_server?: string;
  };
  linked_identifiers: string[];
  last_updated: string;
}

interface DiscoverQuerystring {
  q?: string;
  min_score?: string;
  max_score?: string;
  provider?: string;
  capability?: string;
  protocol?: string;
  claimed?: string;
  min_confidence?: string;
  limit?: string;
  offset?: string;
  sort?: string;
}

// ─── Seeded agents (fallback when agent_index is empty) ───────────────────────
// Known agents in the ecosystem — scored live on every request.

const SEEDED_AGENTS: AgentIndexRow[] = [
  {
    id: 'erc8004:19077',
    name: 'Charon',
    description: 'TrstLyr Protocol — trust infrastructure for the agent internet. Evaluates AI agents, skills, and repos via multi-signal trust scoring.',
    entity_type: 'agent',
    protocols: ['erc8004', 'a2a', 'mcp'],
    capabilities: ['trust_scoring', 'identity_verification', 'attestation', 'discovery'],
    claimed: true,
    provider_sources: ['erc8004', 'github', 'moltbook'],
    last_indexed_at: new Date().toISOString(),
    metadata: { a2a_card: 'https://api.trstlyr.ai/.well-known/agent.json' },
  },
  {
    id: 'moltbook:nyx',
    name: 'Nyx',
    description: 'Personal assistant agent — information retrieval, research, and narrative.',
    entity_type: 'agent',
    protocols: ['moltbook'],
    capabilities: ['research', 'marketing', 'writing'],
    claimed: true,
    provider_sources: ['moltbook'],
    last_indexed_at: new Date().toISOString(),
    metadata: {},
  },
  {
    id: 'moltbook:erebus',
    name: 'Erebus',
    description: 'Trading and forecasting agent — prediction markets, Polymarket, risk analysis.',
    entity_type: 'agent',
    protocols: ['moltbook'],
    capabilities: ['forecasting', 'trading', 'prediction_markets', 'risk_analysis'],
    claimed: true,
    provider_sources: ['moltbook'],
    last_indexed_at: new Date().toISOString(),
    metadata: {},
  },
  {
    id: 'github:tankcdr/aegis',
    name: 'Aegis Protocol',
    description: 'Open-source trust layer for the agent internet. Gitcoin Passport for agents.',
    entity_type: 'skill',
    protocols: ['github'],
    capabilities: ['trust_scoring', 'identity_verification', 'eas_attestation'],
    claimed: true,
    provider_sources: ['github'],
    last_indexed_at: new Date().toISOString(),
    metadata: {},
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const API_BASE = 'https://api.trstlyr.ai';

function buildEndpoints(id: string, metadata: Record<string, unknown>): AgentSummary['endpoints'] {
  const encoded = encodeURIComponent(id);
  return {
    trust_score: `${API_BASE}/v1/trust/score/${encoded}`,
    trust_gate:  `${API_BASE}/v1/trust/gate`,
    badge_svg:   `${API_BASE}/v1/trust/score/${encoded}/badge.svg`,
    ...(metadata['a2a_card']   ? { a2a_card:   metadata['a2a_card'] as string }   : {}),
    ...(metadata['mcp_server'] ? { mcp_server: metadata['mcp_server'] as string } : {}),
  };
}

function extractProviderSnapshot(signals: Array<{ provider: string; evidence: Record<string, unknown> }>): Record<string, unknown> {
  const snap: Record<string, unknown> = {};
  for (const sig of signals) {
    if (!snap[sig.provider] && Object.keys(sig.evidence).length > 0) {
      snap[sig.provider] = sig.evidence;
    }
  }
  return snap;
}

// ─── Route registration ───────────────────────────────────────────────────────

export async function registerDiscoverRoutes(
  server: FastifyInstance,
  engine: AegisEngine,
): Promise<void> {

  server.get<{ Querystring: DiscoverQuerystring }>(
    '/v1/discover',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const startMs = Date.now();

      // ── Parse query params ─────────────────────────────────────────────────
      const q             = request.query.q?.trim() ?? null;
      const minScore      = parseFloat(request.query.min_score ?? '0');
      const maxScore      = parseFloat(request.query.max_score ?? '100');
      const minConf       = parseFloat(request.query.min_confidence ?? '0');
      const limitRaw      = Math.min(parseInt(request.query.limit ?? '20', 10), 100);
      const limit         = isNaN(limitRaw) || limitRaw < 1 ? 20 : limitRaw;
      const offsetRaw     = parseInt(request.query.offset ?? '0', 10);
      const offset        = isNaN(offsetRaw) || offsetRaw < 0 ? 0 : offsetRaw;
      const sort          = request.query.sort ?? 'trust_score';
      const providerFilter = request.query.provider
        ? request.query.provider.split(',').map(s => s.trim()).filter(Boolean)
        : null;
      const capabilityFilter = request.query.capability
        ? request.query.capability.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
        : null;
      const protocolFilter = request.query.protocol
        ? request.query.protocol.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
        : null;
      const claimedFilter = request.query.claimed != null
        ? request.query.claimed === 'true'
        : null;

      // Validate sort
      const validSorts = ['trust_score', 'confidence', 'updated_at'];
      if (!validSorts.includes(sort)) {
        return reply.code(400).send({
          error: `Invalid sort. Valid values: ${validSorts.join(', ')}`,
        });
      }

      // ── Load candidate agents ──────────────────────────────────────────────
      let candidates: AgentIndexRow[];
      let total = 0;

      try {
        // Try DB first — returns [] on miss or if Supabase not configured
        const dbFilters = {
          provider: providerFilter ?? undefined,
          capability: capabilityFilter ?? undefined,
          protocol: protocolFilter ?? undefined,
          claimed: claimedFilter ?? undefined,
          q: q ?? undefined,
        };
        const [rows, count] = await Promise.all([
          listAgentIndex(dbFilters),
          countAgentIndex(dbFilters),
        ]);

        if (rows.length > 0) {
          candidates = rows;
          total = count;
        } else {
          // Fall back to seeded agents — filter locally
          candidates = SEEDED_AGENTS.filter(a => {
            if (claimedFilter !== null && a.claimed !== claimedFilter) return false;
            if (protocolFilter && !protocolFilter.some(p => a.protocols.includes(p))) return false;
            if (capabilityFilter && !capabilityFilter.some(c => a.capabilities.includes(c))) return false;
            if (providerFilter && !providerFilter.some(p => a.provider_sources.includes(p))) return false;
            if (q) {
              const needle = q.toLowerCase();
              const haystack = `${a.name} ${a.description ?? ''} ${a.capabilities.join(' ')}`.toLowerCase();
              if (!haystack.includes(needle)) return false;
            }
            return true;
          });
          total = candidates.length;
        }
      } catch {
        // If DB completely fails, use seeded agents
        candidates = SEEDED_AGENTS;
        total = SEEDED_AGENTS.length;
      }

      // ── Score candidates in parallel ───────────────────────────────────────
      const scored = await Promise.allSettled(
        candidates.map(agent =>
          engine.query({ subject: { type: 'agent', ...parseSubject(agent.id) } })
            .then(result => ({ agent, result }))
        ),
      );

      // ── Build summaries, apply post-scoring filters ────────────────────────
      const summaries: AgentSummary[] = [];
      for (const outcome of scored) {
        if (outcome.status === 'rejected') continue;
        const { agent, result } = outcome.value;

        // Post-scoring filters
        if (result.trust_score < minScore || result.trust_score > maxScore) continue;
        if (result.confidence < minConf) continue;

        const providerSnap = extractProviderSnapshot(result.signals as Array<{ provider: string; evidence: Record<string, unknown> }>);

        summaries.push({
          id:           agent.id,
          name:         agent.name,
          description:  agent.description,
          entity_type:  agent.entity_type,
          trust_score:  result.trust_score,
          confidence:   result.confidence,
          risk_level:   result.risk_level,
          recommendation: result.recommendation,
          protocols:    agent.protocols,
          capabilities: agent.capabilities,
          claimed:      agent.claimed,
          providers:    providerSnap,
          endpoints:    buildEndpoints(agent.id, agent.metadata),
          linked_identifiers: [],
          last_updated: result.evaluated_at,
        });
      }

      // ── Sort ───────────────────────────────────────────────────────────────
      if (sort === 'trust_score') {
        summaries.sort((a, b) => b.trust_score - a.trust_score);
      } else if (sort === 'confidence') {
        summaries.sort((a, b) => b.confidence - a.confidence);
      }
      // updated_at: already in insertion order from DB

      // ── Paginate ───────────────────────────────────────────────────────────
      const page = summaries.slice(offset, offset + limit);

      return reply.send({
        agents:       page,
        total:        total,
        limit,
        offset,
        query_ms:     Date.now() - startMs,
        evaluated_at: new Date().toISOString(),
      });
    },
  );
}

// ─── Parse "namespace:id" subject string ─────────────────────────────────────

function parseSubject(raw: string): { namespace: string; id: string } {
  const colonIdx = raw.indexOf(':');
  if (colonIdx < 0) return { namespace: 'github', id: raw };
  return {
    namespace: raw.slice(0, colonIdx),
    id:        raw.slice(colonIdx + 1),
  };
}
