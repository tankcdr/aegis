// GitHubProvider — Phase 1 built-in signal provider (SPEC §6, PROVIDERS.md)
//
// Evaluates agents and skills by namespace "github". Produces two signal types:
//   • author_reputation — GitHub user credibility (account age, followers, repos)
//   • repo_health       — Repository quality (stars, recency, issues, license)

import type {
  EvaluateRequest,
  HealthStatus,
  Provider,
  ProviderMetadata,
  Signal,
  Subject,
} from '../types/index.js';

// ─── GitHub REST API types (minimal) ─────────────────────────────────────────

interface GitHubUser {
  login: string;
  followers: number;
  public_repos: number;
  created_at: string;
  hireable: boolean | null;
  blog: string | null;
  twitter_username: string | null;
}

interface GitHubRepo {
  full_name: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  pushed_at: string;
  license: { spdx_id: string } | null;
  description: string | null;
}

interface GitHubRateLimit {
  resources: {
    core: { limit: number; remaining: number; reset: number };
  };
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export class GitHubProvider implements Provider {
  private readonly token: string | undefined;
  private readonly baseUrl = 'https://api.github.com';

  constructor(token?: string) {
    this.token = token ?? process.env['GITHUB_TOKEN'];
  }

  metadata(): ProviderMetadata {
    return {
      name: 'github',
      version: '1.0.0',
      description: 'GitHub author reputation and repository health signals',
      supported_subjects: ['agent', 'skill'],
      supported_namespaces: ['github'],
      signal_types: [
        {
          type: 'author_reputation',
          description:
            'GitHub user credibility: account age, followers, public repos, contribution activity',
        },
        {
          type: 'repo_health',
          description:
            'Repository quality: stars, forks, recency, issue resolution ratio',
        },
      ],
      rate_limit: { requests_per_minute: 60, burst: 10 },
    };
  }

  supported(subject: Subject): boolean {
    return subject.namespace === 'github';
  }

  async evaluate(request: EvaluateRequest): Promise<Signal[]> {
    const { subject } = request;
    if (!this.supported(subject)) return [];

    // Parse id: "owner", "owner/repo", or "owner/repo#ref"
    const withoutRef = subject.id.split('#')[0] ?? subject.id;
    const parts = withoutRef.split('/');
    const owner = parts[0];
    const repo = parts[1]; // may be undefined

    if (!owner) return [];

    const signals: Signal[] = [];
    const timestamp = new Date().toISOString();

    // ── author_reputation ─────────────────────────────────────────────────────
    try {
      const user = await this.fetchUser(owner);
      const ageDays =
        (Date.now() - new Date(user.created_at).getTime()) / 86_400_000;

      const followerScore = Math.min(user.followers / 1000, 1.0) * 0.3;
      const repoScore = Math.min(user.public_repos / 50, 1.0) * 0.2;
      const ageScore = Math.min(ageDays / 730, 1.0) * 0.3;
      const hireableBonus = user.hireable ? 0.1 : 0.0;
      const blogBonus = user.blog ? 0.05 : 0.0;
      const twitterBonus = user.twitter_username ? 0.05 : 0.0;

      const score = Math.min(
        followerScore + repoScore + ageScore + hireableBonus + blogBonus + twitterBonus,
        1.0,
      );
      const confidence = Math.min(0.5 + user.followers / 2000, 0.95);

      signals.push({
        provider: 'github',
        signal_type: 'author_reputation',
        score,
        confidence,
        evidence: {
          login: user.login,
          followers: user.followers,
          public_repos: user.public_repos,
          account_age_days: Math.round(ageDays),
          created_at: user.created_at,
          hireable: user.hireable,
          blog: user.blog,
          twitter_username: user.twitter_username,
        },
        timestamp,
        ttl: 3600,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // 404 → subject not found, silently skip
      if (!message.includes('404')) {
        signals.push({
          provider: 'github',
          signal_type: 'author_reputation',
          score: 0,
          confidence: 0.3,
          evidence: { error: message, owner },
          timestamp,
          ttl: 300,
        });
      }
    }

    // ── repo_health (only when id contains "/") ────────────────────────────────
    if (repo) {
      try {
        const repoData = await this.fetchRepo(owner, repo);
        const daysSincePush =
          (Date.now() - new Date(repoData.pushed_at).getTime()) / 86_400_000;

        const starScore = Math.min(repoData.stargazers_count / 1000, 1.0) * 0.25;
        const forkScore = Math.min(repoData.forks_count / 200, 1.0) * 0.15;
        const recencyScore = Math.max(0, 1 - daysSincePush / 365) * 0.3;
        const issuesRatio =
          repoData.open_issues_count > 0
            ? Math.max(
                0,
                1 - repoData.open_issues_count / (repoData.stargazers_count + 1),
              ) * 0.15
            : 0.15;
        const licenseBonus = repoData.license ? 0.1 : 0.0;
        const descriptionBonus = repoData.description ? 0.05 : 0.0;

        const score = Math.min(
          starScore +
            forkScore +
            recencyScore +
            issuesRatio +
            licenseBonus +
            descriptionBonus,
          1.0,
        );
        const confidence = Math.min(
          0.4 + repoData.stargazers_count / 5000,
          0.9,
        );

        signals.push({
          provider: 'github',
          signal_type: 'repo_health',
          score,
          confidence,
          evidence: {
            full_name: repoData.full_name,
            stars: repoData.stargazers_count,
            forks: repoData.forks_count,
            open_issues: repoData.open_issues_count,
            pushed_at: repoData.pushed_at,
            days_since_push: Math.round(daysSincePush),
            license: repoData.license?.spdx_id ?? null,
            has_description: Boolean(repoData.description),
          },
          timestamp,
          ttl: 1800,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes('404')) {
          signals.push({
            provider: 'github',
            signal_type: 'repo_health',
            score: 0,
            confidence: 0.3,
            evidence: { error: message, repo: `${owner}/${repo}` },
            timestamp,
            ttl: 300,
          });
        }
      }
    }

    return signals;
  }

  async health(): Promise<HealthStatus> {
    const lastCheck = new Date().toISOString();
    try {
      const data = await this.fetch<GitHubRateLimit>('/rate_limit');
      const { remaining } = data.resources.core;
      const status =
        remaining > 10 ? 'healthy' : remaining > 0 ? 'degraded' : 'unhealthy';
      return {
        status,
        last_check: lastCheck,
        avg_response_ms: 0,
        error_rate_1h: 0,
        dependencies: { 'api.github.com': status },
      };
    } catch {
      return {
        status: 'unhealthy',
        last_check: lastCheck,
        avg_response_ms: 0,
        error_rate_1h: 1,
        dependencies: { 'api.github.com': 'unhealthy' },
      };
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async fetchUser(owner: string): Promise<GitHubUser> {
    return this.fetch<GitHubUser>(`/users/${encodeURIComponent(owner)}`);
  }

  private async fetchRepo(owner: string, repo: string): Promise<GitHubRepo> {
    return this.fetch<GitHubRepo>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    );
  }

  private async fetch<T>(path: string): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'aegis-protocol/1.0',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await globalThis.fetch(`${this.baseUrl}${path}`, { headers });

    if (res.status === 404) {
      throw new Error(`404 Not Found: ${path}`);
    }
    if (res.status === 403 || res.status === 429) {
      const retryAfter = res.headers.get('Retry-After') ?? 'unknown';
      throw new Error(
        `Rate limited (${res.status}): retry after ${retryAfter}s`,
      );
    }
    if (!res.ok) {
      throw new Error(`GitHub API error ${res.status} for ${path}`);
    }

    return res.json() as Promise<T>;
  }
}
