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
      'referrer-policy': 'strict-origin-when-cross-origin',
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
 * Supports both Origin header and unforgeable Fetch Metadata (Sec-Fetch-Site).
 * @param {Request} request
 * @returns {Response | null}
 */
export function requireSameOrigin(request) {
  const expected = new URL(request.url).origin;
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');

  if (origin && origin !== 'null') {
    if (origin !== expected) {
      return errorResponse('Cross-origin request rejected.', 403);
    }
    return null;
  }

  if (fetchSite) {
    if (fetchSite === 'same-origin') {
      return null;
    }
    return errorResponse('Cross-origin request rejected.', 403);
  }

  const referer = request.headers.get('referer');
  if (referer) {
    try {
      if (new URL(referer).origin === expected) {
        return null;
      }
    } catch {
      // Fall through to 403
    }
  }

  return errorResponse('Cross-origin request rejected.', 403);
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
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
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
