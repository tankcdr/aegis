#!/usr/bin/env node
/**
 * TrstLyr Protocol — End-to-End Demo
 *
 * Run: npx tsx examples/demo.ts
 * Or:  pnpm -w add -D tsx && npx tsx examples/demo.ts
 */

import { AegisEngine } from '@aegis-protocol/core';
import type { EvaluateRequest } from '@aegis-protocol/core';

const engine = new AegisEngine();

const queries: EvaluateRequest[] = [
  { subject: { type: 'agent',  namespace: 'github', id: 'tankcdr' } },
  { subject: { type: 'skill',  namespace: 'github', id: 'tankcdr/aegis' } },
  { subject: { type: 'skill',  namespace: 'github', id: 'modelcontextprotocol/servers' } },
  { subject: { type: 'skill',  namespace: 'github', id: 'openai/openai-node' } },
];

const RISK_COLOR: Record<string, string> = {
  minimal:  '\x1b[32m', // green
  low:      '\x1b[33m', // yellow
  medium:   '\x1b[33m', // yellow
  high:     '\x1b[31m', // red
  critical: '\x1b[31m', // red
};
const RESET = '\x1b[0m';

console.log('\n⛵  \x1b[1mTrstLyr Protocol — Trust Evaluation Demo\x1b[0m\n');
console.log('═'.repeat(60));

for (const q of queries) {
  process.stdout.write(`\n  Evaluating ${q.subject.namespace}:${q.subject.id} ...`);
  const result = await engine.query(q);

  const scoreBar =
    '█'.repeat(Math.round(result.trust_score * 20)) +
    '░'.repeat(20 - Math.round(result.trust_score * 20));

  const color = RISK_COLOR[result.risk_level] ?? RESET;

  console.log(`\r  \x1b[1m${q.subject.namespace}:${q.subject.id}\x1b[0m`);
  console.log(`  Score  [${color}${scoreBar}${RESET}] ${(result.trust_score * 100).toFixed(1)}%`);
  console.log(`  Risk   ${color}${result.risk_level.toUpperCase()}${RESET} → ${result.recommendation.toUpperCase()}`);
  console.log(`  Conf   ${(result.confidence * 100).toFixed(1)}%   Signals: ${result.signals.length}   Fraud: ${result.fraud_signals.length}`);
}

console.log('\n' + '═'.repeat(60));
console.log('\n  Done. Souls evaluated. ⛵\n');
