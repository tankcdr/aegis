// Twitter/X Provider — social presence signals (SPEC §6)
//
// Uses Twitter API v2. Requires TWITTER_BEARER_TOKEN env var.
// Degrades gracefully (returns empty signals) without a token.
//
// Subject formats accepted:
//   twitter:username        — Twitter/X username (without @)
//   twitter:@username       — with @ prefix (stripped automatically)

import type {
  EvaluateRequest,
  HealthStatus,
  Provider,
  ProviderMetadata,
  Signal,
  Subject,
} from '../types/index.js';

const TWITTER_API = 'https://api.twitter.com/2';

interface TwitterUser {
  id: string;
  name: string;
  username: string;
  created_at?: string;
  description?: string;
  verified?: boolean;
  public_metrics?: {
    followers_count: number;
    following_count: number;
    tweet_count: number;
    listed_count: number;
  };
  entities?: {
    url?: { urls?: Array<{ expanded_url: string }> };
  };
}

interface TwitterUserResponse {
  data?: TwitterUser;
  errors?: Array<{ detail: string }>;
}

export class TwitterProvider implements Provider {
  private readonly bearerToken: string | undefined;

  constructor(bearerToken?: string) {
    this.bearerToken = bearerToken ?? process.env['TWITTER_BEARER_TOKEN'];
  }

  metadata(): ProviderMetadata {
    return {
      name: 'twitter',
      version: '1.0.0',
      description: 'Twitter/X social presence signals: account age, followers, activity',
      supported_subjects: ['agent', 'skill'],
      supported_namespaces: ['twitter'],
      signal_types: [
        {
          type: 'social_presence',
          description: 'Twitter/X account credibility: age, followers, activity, verification status',
        },
      ],
      rate_limit: { requests_per_minute: 15, burst: 5 },
    };
  }

  supported(subject: Subject): boolean {
    return subject.namespace === 'twitter';
  }

  async evaluate(request: EvaluateRequest): Promise<Signal[]> {
    const { subject } = request;
    if (!this.supported(subject)) return [];

    // No token = no signals, but not an error
    if (!this.bearerToken) return [];

    const username = subject.id.replace(/^@/, '');
    const timestamp = new Date().toISOString();

    try {
      const user = await this.fetchUser(username);

      const metrics = user.public_metrics;
      const createdAt = user.created_at
        ? new Date(user.created_at)
        : null;
      const ageDays = createdAt
        ? (Date.now() - createdAt.getTime()) / 86_400_000
        : 0;

      const followers     = metrics?.followers_count ?? 0;
      const tweets        = metrics?.tweet_count ?? 0;
      const listed        = metrics?.listed_count ?? 0;

      // Score components
      const ageScore      = Math.min(ageDays / 1825, 1.0) * 0.20;  // 5 years = max
      const followerScore = Math.min(followers / 10_000, 1.0) * 0.35;
      const tweetScore    = Math.min(tweets / 5_000, 1.0) * 0.20;
      const listedScore   = Math.min(listed / 500, 1.0) * 0.10;
      const verifiedBonus = user.verified ? 0.10 : 0.00;
      const bioBonus      = user.description ? 0.05 : 0.00;

      const score = Math.min(
        ageScore + followerScore + tweetScore + listedScore + verifiedBonus + bioBonus,
        1.0,
      );

      // Confidence scales with follower count (more followers = more observable signal)
      const confidence = Math.min(0.45 + followers / 20_000, 0.90);

      return [{
        provider: 'twitter',
        signal_type: 'social_presence',
        score,
        confidence,
        evidence: {
          username: user.username,
          name: user.name,
          followers,
          tweet_count: tweets,
          listed_count: listed,
          account_age_days: Math.round(ageDays),
          verified: user.verified ?? false,
          has_bio: Boolean(user.description),
          created_at: user.created_at ?? null,
        },
        timestamp,
        ttl: 3600,
      }];

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('404') || message.includes('not found')) return [];
      return [{
        provider: 'twitter',
        signal_type: 'social_presence',
        score: 0,
        confidence: 0.2,
        evidence: { error: message, username: subject.id },
        timestamp,
        ttl: 120,
      }];
    }
  }

  async health(): Promise<HealthStatus> {
    const lastCheck = new Date().toISOString();
    if (!this.bearerToken) {
      return {
        status: 'unhealthy',
        last_check: lastCheck,
        avg_response_ms: 0,
        error_rate_1h: 0,
        dependencies: { 'api.twitter.com': 'unhealthy' },
      };
    }
    try {
      const res = await globalThis.fetch(`${TWITTER_API}/tweets/search/recent?query=hello&max_results=10`, {
        headers: { Authorization: `Bearer ${this.bearerToken}` },
      });
      const status = res.ok ? 'healthy' : res.status === 429 ? 'degraded' : 'unhealthy';
      return {
        status,
        last_check: lastCheck,
        avg_response_ms: 0,
        error_rate_1h: 0,
        dependencies: { 'api.twitter.com': status },
      };
    } catch {
      return {
        status: 'unhealthy',
        last_check: lastCheck,
        avg_response_ms: 0,
        error_rate_1h: 1,
        dependencies: { 'api.twitter.com': 'unhealthy' },
      };
    }
  }

  private async fetchUser(username: string): Promise<TwitterUser> {
    const fields = 'created_at,description,verified,public_metrics,entities';
    const url = `${TWITTER_API}/users/by/username/${encodeURIComponent(username)}?user.fields=${fields}`;

    const res = await globalThis.fetch(url, {
      headers: { Authorization: `Bearer ${this.bearerToken!}` },
    });

    if (res.status === 404) throw new Error(`404: @${username} not found`);
    if (res.status === 429) throw new Error('Rate limited by Twitter API');
    if (!res.ok) throw new Error(`Twitter API error ${res.status}`);

    const body = await res.json() as TwitterUserResponse;
    if (body.errors?.length) throw new Error(body.errors[0]!.detail);
    if (!body.data) throw new Error(`No data returned for @${username}`);

    return body.data;
  }
}
