#!/usr/bin/env node
// Aegis Protocol MCP Server
// Exposes trust evaluation as MCP tools installable in Claude Desktop, Cursor, or any MCP host.
//
// Tools:
//   trust_query    — full trust report with score, risk level, signals, evidence
//   should_proceed — binary yes/no check with reasoning
//   trust_explain  — narrative explanation of the trust score

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { AegisEngine } from '@aegis-protocol/core';
import type { TrustResult, Action } from '@aegis-protocol/core';

// ── Engine ────────────────────────────────────────────────────────────────────

const engine = new AegisEngine();

// ── Server ────────────────────────────────────────────────────────────────────

const server = new McpServer(
  { name: 'aegis-protocol', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse a subject string into namespace + id.
 * Accepts:
 *   "github:tankcdr/aegis"   → { namespace: "github", id: "tankcdr/aegis" }
 *   "tankcdr/aegis"          → { namespace: "github", id: "tankcdr/aegis" }  (github default)
 *   "github:tankcdr"         → { namespace: "github", id: "tankcdr" }
 */
function parseSubject(raw: string): { namespace: string; id: string } {
  const colonIdx = raw.indexOf(':');
  if (colonIdx > 0) {
    return {
      namespace: raw.slice(0, colonIdx).toLowerCase(),
      id: raw.slice(colonIdx + 1),
    };
  }
  // Default to github namespace
  return { namespace: 'github', id: raw };
}

function riskEmoji(risk: string): string {
  switch (risk) {
    case 'minimal': return '🟢';
    case 'low':     return '🟡';
    case 'medium':  return '🟠';
    case 'high':    return '🔴';
    case 'critical':return '⛔';
    default:        return '❓';
  }
}

function recommendEmoji(rec: string): string {
  switch (rec) {
    case 'allow':   return '✅';
    case 'install': return '📦';
    case 'review':  return '👀';
    case 'caution': return '⚠️';
    case 'deny':    return '🚫';
    default:        return '❓';
  }
}

function formatTrustReport(result: TrustResult, subject: string): string {
  const scoreBar =
    '█'.repeat(Math.round(result.trust_score * 20)) +
    '░'.repeat(20 - Math.round(result.trust_score * 20));

  const lines: string[] = [
    `## Aegis Trust Report: \`${subject}\``,
    '',
    `**Score:** [${scoreBar}] ${(result.trust_score * 100).toFixed(1)}%`,
    `**Confidence:** ${(result.confidence * 100).toFixed(1)}%`,
    `**Risk Level:** ${riskEmoji(result.risk_level)} ${result.risk_level.toUpperCase()}`,
    `**Recommendation:** ${recommendEmoji(result.recommendation)} ${result.recommendation.toUpperCase()}`,
    '',
  ];

  if (result.signals.length > 0) {
    lines.push('### Signals');
    for (const sig of result.signals) {
      lines.push(
        `- **${sig.signal_type}** (${sig.provider}): score ${(sig.score * 100).toFixed(1)}%, confidence ${(sig.confidence * 100).toFixed(1)}%`,
      );
    }
    lines.push('');

    // Show first signal's evidence
    const firstSig = result.signals[0];
    if (firstSig && Object.keys(firstSig.evidence).length > 0) {
      lines.push('### Evidence');
      for (const [k, v] of Object.entries(firstSig.evidence)) {
        if (v !== null && v !== undefined) {
          lines.push(`- **${k}:** ${String(v)}`);
        }
      }
      lines.push('');
    }
  }

  if (result.fraud_signals.length > 0) {
    lines.push('### ⚠️ Fraud Signals');
    for (const fs of result.fraud_signals) {
      lines.push(`- **${fs.type}** [${fs.severity}]: ${fs.description}`);
    }
    lines.push('');
  }

  if (result.unresolved.length > 0) {
    lines.push('### Unresolved');
    for (const u of result.unresolved) {
      lines.push(`- ${u.provider}: ${u.reason}`);
    }
    lines.push('');
  }

  lines.push(
    `*Evaluated: ${result.evaluated_at} | Query ID: ${result.metadata?.query_id ?? 'n/a'}*`,
  );

  return lines.join('\n');
}

// ── Tool 1: trust_query ───────────────────────────────────────────────────────

server.registerTool(
  'trust_query',
  {
    title: 'Aegis Trust Query',
    description:
      'Query the Aegis trust score for an agent, skill, or GitHub repository. ' +
      'Returns a full trust assessment including score, risk level, recommendation, ' +
      'and evidence from signal providers. ' +
      'Subject format: "github:owner/repo", "github:owner", or just "owner/repo".',
    inputSchema: {
      subject: z
        .string()
        .describe(
          'Subject to evaluate. Format: "namespace:id" or "owner/repo". ' +
          'Examples: "github:tankcdr/aegis", "github:octocat", "openai/openai-python"',
        ),
      action: z
        .enum(['install', 'execute', 'delegate', 'transact', 'review'])
        .optional()
        .describe('The action being considered. Affects risk thresholds for transact/delegate.'),
    },
  },
  async ({ subject, action }) => {
    const { namespace, id } = parseSubject(subject);
    const result = await engine.query({
      subject: { type: 'agent', namespace, id },
      context: action ? { action: action as Action } : undefined,
    });
    return { content: [{ type: 'text', text: formatTrustReport(result, subject) }] };
  },
);

// ── Tool 2: should_proceed ────────────────────────────────────────────────────

server.registerTool(
  'should_proceed',
  {
    title: 'Aegis Should Proceed',
    description:
      'Quick binary check: should an AI agent proceed with an action on a given subject? ' +
      'Returns a clear YES or NO with reasoning. ' +
      'Use this before installing tools, running code, or delegating tasks.',
    inputSchema: {
      subject: z
        .string()
        .describe('Subject to check. Format: "namespace:id" or "owner/repo".'),
      action: z
        .enum(['install', 'execute', 'delegate', 'transact', 'review'])
        .optional()
        .describe('Action being considered. High-stakes actions (transact, delegate) use stricter thresholds.'),
      min_score: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe('Minimum acceptable trust score (0–1). Default: 0.6'),
    },
  },
  async ({ subject, action, min_score = 0.6 }) => {
    const { namespace, id } = parseSubject(subject);
    const result = await engine.query({
      subject: { type: 'agent', namespace, id },
      context: action ? { action: action as Action } : undefined,
    });

    const proceed = result.trust_score >= min_score && result.recommendation !== 'deny' && result.recommendation !== 'caution';
    const verdict = proceed ? '**PROCEED: YES** ✅' : '**PROCEED: NO** ❌';

    const text = [
      verdict,
      '',
      `**Subject:** ${subject}`,
      `**Score:** ${(result.trust_score * 100).toFixed(1)}% (minimum required: ${(min_score * 100).toFixed(1)}%)`,
      `**Risk:** ${riskEmoji(result.risk_level)} ${result.risk_level}`,
      `**Recommendation:** ${recommendEmoji(result.recommendation)} ${result.recommendation}`,
      '',
      proceed
        ? `This subject meets the minimum trust threshold. ${result.signals.length} signal(s) collected.`
        : `This subject does NOT meet the minimum trust threshold. ` +
          (result.fraud_signals.length > 0
            ? `${result.fraud_signals.length} fraud signal(s) detected.`
            : `Score ${(result.trust_score * 100).toFixed(1)}% is below the required ${(min_score * 100).toFixed(1)}%.`),
    ].join('\n');

    return { content: [{ type: 'text', text }] };
  },
);

// ── Tool 3: trust_explain ─────────────────────────────────────────────────────

server.registerTool(
  'trust_explain',
  {
    title: 'Aegis Trust Explain',
    description:
      'Get a human-readable narrative explanation of why a subject received its trust score. ' +
      'Useful for transparency, auditing, and understanding Aegis trust assessments.',
    inputSchema: {
      subject: z
        .string()
        .describe('Subject to explain. Format: "namespace:id" or "owner/repo".'),
    },
  },
  async ({ subject }) => {
    const { namespace, id } = parseSubject(subject);
    const result = await engine.query({
      subject: { type: 'agent', namespace, id },
    });

    const lines: string[] = [
      `## Why does \`${subject}\` have a ${result.risk_level} trust rating?`,
      '',
      `Aegis evaluated \`${subject}\` using **${result.signals.length}** signal${result.signals.length !== 1 ? 's' : ''}` +
        (result.unresolved.length > 0 ? ` (${result.unresolved.length} provider(s) could not be reached)` : '') +
        ':',
      '',
    ];

    if (result.signals.length === 0) {
      lines.push(
        '> No signals could be collected. This typically means the subject does not exist ' +
        'on any supported platform, or all providers failed to respond.',
      );
    }

    for (const sig of result.signals) {
      lines.push(`### ${sig.signal_type} (via ${sig.provider})`);
      lines.push(`**Score:** ${(sig.score * 100).toFixed(1)}% | **Confidence:** ${(sig.confidence * 100).toFixed(1)}%`);

      // Narrative based on evidence
      const ev = sig.evidence;
      if (sig.signal_type === 'author_reputation' && ev['followers'] !== undefined) {
        lines.push(
          `The author has **${ev['followers']} followers** and **${ev['public_repos']} public repositories**, ` +
          `with an account age of **${ev['account_age_days']} days**. ` +
          (Number(ev['followers']) > 100
            ? 'This indicates an established presence in the community.'
            : 'This is a relatively new or low-activity account.'),
        );
      } else if (sig.signal_type === 'repo_health' && ev['stars'] !== undefined) {
        lines.push(
          `The repository has **${ev['stars']} stars** and **${ev['forks']} forks**, ` +
          `last pushed **${ev['days_since_push']} day(s) ago**. ` +
          (Number(ev['days_since_push']) < 30
            ? 'The project is actively maintained.'
            : Number(ev['days_since_push']) < 180
            ? 'The project has seen recent activity.'
            : 'The project may be unmaintained.') +
          (ev['license'] ? ` License: ${ev['license']}.` : ' No license detected.'),
        );
      } else if (ev['error']) {
        lines.push(`⚠️ Error collecting this signal: ${ev['error']}`);
      }
      lines.push('');
    }

    lines.push('### Overall Assessment');
    lines.push(
      `After fusing all signals using **Subjective Logic** (Jøsang, 2001) with ` +
      `Ev-Trust evolutionary stability adjustment (λ=0.15, arXiv:2512.16167v2), ` +
      `the projected trust score is **${(result.trust_score * 100).toFixed(1)}%** ` +
      `with **${(result.confidence * 100).toFixed(1)}%** confidence. ` +
      `This corresponds to a **${result.risk_level}** risk level.`,
    );
    lines.push('');
    lines.push(`**Recommendation:** ${recommendEmoji(result.recommendation)} ${result.recommendation.toUpperCase()}`);

    if (result.fraud_signals.length > 0) {
      lines.push('');
      lines.push('### ⚠️ Fraud Signals Detected');
      for (const fs of result.fraud_signals) {
        lines.push(`- **${fs.type}** [${fs.severity}]: ${fs.description}`);
      }
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
);

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
