// @ts-check
import { HttpError } from './http.js';

/**
 * @param {import('./types.d.ts').Env} env
 * @returns {string}
 */
export function reaiOrigin(env) {
  const raw = (env.REAI_ORIGIN || 'https://app.reai.no').replace(/\/+$/, '');
  const url = new URL(raw);
  const isLocal = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (url.protocol !== 'https:' && !isLocal) {
    throw new HttpError(500, 'Invalid REAI_ORIGIN configuration.');
  }
  return url.origin;
}

/**
 * Calls the ReAI Public API server-to-server.
 * @template T
 * @param {import('./types.d.ts').Env} env
 * @param {string} path
 * @param {{ token: string, tenantId?: number, method?: 'GET' | 'POST', query?: Record<string, string>, body?: unknown }} options
 * @returns {Promise<T>}
 */
export async function reaiRequest(env, path, options) {
  const url = new URL(path.replace(/^\/+/, '/'), reaiOrigin(env));
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      url.searchParams.set(key, value);
    }
  }
  /** @type {Record<string, string>} */
  const headers = {
    authorization: `Bearer ${options.token}`,
    accept: 'application/json',
    'accept-language': 'en',
  };
  if (options.tenantId !== undefined) {
    headers['x-tenant-id'] = String(options.tenantId);
  }
  let body;
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const response = await fetch(url, {
    method: options.method ?? (body === undefined ? 'GET' : 'POST'),
    headers,
    ...(body !== undefined ? { body } : {}),
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status >= 300 && response.status < 400) {
    throw new HttpError(502, 'Unexpected redirect from ReAI API.');
  }
  const text = await response.text();
  if (!response.ok) {
    let detail = '';
    try {
      const parsed = /** @type {{ detail?: unknown }} */ (JSON.parse(text));
      if (typeof parsed.detail === 'string') {
        detail = parsed.detail;
      }
    } catch {
      // Ignore non-JSON error bodies.
    }
    if (response.status === 401) {
      throw new HttpError(401, 'Your ReAI connection expired. Disconnect and connect again.');
    }
    if (response.status === 403) {
      throw new HttpError(403, 'Your ReAI account lacks permission for this action in the selected company.');
    }
    if (response.status === 409) {
      throw new HttpError(409, detail || 'This record conflicts with an existing ReAI record.');
    }
    throw new HttpError(
      response.status >= 400 && response.status < 500 ? response.status : 502,
      detail || `ReAI returned HTTP ${response.status}.`,
    );
  }
  return /** @type {T} */ (JSON.parse(text));
}

/**
 * Follows ReAI paginated list endpoints ({ items, hasNext }).
 * @template T
 * @param {import('./types.d.ts').Env} env
 * @param {string} path
 * @param {{ token: string, tenantId: number, query?: Record<string, string> }} options
 * @returns {Promise<T[]>}
 */
export async function reaiAll(env, path, options) {
  /** @type {T[]} */
  const all = [];
  for (let page = 1; page <= 100; page++) {
    const result = /** @type {{ items: T[], hasNext: boolean }} */ (
      await reaiRequest(env, path, {
        token: options.token,
        tenantId: options.tenantId,
        query: {
          ...(options.query ?? {}),
          page: String(page),
          pageSize: '200',
        },
      })
    );
    all.push(...result.items);
    if (!result.hasNext) {
      return all;
    }
  }
  throw new HttpError(502, 'ReAI pagination exceeded safety limit.');
}
