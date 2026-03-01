import { providerFetch, providerFetchText, HttpError } from './http.js';
// ClawHub Provider — skill adoption and author portfolio signals (SPEC §6)
//
// ClawHub is the OpenClaw skill marketplace (clawhub.ai).
// No API key required — fully public API.
//
// Subject formats accepted:
//   clawhub:skill/weather          — specific skill by slug
//   clawhub:author/steipete        — author's full portfolio
//   clawhub:steipete               — shorthand for author (no "skill/" prefix = author)

import type {
  EvaluateRequest,
  HealthStatus,
  Provider,
  ProviderMetadata,
  Signal,
  Subject,
} from '../types/index.js';

const CLAWHUB_API = 'https://clawhub.ai/api/v1';

// ─── API types ────────────────────────────────────────────────────────────────

interface SkillStats {
  comments: number;
  downloads: number;
  installsAllTime: number;
  installsCurrent: number;   // active installs right now — killer signal
  stars: number;
  versions: number;
}

interface SkillItem {
  slug: string;
  displayName: string;
  summary: string;
  stats: SkillStats;
  createdAt: number;
  updatedAt: number;
  latestVersion?: { version: string; createdAt: number };
}

interface SkillDetailResponse {
  skill: SkillItem;
  owner?: { handle: string; userId: string; displayName: string };
  moderation?: null | { status: string };
  latestVersion?: { version: string; createdAt: number };
}

interface SkillListResponse {
  items: SkillItem[];
  nextCursor?: string;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export class ClawHubProvider implements Provider {
  metadata(): ProviderMetadata {
    return {
      name: 'clawhub',
      version: '1.0.0',
      description: 'ClawHub skill marketplace — adoption metrics and author portfolio signals',
      supported_subjects: ['agent', 'skill'],
      supported_namespaces: ['clawhub'],
      signal_types: [
        {
          type: 'skill_adoption',
          description: 'Skill quality: active installs, stars, downloads, community engagement, version history',
        },
        {
          type: 'author_portfolio',
          description: 'Author credibility: total published skills, aggregate installs, community reception',
        },
      ],
      rate_limit: { requests_per_minute: 120, burst: 20 },
    };
  }

  supported(subject: Subject): boolean {
    return subject.namespace === 'clawhub';
  }

  async evaluate(request: EvaluateRequest): Promise<Signal[]> {
    const { subject } = request;
    if (!this.supported(subject)) return [];

    const timestamp = new Date().toISOString();
    const { kind, name } = this.parseId(subject.id);

    if (kind === 'skill') {
      return this.evaluateSkill(name, timestamp);
    } else {
      return this.evaluateAuthor(name, timestamp);
    }
  }

  async health(): Promise<HealthStatus> {
    const lastCheck = new Date().toISOString();
    try {
      const res = await globalThis.fetch(`${CLAWHUB_API}/skills?limit=1`);
      return {
        status: res.ok ? 'healthy' : 'degraded',
        last_check: lastCheck,
        avg_response_ms: 0,
        error_rate_1h: 0,
        dependencies: { 'clawhub.ai': res.ok ? 'healthy' : 'degraded' },
      };
    } catch {
      return {
        status: 'unhealthy',
        last_check: lastCheck,
        avg_response_ms: 0,
        error_rate_1h: 1,
        dependencies: { 'clawhub.ai': 'unhealthy' },
      };
    }
  }

  // ── Skill evaluation ────────────────────────────────────────────────────────

  private async evaluateSkill(slug: string, timestamp: string): Promise<Signal[]> {
    try {
      const resp = await this.fetchSkill(slug);
      const skill = resp.skill;
      const s = skill.stats;

      // Days since last update — recency matters
      const daysSinceUpdate  = (Date.now() - skill.updatedAt) / 86_400_000;
      const daysSinceCreated = (Date.now() - skill.createdAt) / 86_400_000;

      // Moderation flag — explicitly moderated = flagged (null/undefined = clean)
      const flagged = resp.moderation != null && typeof resp.moderation === 'object';

      // Score components
      const currentInstallScore = Math.min(s.installsCurrent / 200, 1.0) * 0.35;
      const starScore           = Math.min(s.stars / 100, 1.0) * 0.25;
      const downloadScore       = Math.min(s.downloads / 5000, 1.0) * 0.15;
      const commentScore        = Math.min(s.comments / 20, 1.0) * 0.10;
      const versionScore        = Math.min(s.versions / 5, 1.0) * 0.05;
      const recencyScore        = Math.max(0, 1 - daysSinceUpdate / 180) * 0.10;

      const score = flagged ? 0.0 : Math.min(
        currentInstallScore + starScore + downloadScore + commentScore + versionScore + recencyScore,
        1.0,
      );

      const confidence = flagged
        ? 0.95
        : Math.min(0.40 + s.installsCurrent / 400, 0.92);

      return [{
        provider: 'clawhub',
        signal_type: 'skill_adoption',
        score,
        confidence,
        evidence: {
          slug: skill.slug,
          display_name: skill.displayName,
          installs_current: s.installsCurrent,
          installs_all_time: s.installsAllTime,
          stars: s.stars,
          downloads: s.downloads,
          comments: s.comments,
          versions: s.versions,
          days_since_update: Math.round(daysSinceUpdate),
          age_days: Math.round(daysSinceCreated),
          flagged,
          owner: resp.owner?.handle ?? null,
        },
        timestamp,
        ttl: 1800,
      }];

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('404')) return [];
      return [{
        provider: 'clawhub',
        signal_type: 'skill_adoption',
        score: 0,
        confidence: 0.3,
        evidence: { error: message, slug },
        timestamp,
        ttl: 120,
      }];
    }
  }

