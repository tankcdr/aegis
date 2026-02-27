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
import { initDb, saveIdentityLink, loadIdentityLinks, dbStats } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── EAS schema UID — env var takes priority, fall back to config file ─────────
let easSchemaUid: string | undefined;
easSchemaUid = process.env['AEGIS_EAS_SCHEMA_UID'];
if (!easSchemaUid) {
  try {
    // process.cwd() = repo root locally, /app in Docker — both work
    const cfg = JSON.parse(
      readFileSync(join(process.cwd(), 'config/base.json'), 'utf8'),
    ) as { schemaUid?: string };
    easSchemaUid = cfg.schemaUid;
  } catch {
    // config not present — schema UID unset
  }
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

// POST /v1/trust/batch — evaluate up to 20 subjects in one call
server.post('/v1/trust/batch', async (request, reply) => {
  const body = request.body as {
    subjects: Array<{ namespace: string; id: string }>;
    context?: { action?: Action };
  } | undefined;

  if (!Array.isArray(body?.subjects) || body.subjects.length === 0) {
    return reply.code(400).send({
      error: '"subjects" must be a non-empty array',
      example: {
        subjects: [
          { namespace: 'github', id: 'tankcdr' },
          { namespace: 'erc8004', id: '19077' },
        ],
      },
    });
  }

  if (body.subjects.length > 20) {
    return reply.code(400).send({ error: 'Maximum 20 subjects per batch request' });
  }

  // Fan out in parallel — cache means repeated subjects are free
  const results = await Promise.allSettled(
    body.subjects.map(subject =>
      engine.query({ subject: { type: 'agent', ...subject }, context: body.context }),
    ),
  );

  return reply.send({
    results: results.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : {
            subject: `${body.subjects[i]!.namespace}:${body.subjects[i]!.id}`,
            error: r.reason instanceof Error ? r.reason.message : 'Query failed',
          },
    ),
    total: body.subjects.length,
    evaluated_at: new Date().toISOString(),
  });
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

// POST /v1/identity/register — register an identity and get a verification challenge
// Method is auto-selected by namespace (twitter→tweet, github→gist, erc8004→wallet_signature)
// Optional link_to: link to an already-verified identity on success
server.post('/v1/identity/register', async (request, reply) => {
  const body = request.body as {
    subject?:  { namespace: string; id: string };
    link_to?:  { namespace: string; id: string };
  } | undefined;

  if (!body?.subject?.namespace || !body?.subject?.id) {
    return reply.code(400).send({
      error: '"subject" required: { namespace, id }',
      example: {
        subject: { namespace: 'twitter', id: 'myagent' },
        link_to: { namespace: 'github',  id: 'myagent' }, // optional
      },
    });
  }

  const challenge = issueChallenge(body.subject, body.link_to);
  return reply.code(201).send({
    challenge_id:     challenge.id,
    challenge_string: challenge.challengeString,
    method:           challenge.method,
    instructions:     challenge.instructions,
    expires_at:       challenge.expiresAt,
  });
});

// POST /v1/identity/link — deprecated alias for /v1/identity/register
server.post('/v1/identity/link', async (request, reply) => {
  return reply.code(301).send({
    error:    'Deprecated — use POST /v1/identity/register',
    redirect: '/v1/identity/register',
  });
});

// POST /v1/identity/verify — submit proof for a pending challenge
server.post('/v1/identity/verify', async (request, reply) => {
  const body = request.body as {
    challenge_id?:      string;
    // Subject proof
    tweet_url?:         string;
    gist_url?:          string;
    signature?:         string;
    twitter_username?:  string; // legacy
    // link_to proof (required when challenge was issued with link_to)
    link_to_tweet_url?: string;
    link_to_gist_url?:  string;
    link_to_signature?: string;
  } | undefined;

  if (!body?.challenge_id) {
    return reply.code(400).send({ error: '"challenge_id" is required' });
  }

  const challenge = getChallenge(body.challenge_id);
  if (!challenge) {
    return reply.code(404).send({ error: 'Challenge not found or expired' });
  }

  const result = await verifyChallenge(body.challenge_id, {
    tweetUrl:        body.tweet_url,
    gistUrl:         body.gist_url,
    signature:       body.signature,
    twitterUsername: body.twitter_username,
    linkToTweetUrl:  body.link_to_tweet_url,
    linkToGistUrl:   body.link_to_gist_url,
    linkToSignature: body.link_to_signature,
  });

  if (!result.success) {
    return reply.code(422).send({ error: result.error });
  }

  // Persist to DB — survives restarts
  if (result.registered && result.method) {
    const [fromNs, ...fromIdParts] = result.registered.split(':');
    const fromId = fromIdParts.join(':');
    const now = new Date().toISOString();
    await saveIdentityLink({
      id:          `${result.registered}:${now}`,
      from_ns:     fromNs!,
      from_id:     fromId,
      to_ns:       fromNs!,
      to_id:       fromId,
      method:      result.method,
      confidence:  result.confidence ?? 0.8,
      evidence:    { challenge_id: body?.challenge_id },
      verified_at: now,
    });

    if (result.linked) {
      const [toNs, ...toIdParts] = result.linked.split(':');
      await saveIdentityLink({
        id:          `${result.registered}:${result.linked}:${now}`,
        from_ns:     fromNs!,
        from_id:     fromId,
        to_ns:       toNs!,
        to_id:       toIdParts.join(':'),
        method:      result.method,
        confidence:  result.confidence ?? 0.8,
        evidence:    { challenge_id: body?.challenge_id },
        verified_at: now,
      });
    }
  }

  const msg = result.linked
    ? `✅ ${result.registered} verified and linked to ${result.linked} (confidence: ${result.confidence})`
    : `✅ ${result.registered} verified (confidence: ${result.confidence})`;

  return reply.send({
    verified:    true,
    registered:  result.registered,
    linked:      result.linked ?? null,
    method:      result.method,
    confidence:  result.confidence,
    message:     msg,
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
      ...await dbStats(),
    },
    uptime_seconds: process.uptime(),
  };
});

// ── Start ─────────────────────────────────────────────────────────────────────

const port = parseInt(process.env['PORT'] ?? '3000', 10);

// ── Startup: init DB then hydrate in-memory graph ─────────────────────────────
await initDb();

// Restore verified identity links into the in-memory graph
const savedLinks = await loadIdentityLinks();
for (const link of savedLinks) {
  identityGraph.addLink(
    { namespace: link.from_ns, id: link.from_id },
    { namespace: link.to_ns,   id: link.to_id   },
    link.method as 'tweet_challenge' | 'wallet_signature' | 'erc8004_services',
    link.evidence,
  );
}
if (savedLinks.length > 0) {
  console.log(`[db] Restored ${savedLinks.length} identity link(s)`);
}

server.listen({ port, host: '0.0.0.0' }, (err) => {
  if (err) {
    server.log.error(err);
    process.exit(1);
  }
  console.log(`
⛵ TrstLyr Protocol API v0.1.0
  → Trust engine: active (providers: ${engine.providerNames().join(', ')})
  → EAS schema:   ${easSchemaUid ?? '(not configured)'}
  → Listening on  http://0.0.0.0:${port}
`);
});
