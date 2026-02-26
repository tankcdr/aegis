'use client';

import { useState, useEffect, useCallback } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'https://api.trstlyr.ai';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrustResult {
  subject: string;
  trust_score: number;
  confidence: number;
  risk_level: string | { level: string };
  recommendation: string;
  signals: Signal[];
  evaluated_at: string;
}

interface Signal {
  provider: string;
  signal_type: string;
  score: number;
  confidence: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function riskLevel(result: TrustResult): string {
  if (!result.risk_level) return 'unknown';
  if (typeof result.risk_level === 'string') return result.risk_level;
  return result.risk_level.level ?? 'unknown';
}

function scoreColor(score: number): string {
  if (score >= 80) return '#22c55e';
  if (score >= 60) return '#84cc16';
  if (score >= 40) return '#eab308';
  if (score >= 20) return '#f97316';
  return '#ef4444';
}

const RISK_STYLES: Record<string, string> = {
  low:      'bg-green-500/15 text-green-400 border-green-500/30',
  medium:   'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  high:     'bg-orange-500/15 text-orange-400 border-orange-500/30',
  critical: 'bg-red-500/15 text-red-400 border-red-500/30',
};

const EXAMPLES = [
  'erc8004:19077',
  'github:tankcdr',
  'github:tankcdr/aegis',
  'clawhub:skill/weather',
];

// ─── Components ───────────────────────────────────────────────────────────────

function ScoreRing({ score, color, loading }: { score: number; color: string; loading: boolean }) {
  const r = 52;
  const circ = 2 * Math.PI * r;
  const dash = loading ? 0 : (score / 100) * circ;

  return (
    <svg width="136" height="136" viewBox="0 0 136 136" className="shrink-0">
      {/* Track */}
      <circle cx="68" cy="68" r={r} fill="none" stroke="#1e1e2e" strokeWidth="10" />
      {/* Progress */}
      <circle
        cx="68" cy="68" r={r}
        fill="none"
        stroke={loading ? '#1e1e2e' : color}
        strokeWidth="10"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 68 68)"
        style={{ transition: 'stroke-dasharray 0.7s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.3s ease' }}
      />
      {/* Score text */}
      {loading ? (
        <text x="68" y="74" textAnchor="middle" fontSize="14" fill="#334155" fontFamily="monospace">
          ...
        </text>
      ) : (
        <>
          <text x="68" y="64" textAnchor="middle" fontSize="30" fontWeight="700" fill="white" fontFamily="monospace">
            {Math.round(score)}
          </text>
          <text x="68" y="82" textAnchor="middle" fontSize="11" fill="#475569" fontFamily="monospace">
            / 100
          </text>
        </>
      )}
    </svg>
  );
}

const RECOMMENDATION_LABELS: Record<string, string> = {
  install:  '✅ Safe to install',
  proceed:  '✅ Safe to proceed',
  caution:  '⚠️ Use with caution',
  deny:     '🚫 Do not proceed',
  review:   '🔍 Manual review advised',
};

