import type {
  ClientConfig,
  TrustScore,
  Attestation,
  BehavioralOpts,
  BehavioralResult,
  BehavioralHistory,
} from './types.js';
import { TrstLyrError, PaymentRequiredError } from './types.js';

const DEFAULT_BASE_URL = 'https://api.trstlyr.ai';
const DEFAULT_TIMEOUT = 10_000;

const OUTCOME_MAP: Record<string, number> = { failed: 0, partial: 1, success: 2 };

export class TrstLyrClient {
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly apiKey?: string;
  private readonly strictMode: boolean;

  constructor(config: ClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.apiKey = config.apiKey;
    this.strictMode = config.strictMode ?? false;
  }

  // ── Public API ──

  async score(subject: string): Promise<TrustScore> {
    return this.get<TrustScore>(`/v1/trust/score/${encodeURIComponent(subject)}`);
  }

  async attest(subject: string): Promise<Attestation> {
    return this.post<Attestation>('/v1/attest', { subject });
  }

  async behavioral(opts: BehavioralOpts): Promise<BehavioralResult> {
    const body = {
      subject: opts.subject,
      interactionType: opts.interactionType ?? 'other',
      outcome: OUTCOME_MAP[opts.outcome] ?? 2,
      rating: opts.rating,
      evidenceURI: opts.evidenceURI,
      interactionAt: opts.interactionAt ?? Math.floor(Date.now() / 1000),
      valueUSDC: opts.value_usd ? Math.round(opts.value_usd * 100) : undefined,
    };
    return this.post<BehavioralResult>('/v1/attest/behavioral', body);
  }

  async behaviorHistory(subject: string): Promise<BehavioralHistory> {
    return this.get<BehavioralHistory>(`/v1/trust/behavior/${encodeURIComponent(subject)}`);
  }

  // ── HTTP primitives ──

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) h['Authorization'] = `Bearer ${this.apiKey}`;
    return h;
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(url, { ...init, signal: controller.signal });

      if (res.status === 402) {
        throw new PaymentRequiredError(await res.text().catch(() => undefined));
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new TrstLyrError(
          body || `HTTP ${res.status}`,
          res.status,
        );
      }

      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: this.headers(),
    });
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
  }
}
