// @ts-check

const HTML_ESCAPE = /[&<>"']/g;
/** @type {Record<string, string>} */
const ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapes untrusted text for safe insertion into HTML text or quoted attributes.
 * @param {string} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return value.replace(HTML_ESCAPE, (ch) => ESCAPE_MAP[ch] ?? ch);
}

export class SafeHtml {
  /**
   * @param {string} value
   */
  constructor(value) {
    this.value = value;
  }

  toString() {
    return this.value;
  }
}

/**
 * @typedef {SafeHtml | string | number | boolean | null | undefined | HtmlValue[]} HtmlValue
 */

/**
 * Marks an already-safe HTML string so html`` will not double-escape it.
 * @param {string} value
 * @returns {SafeHtml}
 */
export function raw(value) {
  return new SafeHtml(value);
}

/**
 * @param {HtmlValue} value
 * @returns {string}
 */
function renderValue(value) {
  if (value === null || value === undefined || value === false) {
    return '';
  }
  if (value instanceof SafeHtml) {
    return value.value;
  }
  if (Array.isArray(value)) {
    return value.map(renderValue).join('');
  }
  return escapeHtml(String(value));
}

/**
 * Auto-escaping HTML tagged template literal for zero-framework SSR.
 * @param {TemplateStringsArray} strings
 * @param {...HtmlValue} values
 * @returns {SafeHtml}
 */
export function html(strings, ...values) {
  let out = strings[0] ?? '';
  for (let i = 0; i < values.length; i++) {
    out += renderValue(values[i]) + (strings[i + 1] ?? '');
  }
  return new SafeHtml(out);
}

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
 * Returns an HTML response (full page or HTMX fragment) with strict security headers.
 * @param {SafeHtml} markup
 * @param {number} [status]
 * @param {Record<string, string>} [extraHeaders]
 * @returns {Response}
 */
export function htmlResponse(markup, status = 200, extraHeaders = {}) {
  return new Response(markup.value, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': APP_CSP,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
      ...extraHeaders,
    },
  });
}
