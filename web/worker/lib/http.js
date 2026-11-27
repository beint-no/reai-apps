// @ts-check

const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * @param {unknown} data
 * @param {number} [status]
 * @param {Record<string, string>} [extraHeaders]
 * @returns {Response}
 */
export function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
      ...extraHeaders,
    },
  });
}

/**
 * @param {string} message
 * @param {number} [status]
 * @returns {Response}
 */
export function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

/**
 * Verifies same-origin for mutating browser requests to block CSRF.
 * @param {Request} request
 * @returns {Response | null}
 */
export function requireSameOrigin(request) {
  const origin = request.headers.get('origin');
  const expected = new URL(request.url).origin;
  if (!origin || origin !== expected) {
    return errorResponse('Cross-origin request rejected.', 403);
  }
  return null;
}

/**
 * Reads and parses a bounded JSON request body.
 * @param {Request} request
 * @param {number} [maxBytes]
 * @returns {Promise<unknown>}
 */
export async function readJsonBody(request, maxBytes = 2_000_000) {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new HttpError(413, 'Request payload exceeds size limit.');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

/**
 * Wraps a static asset response under /app/* with strict app security headers.
 * @param {Response} response
 * @returns {Response}
 */
export function withAppHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('content-security-policy', APP_CSP);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('x-frame-options', 'DENY');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
