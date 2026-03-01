/**
 * Shared HTTP fetch utility for providers.
 * Provides consistent timeout, auth, and error handling across all providers.
 */

export interface FetchOptions {
  /** Bearer token — sets Authorization: Bearer <token> */
  bearerToken?: string;
  /** Arbitrary additional headers */
  headers?: Record<string, string>;
  /** Request method (default: GET) */
  method?: string;
  /** JSON-serialisable request body (sets Content-Type: application/json) */
  body?: unknown;
  /** Timeout in milliseconds (default: 10_000) */
  timeoutMs?: number;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Fetch JSON from a URL with consistent timeout, auth, and status-code error handling.
 * Throws HttpError for non-2xx responses (caller can inspect .status).
 */
export async function providerFetch<T = unknown>(
  url: string,
  options: FetchOptions = {},
): Promise<T> {
  const { bearerToken, headers = {}, method = 'GET', body, timeoutMs = 10_000 } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const reqHeaders: Record<string, string> = {
    'Accept': 'application/json',
    ...headers,
  };

  if (bearerToken) {
    reqHeaders['Authorization'] = `Bearer ${bearerToken}`;
  }

  let reqBody: string | undefined;
  if (body !== undefined) {
    reqBody = JSON.stringify(body);
    reqHeaders['Content-Type'] = 'application/json';
  }

  let res: Response;
  try {
    res = await globalThis.fetch(url, {
      method,
      headers: reqHeaders,
      body: reqBody,
      signal: controller.signal,
    });
  } catch (err: unknown) {
    if ((err as Error).name === 'AbortError') {
      throw new HttpError(408, `Request timeout after ${timeoutMs}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new HttpError(res.status, `HTTP ${res.status} from ${url}${detail ? ': ' + detail.slice(0, 200) : ''}`);
  }

  return res.json() as Promise<T>;
}

/**
 * Fetch raw text from a URL (for oEmbed, gist raw content, etc.)
 */
export async function providerFetchText(
  url: string,
  options: Omit<FetchOptions, 'body'> = {},
): Promise<string> {
  const { bearerToken, headers = {}, timeoutMs = 10_000 } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const reqHeaders: Record<string, string> = { ...headers };
  if (bearerToken) reqHeaders['Authorization'] = `Bearer ${bearerToken}`;

  let res: Response;
  try {
    res = await globalThis.fetch(url, {
      headers: reqHeaders,
      signal: controller.signal,
    });
  } catch (err: unknown) {
    if ((err as Error).name === 'AbortError') {
      throw new HttpError(408, `Request timeout after ${timeoutMs}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new HttpError(res.status, `HTTP ${res.status} from ${url}`);
  }

  return res.text();
}
