// Aegis HTTP API — Fastify adapter
// Implements the REST API defined in SPEC.md §5 (API Specification)

import Fastify from 'fastify';
import { AegisEngine } from '@aegis-protocol/core';

const server = Fastify({ logger: true });
const engine = new AegisEngine();

// ─── Routes ───────────────────────────────────────────────────────────────────

// POST /v1/trust/query — SPEC §5.1
server.post('/v1/trust/query', async (request, reply) => {
  // TODO: implement — validate body, call engine.query(), return TrustResult
  return reply.code(501).send({ error: 'Not implemented' });
});

// GET /v1/trust/score/:subject — SPEC §5.2 (cached)
server.get('/v1/trust/score/:subject', async (request, reply) => {
  // TODO: implement — serve from cache or trigger evaluation
  return reply.code(501).send({ error: 'Not implemented' });
});

// GET /v1/identity/:namespace/:id/links — SPEC §5.4
server.get('/v1/identity/:namespace/:id/links', async (_request, reply) => {
  return reply.code(501).send({ error: 'Not implemented' });
});

// POST /v1/identity/link — SPEC §5.4
server.post('/v1/identity/link', async (_request, reply) => {
  return reply.code(501).send({ error: 'Not implemented' });
});

// POST /v1/audit/submit — SPEC §5.5
server.post('/v1/audit/submit', async (_request, reply) => {
  return reply.code(501).send({ error: 'Not implemented' });
});

// POST /v1/attest/anchor — SPEC §9.4
server.post('/v1/attest/anchor', async (_request, reply) => {
  return reply.code(501).send({ error: 'Not implemented' });
});

// GET /health
server.get('/health', async () => ({ status: 'ok', version: '0.1.0' }));

// ─── Start ────────────────────────────────────────────────────────────────────

const port = parseInt(process.env.PORT ?? '3000', 10);

server.listen({ port, host: '0.0.0.0' }, (err) => {
  if (err) {
    server.log.error(err);
    process.exit(1);
  }
});
