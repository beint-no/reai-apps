// @ts-check
import { html, raw } from './html.js';

const CARD_STYLE = `:host{display:block;background:var(--reai-surface,#fff);border:1px solid var(--reai-line,#dce1d9);border-radius:var(--reai-radius,16px);padding:24px}:host([data-padded="compact"]){padding:16px}.head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.eyebrow{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--reai-green,#006c51);margin:0 0 4px}h2{margin:0;font-size:20px;letter-spacing:-.02em;color:var(--reai-ink,#182723)}`;

const BADGE_STYLE = `:host{display:inline-flex;align-items:center;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:650;line-height:1.4;border:1px solid var(--reai-line,#dce1d9);background:var(--reai-bg,#f5f6f2);color:var(--reai-muted,#52615a)}:host([data-tone="accent"]){background:color-mix(in oklch,var(--reai-green,#006c51) 12%,white);color:var(--reai-green,#006c51);border-color:color-mix(in oklch,var(--reai-green,#006c51) 28%,white)}:host([data-tone="success"]){background:#e7f6ee;color:#0e5c3e;border-color:#b8e1cc}:host([data-tone="warn"]){background:#fdf4e1;color:#7a4f01;border-color:#efd296}:host([data-tone="danger"]){background:#fdecec;color:#8f1d1d;border-color:#f0bcbc}`;

const CALLOUT_STYLE = `:host{display:block;border-radius:12px;padding:14px 16px;border:1px solid var(--reai-line,#dce1d9);background:var(--reai-surface,#fff);font-size:14px;line-height:1.55}:host([data-tone="info"]){background:#eef5f2;border-color:#bfd6cc;color:#143b2f}:host([data-tone="success"]){background:#e7f6ee;border-color:#b8e1cc;color:#0e5c3e}:host([data-tone="warn"]){background:#fdf4e1;border-color:#efd296;color:#6c4500}:host([data-tone="danger"]){background:#fdecec;border-color:#f0bcbc;color:#8f1d1d}strong{display:block;margin-bottom:4px;font-weight:650}`;

const METRIC_STYLE = `:host{display:grid;gap:4px;padding:14px 16px;background:var(--reai-bg,#f5f6f2);border:1px solid var(--reai-line,#dce1d9);border-radius:12px}.label{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--reai-muted,#52615a)}.value{font-size:22px;font-weight:650;letter-spacing:-.02em;font-variant-numeric:tabular-nums;color:var(--reai-ink,#182723)}.detail{font-size:12px;color:var(--reai-muted,#52615a)}`;

const DROPZONE_STYLE = `:host{display:block;border:1.5px dashed color-mix(in oklch,var(--reai-green,#006c51) 42%,var(--reai-line,#dce1d9));border-radius:14px;padding:24px;text-align:center;background:color-mix(in oklch,var(--reai-green,#006c51) 4%,white);transition:border-color 140ms ease,background-color 140ms ease}:host([data-dragging]){border-color:var(--reai-green,#006c51);background:color-mix(in oklch,var(--reai-green,#006c51) 11%,white)}.hint{margin:8px 0 0;font-size:13px;color:var(--reai-muted,#52615a)}`;

/**
 * Declarative Shadow DOM card component (zero FOUC, zero Lit).
 * @param {{ title?: string, eyebrow?: string, badge?: import('./html.js').SafeHtml | null, id?: string, compact?: boolean, body: import('./html.js').HtmlValue }} props
 * @returns {import('./html.js').SafeHtml}
 */
export function reaiCard(props) {
  const idAttr = props.id ? html` id="${props.id}"` : '';
  const padAttr = props.compact ? html` data-padded="compact"` : '';
  return html`<reai-card${idAttr}${padAttr}>
    <template shadowrootmode="open">
      <style>${raw(CARD_STYLE)}</style>
      ${props.title || props.eyebrow || props.badge
        ? html`<div class="head">
            <div>
              ${props.eyebrow ? html`<p class="eyebrow">${props.eyebrow}</p>` : ''}
              ${props.title ? html`<h2>${props.title}</h2>` : ''}
            </div>
            <slot name="badge"></slot>
          </div>`
        : ''}
      <slot></slot>
    </template>
    ${props.badge ? html`<span slot="badge">${props.badge}</span>` : ''}
    ${props.body}
  </reai-card>`;
}

/**
 * Declarative Shadow DOM status badge.
 * @param {{ text: string, tone?: 'neutral' | 'accent' | 'success' | 'warn' | 'danger' }} props
 * @returns {import('./html.js').SafeHtml}
 */
export function reaiBadge(props) {
  const tone = props.tone ?? 'neutral';
  return html`<reai-badge data-tone="${tone}"><template shadowrootmode="open"><style>${raw(BADGE_STYLE)}</style><slot></slot></template>${props.text}</reai-badge>`;
}

