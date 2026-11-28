// @ts-check
import { html } from './html.js';
import { HttpError } from './http.js';
import { reaiCard } from './ui.js';

/**
 * @typedef {{ name: string, label: string, type?: 'text' | 'password' | 'url' | 'date', placeholder?: string, required?: boolean, defaultValue?: string }} ApiFieldSpec
 * @typedef {(input: string | URL, init?: RequestInit) => Promise<Response>} FetchLike
 */

const PRIVATE_HOST_RE =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)|(\.local|\.internal)$/i;

/**
 * Validates that an upstream API URL uses a public https:// host (SSRF guard).
 * @param {string} rawUrl
 * @returns {URL}
 */
export function assertPublicHttpsUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new HttpError(400, 'Enter a valid https:// API URL.');
  }
  if (parsed.protocol !== 'https:' || PRIVATE_HOST_RE.test(parsed.hostname)) {
    throw new HttpError(400, 'API URL must use a public https:// host.');
  }
  return parsed;
}

/** @param {unknown} v */
export function num(v) {
  const n = typeof v === 'number' ? v : Number(String(v ?? '0').replace(',', '.').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** @param {unknown} v @param {string} [fallback] */
export function isoDate(v, fallback) {
  const s = String(v ?? '').trim();
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(s)) return s.slice(0, 10);
  return fallback ?? new Date().toISOString().slice(0, 10);
}

/**
 * Extracts an array from common REST JSON envelopes.
 * @param {any} payload
 * @param {string[]} [keys]
 * @returns {any[]}
 */
export function pickList(payload, keys = ['items', 'values', 'data', 'records', 'results', 'entries', 'orders', 'expenses', 'shifts', 'users', 'invoices', 'transactions', 'consignments']) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const k of keys) {
    if (Array.isArray(payload[k])) return payload[k];
  }
  return [];
}

/**
 * Performs a bounded HTTPS JSON request with consistent error formatting.
 * @param {string} url
 * @param {RequestInit} init
 * @param {string} brand
 * @param {FetchLike} [fetchImpl]
 * @returns {Promise<any>}
 */
export async function fetchJson(url, init, brand, fetchImpl = fetch) {
  assertPublicHttpsUrl(url);
  const res = await fetchImpl(url, {
    ...init,
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const statusNote = res.status === 401 || res.status === 403 ? 'rejected the API key/token' : `returned HTTP ${res.status}`;
    throw new HttpError(400, `${brand} API ${statusNote}. Verify your credentials and permissions.`);
  }
  return res.json();
}

/**
 * Reusable SSR card for a provider's live REST API fetch form.
 * @param {{ basePath: string, targetId: string, brand: string, hint: string, fields: ApiFieldSpec[], extraFields?: import('./html.js').HtmlValue, sampleAction?: boolean }} opts
 */
export function renderApiFetchCard(opts) {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  return reaiCard({
    eyebrow: `LIVE ${opts.brand.toUpperCase()} REST API`,
    title: `Fetch live directly from ${opts.brand} API`,
    body: html`
      <p class="muted-note">${opts.hint} Credentials are used only for this single HTTPS request and are never stored.</p>
      <form class="stack" hx-post="${opts.basePath}/fetch-api" hx-target="#${opts.targetId}" hx-swap="innerHTML">
        <div class="mapping-grid">
          ${opts.fields.map((f) => {
            const val = f.defaultValue === '$MONTH_START' ? monthStart : f.defaultValue === '$TODAY' ? today : (f.defaultValue ?? '');
            return html`<div class="field">
              <label for="api-${f.name}">${f.label}</label>
              <input id="api-${f.name}" name="${f.name}" type="${f.type ?? 'text'}" value="${val}"${f.type === 'password' ? html` autocomplete="off"` : ''}${f.required !== false ? html` required` : ''}${f.placeholder ? html` placeholder="${f.placeholder}"` : ''}>
            </div>`;
          })}
        </div>
        ${opts.extraFields ?? ''}
        <div class="inline-row">
          <button type="submit" class="button primary">Fetch from ${opts.brand} API</button>
          ${opts.sampleAction ? html`<button type="button" class="button secondary" hx-post="${opts.basePath}/sample" hx-target="#${opts.targetId}" hx-swap="innerHTML">Load sample preview</button>` : ''}
        </div>
      </form>
    `,
  });
}