function RiskBadge({ level }: { level: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-mono border ${RISK_STYLES[level] ?? RISK_STYLES['medium']}`}>
      {level} risk
    </span>
  );
}

function SignalBar({ signal }: { signal: Signal }) {
  const pct = Math.round(signal.score * 100);
  const color = scoreColor(pct);
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-mono text-slate-400 truncate">
            {signal.provider}<span className="text-slate-600"> · {signal.signal_type.replace(/_/g, ' ')}</span>
          </span>
          <span className="text-xs font-mono ml-2 shrink-0" style={{ color }}>
            {pct}
          </span>
        </div>
        <div className="h-1 bg-[#1e1e2e] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${pct}%`, backgroundColor: color }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Home() {
  const [input, setInput]     = useState('');
  const [result, setResult]   = useState<TrustResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [queried, setQueried] = useState('erc8004:19077');

  const query = useCallback(async (subject: string) => {
    const s = subject.trim();
    if (!s) return;
    setLoading(true);
    setError(null);
    setQueried(s);
    try {
      const res = await fetch(`${API_BASE}/v1/trust/score/${encodeURIComponent(s)}`);
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      setResult(await res.json() as TrustResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Query failed');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load Charon's own score on mount — dogfooding the product
  useEffect(() => { void query('erc8004:19077'); }, [query]);

  const color = result ? scoreColor(result.trust_score) : '#6366f1';

  return (
    <main className="min-h-screen bg-[#0a0a0f] text-slate-100">

      {/* ── Nav ───────────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-10 border-b border-[#1e1e2e] bg-[#0a0a0f]/90 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-lg">🛡️</span>
            <span className="font-mono font-bold text-white tracking-tight">trstlyr.ai</span>
            <span className="hidden sm:inline text-xs font-mono text-slate-600 bg-[#1e1e2e] px-1.5 py-0.5 rounded">
              v0.2.0
            </span>
          </div>
          <div className="flex items-center gap-5 text-sm text-slate-400">
            <a href="/skill.md" className="hover:text-white transition-colors font-mono text-xs">
              skill.md
            </a>
            <a
              href="https://github.com/tankcdr/aegis"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors flex items-center gap-1"
            >
              GitHub
              <span className="text-slate-600">↗</span>
            </a>
          </div>
        </div>
      </nav>

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 pt-16 pb-12">
        <div className="inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 rounded-full px-3 py-1 text-xs text-indigo-400 font-mono mb-8">
          <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-pulse" />
          Live on Base Mainnet · EAS attestations · x402 payments
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
          {/* Left — headline */}
          <div>
            <h1 className="text-4xl sm:text-5xl font-bold text-white leading-tight mb-5">
              Trust scores for the{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">
                agent internet
              </span>
            </h1>
            <p className="text-base text-slate-400 leading-relaxed mb-8 max-w-lg">
              Before you install a skill, execute code, or delegate to another agent —
              check trstlyr.ai first. Web2 + web3 signals fused with Subjective Logic into
              one verifiable trust score.
            </p>
            <div className="flex flex-wrap gap-3">
              <a
                href="/skill.md"
                className="bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white px-5 py-2.5 rounded-lg font-mono text-sm transition-colors"
              >
                Read skill.md →
              </a>
              <a
                href="https://github.com/tankcdr/aegis"
                target="_blank"
                rel="noopener noreferrer"
                className="border border-[#1e1e2e] hover:border-slate-600 text-slate-300 hover:text-white px-5 py-2.5 rounded-lg text-sm transition-colors"
              >
                View source
              </a>
            </div>
          </div>

          {/* Right — live demo */}
          <div className="bg-[#12121a] border border-[#1e1e2e] rounded-2xl p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span className="text-xs font-mono text-slate-400">Live trust query</span>
              </div>
              {result && (
                <span className="text-xs font-mono text-slate-600 truncate max-w-[140px]">
                  {queried}
                </span>
              )}
            </div>

            {/* Input */}
            <div className="flex gap-2 mb-5">
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && void query(input || 'erc8004:19077')}
                placeholder="github:tankcdr · erc8004:19077"
                className="flex-1 min-w-0 bg-[#0a0a0f] border border-[#1e1e2e] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm font-mono text-slate-300 placeholder-slate-700 outline-none transition-colors"
              />
              <button
                onClick={() => void query(input || 'erc8004:19077')}
                disabled={loading}
                className="shrink-0 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-mono transition-colors"
              >
                {loading ? '···' : 'Check'}
              </button>
            </div>

            {/* Examples */}
            <div className="flex flex-wrap gap-1.5 mb-5">
              {EXAMPLES.map(ex => (
                <button
                  key={ex}
                  onClick={() => { setInput(ex); void query(ex); }}
                  className="text-xs font-mono text-slate-600 hover:text-slate-400 bg-[#0a0a0f] border border-[#1e1e2e] hover:border-slate-700 px-2 py-0.5 rounded transition-colors"
                >
                  {ex}
                </button>
              ))}
            </div>

            {/* Error */}
            {error && (
              <div className="text-red-400 text-xs font-mono bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-4">
                {error}
              </div>
            )}

            {/* Result */}
            {(result || loading) && !error && (
              <div className="space-y-4">
                {/* Score + recommendation */}
                <div className="flex items-center gap-5">
                  <ScoreRing score={result?.trust_score ?? 0} color={color} loading={loading && !result} />
                  <div className="flex-1 min-w-0">
                    {loading && !result ? (
                      <div className="space-y-2">
                        <div className="h-4 bg-[#1e1e2e] rounded animate-pulse w-3/4" />
                        <div className="h-3 bg-[#1e1e2e] rounded animate-pulse w-1/2" />
                        <div className="h-3 bg-[#1e1e2e] rounded animate-pulse w-2/3" />
                      </div>
                    ) : result ? (
                      <>
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <RiskBadge level={riskLevel(result)} />
                        </div>
                        <div className="text-sm font-semibold mb-1" style={{ color }}>
                          {RECOMMENDATION_LABELS[result.recommendation] ?? result.recommendation.replace(/_/g, ' ')}
                        </div>
                        <div className="text-xs text-slate-500 mb-1">
                          Score confidence: <span className="text-slate-300">{Math.round(result.confidence * 100)}%</span>
                          <span className="text-slate-600 ml-1">(how much signal data we have)</span>
                        </div>
                        <div className="text-xs text-slate-600 font-mono">
                          {result.signals.length} signal{result.signals.length !== 1 ? 's' : ''} · {new Date(result.evaluated_at).toLocaleTimeString()}
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>

                {/* Signal bars */}
                {result && result.signals.length > 0 && (
                  <div className="border-t border-[#1e1e2e] pt-4 space-y-2.5">
                    {result.signals.slice(0, 5).map((s, i) => (
                      <SignalBar key={i} signal={s} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Agent CTA ─────────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 py-12 border-t border-[#1e1e2e]">
        <div className="bg-gradient-to-br from-indigo-500/10 to-violet-500/10 border border-indigo-500/20 rounded-2xl p-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
            <div>
              <div className="text-xs font-mono text-indigo-400 uppercase tracking-widest mb-3">For Agents</div>
              <h2 className="text-2xl font-bold text-white mb-3">
                Build your trust score
              </h2>
              <p className="text-slate-400 text-sm leading-relaxed mb-4">
                Register your GitHub, Twitter/X, or on-chain identity. Each verified identity
                adds signal — the more you prove, the higher your score and the more doors open.
              </p>
              <ul className="space-y-2 text-sm text-slate-400">
                {[
                  { ns: 'github:', desc: 'repo health, stars, commit history' },
                  { ns: 'twitter:', desc: 'account age, followers, activity' },
                  { ns: 'erc8004:', desc: 'on-chain agent identity registry' },
                ].map(({ ns, desc }) => (
                  <li key={ns} className="flex items-start gap-2">
                    <span className="text-indigo-400 font-mono shrink-0">{ns}</span>
                    <span>{desc}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1e1e2e]">
                <span className="text-xs font-mono text-slate-500">Register your identity</span>
                <span className="text-xs font-mono text-indigo-400">POST /v1/identity/register</span>
              </div>
              <pre className="px-5 py-4 text-xs font-mono text-slate-300 overflow-x-auto leading-relaxed">
{`# Step 1 — request a challenge
curl -X POST https://api.trstlyr.ai/v1/identity/register \\
  -H "Content-Type: application/json" \\
  -d '{
    "subject": { "namespace": "github", "id": "your-handle" }
  }'

# → returns a challenge string to post as a gist

# Step 2 — prove ownership
curl -X POST https://api.trstlyr.ai/v1/identity/verify \\
  -H "Content-Type: application/json" \\
  -d '{
    "challenge_id": "<id>",
    "gist_url": "https://gist.github.com/your-handle/<id>"
  }'`}
              </pre>
              <div className="px-5 py-3 border-t border-[#1e1e2e] flex items-center justify-between">
                <span className="text-xs text-slate-600">No API key required · Free forever</span>
                <a
                  href="/skill.md"
                  className="text-xs font-mono text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  Full docs in skill.md →
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 py-12 border-t border-[#1e1e2e]">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            {
              icon: '🔗',
              title: 'Web2 + Web3 signals',
              desc: 'GitHub reputation, ERC-8004 identity, ClawHub skill adoption, Moltbook karma — fused with Subjective Logic and Ev-Trust.',
            },
            {
              icon: '⛓️',
              title: 'On-chain attestations',
              desc: 'Anchor any trust score as an EAS attestation on Base Mainnet. First one free, then $0.01 USDC via x402.',
            },
            {
              icon: '🤖',
              title: 'Agent-native',
              desc: 'MCP server for Claude Desktop. REST API for everything else. Read skill.md — you\'re up in two minutes.',
            },
          ].map((f, i) => (
            <div
              key={i}
              className="bg-[#12121a] border border-[#1e1e2e] hover:border-indigo-500/20 rounded-xl p-5 transition-colors"
            >
              <div className="text-2xl mb-3">{f.icon}</div>
              <div className="font-semibold text-white mb-1.5 text-sm">{f.title}</div>
              <div className="text-xs text-slate-400 leading-relaxed">{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Quick start ───────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 py-12 border-t border-[#1e1e2e]">
        <h2 className="text-sm font-mono text-slate-500 uppercase tracking-widest mb-4">
          Quick start
        </h2>
        <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl overflow-hidden">
          <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-[#1e1e2e]">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
          </div>
          <pre className="px-5 py-4 text-xs font-mono text-slate-300 overflow-x-auto leading-relaxed">
{`# Query a trust score (free)
curl https://api.trstlyr.ai/v1/trust/score/github:tankcdr

# Anchor on-chain — 1 free per subject, $0.01 USDC via x402 after
curl -X POST https://api.trstlyr.ai/v1/attest \\
  -H "Content-Type: application/json" \\
  -d '{"subject": "github:tankcdr"}'

# Self-host with Docker
git clone https://github.com/tankcdr/aegis && cd aegis
docker compose up -d`}
          </pre>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="border-t border-[#1e1e2e] mt-4">
        <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
          <div className="font-mono flex items-center gap-2">
            <span>⛵</span>
            <span>Built by Charon for the Synthesis Hackathon · Apache 2.0</span>
          </div>
          <div className="flex items-center gap-5 font-mono">
            <a href="/skill.md" className="hover:text-slate-400 transition-colors">skill.md</a>
            <a
              href="https://base.easscan.org/schema/view/0xfff1179b55bf0717c0a071da701b4f597a6bfe0669bcb1daca6a66f0e14d407d"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-slate-400 transition-colors"
            >
              EAS schema ↗
            </a>
            <a
              href="https://github.com/tankcdr/aegis"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-slate-400 transition-colors"
            >
              GitHub ↗
            </a>
          </div>
        </div>
      </footer>

    </main>
  );
}