/**
 * Declarative Shadow DOM callout banner.
 * @param {{ tone?: 'info' | 'success' | 'warn' | 'danger', title?: string, body: import('./html.js').HtmlValue }} props
 * @returns {import('./html.js').SafeHtml}
 */
export function reaiCallout(props) {
  const tone = props.tone ?? 'info';
  return html`<reai-callout data-tone="${tone}">
    <template shadowrootmode="open">
      <style>${raw(CALLOUT_STYLE)}</style>
      ${props.title ? html`<strong>${props.title}</strong>` : ''}
      <slot></slot>
    </template>
    ${props.body}
  </reai-callout>`;
}

/**
 * Declarative Shadow DOM metric tile.
 * @param {{ label: string, value: string, detail?: string }} props
 * @returns {import('./html.js').SafeHtml}
 */
export function reaiMetric(props) {
  return html`<reai-metric>
    <template shadowrootmode="open">
      <style>${raw(METRIC_STYLE)}</style>
      <span class="label">${props.label}</span>
      <span class="value">${props.value}</span>
      ${props.detail ? html`<span class="detail">${props.detail}</span>` : ''}
    </template>
  </reai-metric>`;
}

/**
 * Declarative Shadow DOM file dropzone enhanced progressively by /app/shared/ui.js.
 * @param {{ inputId: string, name: string, accept: string, label: string, hint: string }} props
 * @returns {import('./html.js').SafeHtml}
 */
export function reaiDropzone(props) {
  return html`<reai-dropzone>
    <template shadowrootmode="open">
      <style>${raw(DROPZONE_STYLE)}</style>
      <slot></slot>
      <p class="hint">${props.hint}</p>
    </template>
    <label class="button primary" for="${props.inputId}">${props.label}</label>
    <input id="${props.inputId}" class="sr-file" type="file" name="${props.name}" accept="${props.accept}">
  </reai-dropzone>`;
}

/**
 * Full HTML document shell for server-rendered HTMX 4 web apps under /app/*.
 * @param {{ title: string, description: string, activePath: string, body: import('./html.js').HtmlValue }} props
 * @returns {import('./html.js').SafeHtml}
 */
export function appShell(props) {
  return html`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="${props.description}">
  <meta name="robots" content="noindex">
  <title>${props.title} — ReAI Apps</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/app/shared/tokens.css">
  <link rel="stylesheet" href="/app/shared/app.css">
  <script src="/app/shared/vendor/htmx-4.0.0.min.js" defer></script>
  <script type="module" src="/app/shared/ui.js"></script>
</head>
<body>
  <div id="browser-update-notice" class="browser-notice" hidden>
    Your browser is outdated. Update to the latest Chrome, Safari, Edge, or Firefox to use ReAI Apps.
  </div>
  <header class="app-header wrap">
    <a class="brand" href="/"><span class="brand-mark">r</span>ReAI <span class="brand-suffix">Apps</span></a>
    <nav class="app-nav">
      <button type="button" class="nav-pill" popovertarget="app-switcher">Switch app ▾</button>
      <a href="/web-apps/">All web apps</a>
      <a href="/desktop/">Desktop</a>
      <a href="https://github.com/beint-no/reai-apps">GitHub ↗</a>
    </nav>
    <nav id="app-switcher" popover class="app-switcher">
      <a href="/app/close-check/"${props.activePath === '/app/close-check/' ? html` data-current="true"` : ''}>Month-End Close Checker</a>
      <a href="/app/hybel/"${props.activePath === '/app/hybel/' ? html` data-current="true"` : ''}>Hybel Journal</a>
      <a href="/app/import/"${props.activePath === '/app/import/' ? html` data-current="true"` : ''}>Spreadsheet Import</a>
      <a href="/app/stripe/"${props.activePath === '/app/stripe/' ? html` data-current="true"` : ''}>Stripe Import</a>
      <a href="/app/vipps/"${props.activePath === '/app/vipps/' ? html` data-current="true"` : ''}>Vipps Reconcile</a>
      <a href="/app/klarna/"${props.activePath === '/app/klarna/' ? html` data-current="true"` : ''}>Klarna Reconcile</a>
      <a href="/app/zettle/"${props.activePath === '/app/zettle/' ? html` data-current="true"` : ''}>Zettle Reconcile</a>
      <a href="/app/dintero/"${props.activePath === '/app/dintero/' ? html` data-current="true"` : ''}>Dintero Fees</a>
      <a href="/app/lab/"${props.activePath === '/app/lab/' ? html` data-current="true"` : ''}>UI Component Lab</a>
    </nav>
  </header>
  <main class="app-main wrap">${props.body}</main>
  <footer class="app-footer wrap">
    <span>apps.reai.no · SSR + HTMX 4 + Declarative Shadow DOM</span>
    <a href="https://app.reai.no/user/profile#user-access-tokens">Manage ReAI tokens ↗</a>
  </footer>
</body>
</html>`;
}
