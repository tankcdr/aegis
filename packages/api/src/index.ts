// Aegis HTTP API — Fastify adapter
// Implements the REST API defined in SPEC.md §5

import Fastify from 'fastify';
import { AegisEngine } from '@aegis-protocol/core';
import type { Action, Subject } from '@aegis-protocol/core';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

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

// GET /v1/identity/:namespace/:id/links — SPEC §5.4 (Phase 2)
server.get('/v1/identity/:namespace/:id/links', async (_request, reply) => {
  return reply.code(501).send({ error: 'Identity graph — Phase 2' });
});

// POST /v1/identity/link — SPEC §5.4 (Phase 2)
server.post('/v1/identity/link', async (_request, reply) => {
  return reply.code(501).send({ error: 'Identity linking — Phase 2' });
});

// POST /v1/audit/submit — SPEC §5.5 (Phase 2)
server.post('/v1/audit/submit', async (_request, reply) => {
  return reply.code(501).send({ error: 'Audit submissions — Phase 2' });
});

// POST /v1/attest/anchor — SPEC §9.4 (Phase 3)
server.post('/v1/attest/anchor', async (_request, reply) => {
  return reply.code(501).send({ error: 'EAS attestation anchoring — Phase 3' });
});

// GET /health
server.get('/health', async () => {
  const providerHealth = await engine.health();
  return {
    status: 'ok',
    version: '0.1.0',
    providers: engine.providerNames(),
    provider_health: providerHealth,
    eas_schema_uid: easSchemaUid ?? null,
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
