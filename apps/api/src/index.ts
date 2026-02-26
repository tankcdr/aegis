// Aegis HTTP API — Fastify adapter
// Implements the REST API defined in SPEC.md §5

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { AegisEngine, identityGraph, issueChallenge, verifyChallenge, getChallenge } from '@aegis-protocol/core';
import type { Action, Subject } from '@aegis-protocol/core';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { registerAttestRoutes } from './routes/attest.js';
import { storeStats } from './x402/store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── EAS schema UID from config ────────────────────────────────────────────────
let easSchemaUid: string | undefined;
try {
  const cfg = JSON.parse(
    readFileSync(join(__dirname, '../../../config/base.json'), 'utf8'),
  ) as { schemaUid?: string };
  easSchemaUid = cfg.schemaUid;
} catch {
  // config not present — attestation disabled
}

// ── Engine ────────────────────────────────────────────────────────────────────
const engine = new AegisEngine();

// ── Server ────────────────────────────────────────────────────────────────────
const server = Fastify({ logger: process.env['NODE_ENV'] !== 'test' });

// ── CORS ──────────────────────────────────────────────────────────────────────
await server.register(cors, {
  origin: [
    'https://trstlyr.ai',
    'https://www.trstlyr.ai',
    /\.trstlyr\.ai$/,
    /^http:\/\/localhost(:\d+)?$/,
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Payment'],
  exposedHeaders: ['X-Payment-Required'],
});

// ── Request body types ────────────────────────────────────────────────────────
interface TrustQueryBody {
  subject: Subject;
  context?: { action?: Action };
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /v1/trust/query — SPEC §5.1
server.post('/v1/trust/query', async (request, reply) => {
  const body = request.body as TrustQueryBody | undefined;
  const subject = body?.subject;
  if (!subject?.namespace || !subject?.id) {
    return reply.code(400).send({
      error: 'subject.namespace and subject.id are required',
      example: { subject: { type: 'agent', namespace: 'github', id: 'owner/repo' } },
    });
  }
  const result = await engine.query({ subject, context: body?.context });
  return reply.send(result);
});

// GET /v1/trust/score/:subject — SPEC §5.2 (cached lookup)
server.get<{ Params: { subject: string } }>(
  '/v1/trust/score/:subject',
  async (request, reply) => {
    const raw = decodeURIComponent(request.params.subject);
    const colonIdx = raw.indexOf(':');
    let namespace: string;
    let id: string;
    if (colonIdx > 0) {
      namespace = raw.slice(0, colonIdx);
      id = raw.slice(colonIdx + 1);
    } else {
      namespace = 'github';
      id = raw;
    }
    const result = await engine.query({
      subject: { type: 'agent', namespace, id },
    });
    return reply.send(result);
  },
);

// GET /v1/identity/:namespace/:id/links — list all verified links for an identifier
server.get<{ Params: { namespace: string; id: string } }>(
  '/v1/identity/:namespace/:id/links',
  async (request, reply) => {
    const { namespace, id } = request.params;
    const subject = { namespace, id: decodeURIComponent(id) };
    const links = identityGraph.getLinked(subject);
    const all = identityGraph.resolveAll(subject);
    return reply.send({
      subject: `${namespace}:${id}`,
      link_count: links.length,
      linked_identifiers: all.map(s => `${s.namespace}:${s.id}`),
      links: links.map(l => ({
        from: `${l.from.namespace}:${l.from.id}`,
        to:   `${l.to.namespace}:${l.to.id}`,
        method: l.method,
        confidence: l.confidence,
        verified_at: l.verifiedAt,
        attestation_uid: l.attestationUid ?? null,
      })),
    });
  },
);

// POST /v1/identity/link — issue a challenge to verify a cross-namespace link
server.post('/v1/identity/link', async (request, reply) => {
  const body = request.body as {
    from?: { namespace: string; id: string };
    to?:   { namespace: string; id: string };
    method?: 'tweet' | 'wallet_signature';
  } | undefined;

  if (!body?.from?.namespace || !body?.from?.id) {
    return reply.code(400).send({ error: '"from" identifier required: { namespace, id }' });
  }
  if (!body?.to?.namespace || !body?.to?.id) {
    return reply.code(400).send({ error: '"to" identifier required: { namespace, id }' });
  }

  const method = body.method ?? 'tweet';
  if (method !== 'tweet' && method !== 'wallet_signature') {
    return reply.code(400).send({ error: 'method must be "tweet" or "wallet_signature"' });
  }

  const challenge = issueChallenge(body.from, body.to, method);
  return reply.code(201).send({
    challenge_id:      challenge.id,
    challenge_string:  challenge.challengeString,
    method:            challenge.method,
    instructions:      challenge.instructions,
    expires_at:        challenge.expiresAt,
  });
});

// POST /v1/identity/verify — submit proof for a pending challenge
server.post('/v1/identity/verify', async (request, reply) => {
  const body = request.body as {
    challenge_id?: string;
    signature?: string;
    twitter_username?: string;
  } | undefined;

  if (!body?.challenge_id) {
    return reply.code(400).send({ error: '"challenge_id" is required' });
  }

  const challenge = getChallenge(body.challenge_id);
  if (!challenge) {
    return reply.code(404).send({ error: 'Challenge not found or expired' });
  }

  const result = await verifyChallenge(body.challenge_id, {
    signature:       body.signature,
    twitterUsername: body.twitter_username,
  });

  if (!result.success) {
    return reply.code(422).send({ error: result.error });
  }

  return reply.send({
    verified: true,
    link: result.link,
    message: `✅ ${result.link?.from} ↔ ${result.link?.to} verified (${result.link?.method}, confidence: ${result.link?.confidence})`,
  });
});

// ── x402 attestation routes ───────────────────────────────────────────────────
const BASE_URL = process.env['BASE_URL'] ?? 'https://api.trstlyr.ai';
await registerAttestRoutes(server, engine, BASE_URL);

// POST /v1/audit/submit — SPEC §5.5 (Phase 2)
server.post('/v1/audit/submit', async (_request, reply) => {
  return reply.code(501).send({ error: 'Audit submissions — Phase 2' });
});

// POST /v1/attest/anchor — SPEC §9.4 (Phase 3)
server.post('/v1/attest/anchor', async (_request, reply) => {
  return reply.code(501).send({ error: 'EAS attestation anchoring — Phase 3' });
});

// GET /skill.md — agent-readable skill manifest
server.get('/skill.md', async (_request, reply) => {
  try {
    // skill.md lives at the repo/project root; cwd = /app in Docker
    const skillPath = join(process.cwd(), 'skill.md');
    const content = readFileSync(skillPath, 'utf8');
    return reply
      .header('Content-Type', 'text/markdown; charset=utf-8')
      .header('Cache-Control', 'public, max-age=300')
      .send(content);
  } catch {
    return reply.code(404).send({ error: 'skill.md not found' });
  }
});

// GET / — redirect to skill.md (agents and humans both start here)
server.get('/', async (_request, reply) => {
  return reply.redirect('/skill.md', 302);
});

// GET /health
server.get('/health', async () => {
  const providerHealth = await engine.health();
  return {
    status: 'ok',
    version: '0.2.0',
    providers: engine.providerNames(),
    provider_health: providerHealth,
    eas_schema_uid: easSchemaUid ?? null,
    x402: {
      attestation_price_usdc: '0.01',
      // Address is derived from AEGIS_ATTESTATION_PRIVATE_KEY at startup — same wallet for both
      attestation_enabled: process.env['ATTESTATION_ENABLED'] === 'true',
      network: 'Base Mainnet',
      ...storeStats(),
    },
    uptime_seconds: process.uptime(),
  };
});

// ── Start ─────────────────────────────────────────────────────────────────────

const port = parseInt(process.env['PORT'] ?? '3000', 10);

server.listen({ port, host: '0.0.0.0' }, (err) => {
  if (err) {
    server.log.error(err);
    process.exit(1);
  }
  console.log(`
⛵ Aegis Protocol API v0.1.0
  → Trust engine: active (providers: ${engine.providerNames().join(', ')})
  → EAS schema:   ${easSchemaUid ?? '(not configured)'}
  → Listening on  http://0.0.0.0:${port}
`);
});
