// GitHub Signal Provider — SPEC §6, PROVIDERS.md
// Produces: author_reputation, repo_health
// Supported namespaces: github, clawhub, npm

import type {
  Provider,
  ProviderMetadata,
  EvaluateRequest,
  Signal,
  HealthStatus,
  Subject,
} from '../types/index.js';

export class GitHubProvider implements Provider {
  constructor(private readonly token?: string) {}

  metadata(): ProviderMetadata {
    return {
      name: 'github',
      version: '1.0.0',
      description: 'GitHub account and repository reputation analysis',
      supported_subjects: ['agent', 'skill'],
      supported_namespaces: ['github', 'clawhub', 'npm'],
      signal_types: [
        { type: 'author_reputation', description: 'GitHub profile maturity, activity, and trust signals' },
        { type: 'repo_health', description: 'Repository maintenance, community, and security signals' },
      ],
      rate_limit: { requests_per_minute: 60, burst: 10 },
    };
  }

  supported(subject: Subject): boolean {
    return ['github', 'clawhub', 'npm'].includes(subject.namespace);
  }

  async evaluate(_request: EvaluateRequest): Promise<Signal[]> {
    // TODO: implement — see PROVIDERS.md for scoring logic and evidence structure
    // SPEC §7.2: confidence ≤ 0.5 for single data point
    // SPEC §7.9: set TTL high enough to avoid artificial volatility
    throw new Error('GitHubProvider.evaluate() — implementation pending');
  }

  async health(): Promise<HealthStatus> {
    return {
      status: 'healthy',
      last_check: new Date().toISOString(),
      avg_response_ms: 0,
      error_rate_1h: 0,
      dependencies: { 'api.github.com': 'healthy' },
    };
  }
}
