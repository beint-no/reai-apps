// @ts-check
import { html, htmlResponse } from './html.js';
import { HttpError, errorResponse, requireSameOrigin } from './http.js';
import { reaiOrigin, reaiRequest } from './reai.js';
import { reaiBadge, reaiCallout, reaiCard } from './ui.js';

const COOKIE_NAME = 'reai_app_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

/** @type {string | null} */
let localDevSecret = null;

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function toBase64Url(bytes) {
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * @param {string} value
 * @returns {Uint8Array<ArrayBuffer>}
 */
function fromBase64Url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * @param {import('./types.d.ts').Env} env
 * @param {Request} request
 * @returns {Promise<CryptoKey>}
 */
async function sessionKey(env, request) {
  let secret = env.SESSION_SECRET || '';
  if (!secret) {
    const { hostname } = new URL(request.url);
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      if (!localDevSecret) {
        const random = new Uint8Array(32);
        crypto.getRandomValues(random);
        localDevSecret = toBase64Url(random);
      }
      secret = localDevSecret;
    } else {
      throw new HttpError(500, 'SESSION_SECRET Worker secret is not configured.');
    }
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/**
 * @param {import('./types.d.ts').Env} env
 * @param {Request} request
 * @param {import('./types.d.ts').SessionData} session
 * @returns {Promise<string>}
 */
async function buildSessionCookie(env, request, session) {
  const key = await sessionKey(env, request);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const plaintext = new TextEncoder().encode(JSON.stringify(session));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  const sealed = `${toBase64Url(iv)}.${toBase64Url(ciphertext)}`;
  const isHttps = new URL(request.url).protocol === 'https:';
  const parts = [
    `${COOKIE_NAME}=${sealed}`,
    'Path=/app',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ];
  if (isHttps) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/**
 * @param {Request} request
 * @returns {string}
 */
function clearSessionCookie(request) {
  const isHttps = new URL(request.url).protocol === 'https:';
  return [
    `${COOKIE_NAME}=`,
    'Path=/app',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    ...(isHttps ? ['Secure'] : []),
  ].join('; ');
}

/**
 * @param {Request} request
 * @returns {string | null}
 */
function readCookieValue(request) {
  const header = request.headers.get('cookie');
  if (!header) {
    return null;
  }
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${COOKIE_NAME}=`)) {
      return trimmed.slice(COOKIE_NAME.length + 1);
    }
  }
  return null;
}

/**
 * Decrypts the HttpOnly session cookie if present and valid.
 * @param {import('./types.d.ts').Env} env
 * @param {Request} request
 * @returns {Promise<import('./types.d.ts').SessionData | null>}
 */
export async function readSession(env, request) {
  const raw = readCookieValue(request);
  if (!raw) {
    return null;
  }
  const dot = raw.indexOf('.');
  if (dot <= 0) {
    return null;
  }
  try {
    const key = await sessionKey(env, request);
    const iv = fromBase64Url(raw.slice(0, dot));
    const ciphertext = fromBase64Url(raw.slice(dot + 1));
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    const parsed = /** @type {import('./types.d.ts').SessionData} */ (
      JSON.parse(new TextDecoder().decode(plaintext))
    );
    if (
      typeof parsed.accessToken !== 'string' ||
      !Array.isArray(parsed.tenants) ||
      typeof parsed.tenantId !== 'number'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Renders the SSR HTMX ReAI connection panel.
 * @param {import('./types.d.ts').SessionData | null} session
 * @param {{ clientId?: string, clientName?: string, error?: string, pending?: { clientId: string, clientName: string, deviceCode: string, userCode: string, verificationUriComplete: string, interval: number } }} [opts]
 * @returns {import('./html.js').SafeHtml}
 */
export function renderConnectPanel(session, opts = {}) {
  const clientId = opts.clientId ?? 'reai-web-app';
  const clientName = opts.clientName ?? 'ReAI Web App';

  if (session) {
    const selected = session.tenants.find((t) => t.id === session.tenantId);
    return reaiCard({
      id: 'reai-connect',
      eyebrow: 'REAI CONNECTION',
      title: selected ? selected.companyName : 'Choose company',
      badge: reaiBadge({ text: 'Connected (HttpOnly cookie)', tone: 'success' }),
      body: html`
        ${opts.error ? reaiCallout({ tone: 'danger', body: opts.error }) : ''}
        <div class="inline-row">
          <form class="inline-form" hx-post="/app/auth/company" hx-target="#reai-connect" hx-swap="outerHTML">
            <input type="hidden" name="clientId" value="${clientId}">
            <input type="hidden" name="clientName" value="${clientName}">
            <label for="reai-tenant-select">Company</label>
            <select id="reai-tenant-select" name="tenantId" hx-post="/app/auth/company" hx-trigger="change" hx-include="closest form" hx-target="#reai-connect" hx-swap="outerHTML">
              ${session.tenantId === 0 ? html`<option value="0" selected>Select a company…</option>` : ''}
              ${session.tenants.map(
                (t) =>
                  html`<option value="${t.id}"${t.id === session.tenantId ? html` selected` : ''}>${t.companyName} (${t.currencyCode})</option>`,
              )}
            </select>
          </form>
          <form hx-post="/app/auth/logout" hx-target="#reai-connect" hx-swap="outerHTML">
            <input type="hidden" name="clientId" value="${clientId}">
            <input type="hidden" name="clientName" value="${clientName}">
            <button type="submit" class="button secondary">Disconnect</button>
          </form>
        </div>
        <p class="muted-note">Access token is encrypted inside an HttpOnly cookie on apps.reai.no and never exposed to browser scripts.</p>
      `,
    });
  }

  if (opts.pending) {
    const p = opts.pending;
    const pollSeconds = Math.max(3, Math.min(15, p.interval || 5));
    return reaiCard({
      id: 'reai-connect',
      eyebrow: 'REAI CONNECTION',
      title: 'Approve in ReAI',
      badge: reaiBadge({ text: 'Waiting for approval', tone: 'warn' }),
      body: html`
        <div class="device-box">
          <form hx-post="/app/auth/device/poll"
                hx-trigger="every ${pollSeconds}s"
                hx-target="#reai-connect"
                hx-swap="outerHTML">
            <input type="hidden" name="clientId" value="${p.clientId}">
            <input type="hidden" name="clientName" value="${p.clientName}">
            <input type="hidden" name="deviceCode" value="${p.deviceCode}">
            <input type="hidden" name="userCode" value="${p.userCode}">
            <input type="hidden" name="verificationUriComplete" value="${p.verificationUriComplete}">
            <input type="hidden" name="interval" value="${pollSeconds}">
          </form>
          <p>Confirm this code in ReAI and choose your company:</p>
          <p class="device-code">${p.userCode}</p>
          <div class="inline-row">
            <a class="button primary" href="${p.verificationUriComplete}" target="_blank" rel="noopener">Open ReAI approval ↗</a>
            <form hx-post="/app/auth/logout" hx-target="#reai-connect" hx-swap="outerHTML">
              <input type="hidden" name="clientId" value="${p.clientId}">
              <input type="hidden" name="clientName" value="${p.clientName}">
              <button type="submit" class="button secondary">Cancel</button>
            </form>
          </div>
        </div>
      `,
    });
  }

  return reaiCard({
    id: 'reai-connect',
    eyebrow: 'REAI CONNECTION',
    title: 'Connect to ReAI',
    badge: reaiBadge({ text: 'Ready to connect', tone: 'neutral' }),
    body: html`
      ${opts.error ? reaiCallout({ tone: 'danger', body: opts.error }) : ''}
      <p class="muted-note">Approve in ReAI to connect your company with an encrypted HttpOnly session cookie — no manual tokens or passwords needed.</p>
      <div class="inline-row">
        <form hx-post="/app/auth/device/start" hx-target="#reai-connect" hx-swap="outerHTML">
          <input type="hidden" name="clientId" value="${clientId}">
          <input type="hidden" name="clientName" value="${clientName}">
          <button type="submit" class="button primary">Connect to ReAI →</button>
        </form>
      </div>
    `,
  });
}

/**
 * @param {FormData} form
 * @param {string} key
 * @param {string} fallback
 * @returns {string}
 */
function formStr(form, key, fallback = '') {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : fallback;
}

/**
 * @param {import('./types.d.ts').Env} env
 * @param {Request} request
 * @param {string} accessToken
 * @param {string} clientId
 * @param {string} clientName
 * @returns {Promise<Response>}
 */
async function establishSessionResponse(env, request, accessToken, clientId, clientName) {
  const me = /** @type {{ tenants?: import('./types.d.ts').ReAITenant[] }} */ (
    await reaiRequest(env, '/api/me', { token: accessToken })
  );
  const tenants = Array.isArray(me.tenants) ? me.tenants : [];
  if (tenants.length === 0) {
    throw new HttpError(403, 'This ReAI connection has no accessible companies.');
  }
  const firstTenant = tenants[0];
  const session = {
    accessToken,
    tenantId: tenants.length === 1 && firstTenant ? firstTenant.id : 0,
    tenants,
    issuedAt: Date.now(),
  };
  const cookie = await buildSessionCookie(env, request, session);
  return htmlResponse(renderConnectPanel(session, { clientId, clientName }), 200, {
    'set-cookie': cookie,
  });
}

/**
 * Handles /app/auth/* HTMX endpoints.
 * @param {Request} request
 * @param {import('./types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handleAuth(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === '/app/auth/session' && request.method === 'GET') {
    const session = await readSession(env, request);
    return htmlResponse(renderConnectPanel(session));
  }
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed.', 405);
  }
  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }

  const form = await request.formData();
  const rawClientId = formStr(form, 'clientId', 'reai-web-app');
  const clientId = /^[a-z0-9-]{3,40}$/.test(rawClientId) ? rawClientId : 'reai-web-app';
  const clientName = formStr(form, 'clientName', 'ReAI Web App').slice(0, 60) || 'ReAI Web App';

  if (pathname === '/app/auth/logout') {
    return htmlResponse(renderConnectPanel(null, { clientId, clientName }), 200, {
      'set-cookie': clearSessionCookie(request),
    });
  }

  try {
    if (pathname === '/app/auth/device/start') {
      const body = new URLSearchParams({ client_id: clientId, client_name: clientName });
      const upstream = await fetch(`${reaiOrigin(env)}/oauth/device/authorize`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
      });
      if (!upstream.ok) {
        throw new HttpError(upstream.status === 429 ? 429 : 502, 'Could not start ReAI browser authorization.');
      }
      const data = /** @type {{ device_code: string, user_code: string, verification_uri_complete: string, interval: number }} */ (
        await upstream.json()
      );
      return htmlResponse(
        renderConnectPanel(null, {
          clientId,
          clientName,
          pending: {
            clientId,
            clientName,
            deviceCode: data.device_code,
            userCode: data.user_code,
            verificationUriComplete: data.verification_uri_complete,
            interval: data.interval || 5,
          },
        }),
      );
    }

    if (pathname === '/app/auth/device/poll') {
      const deviceCode = formStr(form, 'deviceCode');
      const userCode = formStr(form, 'userCode');
      const verificationUriComplete = formStr(form, 'verificationUriComplete');
      const interval = Number(formStr(form, 'interval', '5')) || 5;
      if (!deviceCode) {
        throw new HttpError(400, 'Missing authorization state. Start again.');
      }
      const body = new URLSearchParams({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      });
      const upstream = await fetch(`${reaiOrigin(env)}/oauth/device/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
      });
      const data = /** @type {{ access_token?: string, error?: string }} */ (await upstream.json());
      if (upstream.ok && typeof data.access_token === 'string') {
        return establishSessionResponse(env, request, data.access_token, clientId, clientName);
      }
      if (data.error === 'authorization_pending' || data.error === 'slow_down') {
        const nextInterval = data.error === 'slow_down' ? Math.min(15, interval + 5) : interval;
        return htmlResponse(
          renderConnectPanel(null, {
            clientId,
            clientName,
            pending: {
              clientId,
              clientName,
              deviceCode,
              userCode,
              verificationUriComplete,
              interval: nextInterval,
            },
          }),
        );
      }
      throw new HttpError(
        400,
        data.error === 'access_denied' ? 'Connection was declined in ReAI.' : 'Authorization expired. Start again.',
      );
    }

    if (pathname === '/app/auth/token') {
      const token = formStr(form, 'token');
      if (!token) {
        throw new HttpError(400, 'Paste a ReAI user access token.');
      }
      return establishSessionResponse(env, request, token, clientId, clientName);
    }

    if (pathname === '/app/auth/company') {
      const session = await readSession(env, request);
      if (!session) {
        throw new HttpError(401, 'Connect to ReAI first.');
      }
      const tenantId = Number(formStr(form, 'tenantId', '0'));
      if (!session.tenants.some((t) => t.id === tenantId)) {
        throw new HttpError(403, 'Selected company is not available in this session.');
      }
      const updated = { ...session, tenantId };
      const cookie = await buildSessionCookie(env, request, updated);
      return htmlResponse(renderConnectPanel(updated, { clientId, clientName }), 200, {
        'set-cookie': cookie,
      });
    }
  } catch (err) {
    const session = await readSession(env, request);
    const message = err instanceof Error ? err.message : 'Connection failed.';
    return htmlResponse(renderConnectPanel(session, { clientId, clientName, error: message }), 200);
  }

  return errorResponse('Unknown auth endpoint.', 404);
}