  // ── Author evaluation ───────────────────────────────────────────────────────

  private async evaluateAuthor(handle: string, timestamp: string): Promise<Signal[]> {
    try {
      const skills = await this.fetchAuthorSkills(handle);

      if (skills.length === 0) return []; // author not found or no skills

      // Aggregate across portfolio
      const totalCurrentInstalls = skills.reduce((n, s) => n + s.stats.installsCurrent, 0);
      const totalAllTimeInstalls  = skills.reduce((n, s) => n + s.stats.installsAllTime, 0);
      const totalStars            = skills.reduce((n, s) => n + s.stats.stars, 0);
      const totalDownloads        = skills.reduce((n, s) => n + s.stats.downloads, 0);
      const totalComments         = skills.reduce((n, s) => n + s.stats.comments, 0);
      const skillCount            = skills.length;

      // Best performing skill installs — a breakout skill is a strong signal
      const maxInstalls = Math.max(...skills.map(s => s.stats.installsCurrent));

      // Score components
      const portfolioSizeScore  = Math.min(skillCount / 10, 1.0) * 0.15;
      const totalInstallScore   = Math.min(totalCurrentInstalls / 1000, 1.0) * 0.35;
      const starScore           = Math.min(totalStars / 200, 1.0) * 0.20;
      const downloadScore       = Math.min(totalDownloads / 10_000, 1.0) * 0.15;
      const breakoutScore       = Math.min(maxInstalls / 500, 1.0) * 0.10;
      const engagementScore     = Math.min(totalComments / 30, 1.0) * 0.05;

      const score = Math.min(
        portfolioSizeScore + totalInstallScore + starScore + downloadScore + breakoutScore + engagementScore,
        1.0,
      );

      const confidence = Math.min(0.40 + totalCurrentInstalls / 2000, 0.90);

      // Oldest skill creation date = author tenure
      const oldestSkill = Math.min(...skills.map(s => s.createdAt));
      const authorAgeDays = (Date.now() - oldestSkill) / 86_400_000;

      return [{
        provider: 'clawhub',
        signal_type: 'author_portfolio',
        score,
        confidence,
        evidence: {
          handle,
          skill_count: skillCount,
          total_installs_current: totalCurrentInstalls,
          total_installs_all_time: totalAllTimeInstalls,
          total_stars: totalStars,
          total_downloads: totalDownloads,
          total_comments: totalComments,
          best_skill_installs: maxInstalls,
          author_age_days: Math.round(authorAgeDays),
          top_skills: skills
            .sort((a, b) => b.stats.installsCurrent - a.stats.installsCurrent)
            .slice(0, 3)
            .map(s => ({ slug: s.slug, installs: s.stats.installsCurrent, stars: s.stats.stars })),
        },
        timestamp,
        ttl: 1800,
      }];

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('404')) return [];
      return [{
        provider: 'clawhub',
        signal_type: 'author_portfolio',
        score: 0,
        confidence: 0.3,
        evidence: { error: message, handle },
        timestamp,
        ttl: 120,
      }];
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private parseId(id: string): { kind: 'skill' | 'author'; name: string } {
    if (id.startsWith('skill/')) return { kind: 'skill', name: id.slice(6) };
    if (id.startsWith('author/')) return { kind: 'author', name: id.slice(7) };
    // Heuristic: slugs with hyphens and no uppercase = skill slug
    // Handles are typically lowercase alphanumeric
    // Default to author if ambiguous — author lookup is more common
    return { kind: 'author', name: id };
  }

  private async fetchSkill(slug: string): Promise<SkillDetailResponse> {
    const res = await globalThis.fetch(`${CLAWHUB_API}/skills/${encodeURIComponent(slug)}`);
    if (res.status === 404) throw new Error(`404: skill "${slug}" not found`);
    if (!res.ok) throw new Error(`ClawHub API error ${res.status}`);
    const body = await res.json() as SkillDetailResponse;
    if (!body.skill) throw new Error(`No skill data for "${slug}"`);
    return body;
  }

  private async fetchAuthorSkills(handle: string): Promise<SkillItem[]> {
    const url = `${CLAWHUB_API}/skills?author=${encodeURIComponent(handle)}&limit=50`;
    let body: SkillListResponse;
    try { body = await providerFetch<SkillListResponse>(url); } catch { return []; }
    return body.items ?? [];
  }
}
