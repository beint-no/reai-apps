// @ts-check
import { html, raw } from './html.js';

const CARD_STYLE = `:host{display:block;background:var(--r-surface,#fff);border:1px solid var(--r-line,#e4e9f2);border-radius:var(--r-radius,16px);padding:24px;box-shadow:0 1px 2px rgb(16 38 84/.04)}:host([data-padded="compact"]){padding:16px}.head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.eyebrow{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--r-brand,#2e6ee8);margin:0 0 4px}h2{margin:0;font-size:20px;letter-spacing:-.02em;color:var(--r-ink,#0b1c45)}`;

const BADGE_STYLE = `:host{display:inline-flex;align-items:center;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:650;line-height:1.4;border:1px solid var(--r-line,#e4e9f2);background:var(--r-lowered,#f3f6fb);color:var(--r-muted,#54627c)}:host([data-tone="accent"]){background:var(--r-brand-soft,#eef4ff);color:#1f55c4;border-color:#bcd5ff}:host([data-tone="success"]){background:#ebf8f1;color:#12704a;border-color:#b8e1cc}:host([data-tone="warn"]){background:#fff6e0;color:#8a5a00;border-color:#efd296}:host([data-tone="danger"]){background:#fff0ef;color:#c42b3f;border-color:#f4c0c6}`;

const CALLOUT_STYLE = `:host{display:block;border-radius:12px;padding:14px 16px;border:1px solid var(--r-line,#e4e9f2);background:var(--r-surface,#fff);font-size:14px;line-height:1.55}:host([data-tone="info"]){background:#eef4ff;border-color:#bcd5ff;color:#122e6e}:host([data-tone="success"]){background:#ebf8f1;border-color:#b8e1cc;color:#0e5c3e}:host([data-tone="warn"]){background:#fff6e0;border-color:#efd296;color:#7a4f01}:host([data-tone="danger"]){background:#fff0ef;border-color:#f4c0c6;color:#991b2b}strong{display:block;margin-bottom:4px;font-weight:650}`;

const METRIC_STYLE = `:host{display:grid;gap:4px;padding:14px 16px;background:var(--r-lowered,#f3f6fb);border:1px solid var(--r-line,#e4e9f2);border-radius:12px}.label{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--r-muted,#54627c)}.value{font-size:22px;font-weight:650;letter-spacing:-.02em;font-variant-numeric:tabular-nums;color:var(--r-ink,#0b1c45)}.detail{font-size:12px;color:var(--r-muted,#54627c)}`;

const DROPZONE_STYLE = `:host{display:block;border:1.5px dashed #91b8ff;border-radius:14px;padding:24px;text-align:center;background:#f7faff;transition:border-color 140ms ease,background-color 140ms ease}:host([data-dragging]){border-color:var(--r-brand,#2e6ee8);background:#eef4ff}.hint{margin:8px 0 0;font-size:13px;color:var(--r-muted,#54627c)}`;

/**
 * Declarative Shadow DOM <r-card> component (zero FOUC, zero Lit).
 * @param {{ title?: string, eyebrow?: string, badge?: import('./html.js').SafeHtml | null, id?: string, compact?: boolean, body: import('./html.js').HtmlValue }} props
 * @returns {import('./html.js').SafeHtml}
 */
export function reaiCard(props) {
  const idAttr = props.id ? html` id="${props.id}"` : '';
  const padAttr = props.compact ? html` data-padded="compact"` : '';
  return html`<r-card${idAttr}${padAttr}>
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
  </r-card>`;
}

/**
 * Declarative Shadow DOM <r-badge>.
 * @param {{ text: string, tone?: 'neutral' | 'accent' | 'success' | 'warn' | 'danger' }} props
 * @returns {import('./html.js').SafeHtml}
 */
export function reaiBadge(props) {
  const tone = props.tone ?? 'neutral';
  return html`<r-badge data-tone="${tone}"><template shadowrootmode="open"><style>${raw(BADGE_STYLE)}</style><slot></slot></template>${props.text}</r-badge>`;
}

/**
 * Declarative Shadow DOM <r-callout>.
 * @param {{ tone?: 'info' | 'success' | 'warn' | 'danger', title?: string, body: import('./html.js').HtmlValue }} props
 * @returns {import('./html.js').SafeHtml}
 */
export function reaiCallout(props) {
  const tone = props.tone ?? 'info';
  return html`<r-callout data-tone="${tone}">
    <template shadowrootmode="open">
      <style>${raw(CALLOUT_STYLE)}</style>
      ${props.title ? html`<strong>${props.title}</strong>` : ''}
      <slot></slot>
    </template>
    ${props.body}
  </r-callout>`;
}

/**
 * Declarative Shadow DOM <r-metric>.
 * @param {{ label: string, value: string, detail?: string }} props
 * @returns {import('./html.js').SafeHtml}
 */
export function reaiMetric(props) {
  return html`<r-metric>
    <template shadowrootmode="open">
      <style>${raw(METRIC_STYLE)}</style>
      <span class="label">${props.label}</span>
      <span class="value">${props.value}</span>
      ${props.detail ? html`<span class="detail">${props.detail}</span>` : ''}
    </template>
  </r-metric>`;
}

/**
 * Declarative Shadow DOM <r-dropzone> enhanced progressively by /app/shared/ui.js.
 * @param {{ inputId: string, name: string, accept: string, label: string, hint: string }} props
 * @returns {import('./html.js').SafeHtml}
 */
export function reaiDropzone(props) {
  return html`<r-dropzone>
    <template shadowrootmode="open">
      <style>${raw(DROPZONE_STYLE)}</style>
      <slot></slot>
      <p class="hint">${props.hint}</p>
    </template>
    <label class="button primary" for="${props.inputId}">${props.label}</label>
    <input id="${props.inputId}" class="sr-file" type="file" name="${props.name}" accept="${props.accept}">
  </r-dropzone>`;
}

/** @type {Array<[string, string]>} */
const APP_LINKS = [
  ['/app/vipps/', 'Vipps'],
  ['/app/klarna/', 'Klarna'],
  ['/app/stripe/', 'Stripe'],
  ['/app/zettle/', 'Zettle'],
  ['/app/sumup/', 'SumUp'],
  ['/app/dintero/', 'Dintero'],
  ['/app/nets/', 'Nets Easy'],
  ['/app/paypal/', 'PayPal'],
  ['/app/mystore/', 'Mystore'],
  ['/app/24nettbutikk/', '24Nettbutikk'],
  ['/app/magento/', 'Magento'],
  ['/app/prestashop/', 'PrestaShop'],
  ['/app/shopware/', 'Shopware 6'],
  ['/app/wix/', 'Wix Stores'],
  ['/app/z-report/', 'POS Z-Report'],
  ['/app/front-systems/', 'Front Systems'],
  ['/app/hubspot/', 'HubSpot CRM'],
  ['/app/pipedrive/', 'Pipedrive CRM'],
  ['/app/toggl/', 'Toggl Track'],
  ['/app/clockify/', 'Clockify'],
  ['/app/harvest/', 'Harvest'],
  ['/app/tidsbanken/', 'Tidsbanken / SmartDok'],
  ['/app/pleo/', 'Pleo Expenses'],
  ['/app/revolut/', 'Revolut / Wise'],
  ['/app/hybel/', 'Hybel'],
  ['/app/fazile/', 'Fazile'],
  ['/app/timma/', 'Booking & Clinic'],
  ['/app/recman/', 'RecMan Staffing'],
  ['/app/smartdok/', 'SmartDok'],
  ['/app/svenn/', 'Svenn'],
  ['/app/cordel/', 'Cordel'],
  ['/app/holte/', 'Holte'],
  ['/app/handyman/', 'Handyman'],
  ['/app/minuba/', 'Minuba'],
  ['/app/favrit/', 'Favrit POS'],
  ['/app/quickorder/', 'Quickorder'],
  ['/app/munu/', 'Munu POS'],
  ['/app/lightspeed/', 'Lightspeed'],
  ['/app/visbook/', 'VisBook PMS'],
  ['/app/mews/', 'Mews PMS'],
  ['/app/wolt-foodora/', 'Wolt / Foodora'],
  ['/app/pckasse/', 'PCKasse'],
  ['/app/extendago/', 'ExtendaGO'],
  ['/app/susoft/', 'Susoft'],
  ['/app/superoffice/', 'SuperOffice'],
  ['/app/lime/', 'Lime CRM'],
  ['/app/planday/', 'Planday'],
  ['/app/tamigo/', 'Tamigo'],
  ['/app/huma/', 'Huma HR'],
  ['/app/busy/', 'Busy'],
  ['/app/milient/', 'Milient'],
  ['/app/ticketco/', 'TicketCo'],
  ['/app/checkin/', 'Checkin'],
  ['/app/spond-rubic/', 'Spond / Rubic'],
  ['/app/opus-dental/', 'Opus Dental'],
  ['/app/ongoing-wms/', 'Ongoing WMS'],
  ['/app/abax/', 'ABAX'],
  ['/app/opter/', 'Opter TMS'],
  ['/app/autonet/', 'AutoNet'],
  ['/app/logistra/', 'Logistra'],
  ['/app/fixit/', 'Fixit'],
  ['/app/hano/', 'Hano'],
  ['/app/pasientsky/', 'PasientSky'],
  ['/app/membro/', 'Membro Gym'],
  ['/app/easypractice/', 'EasyPract'],
  ['/app/inkasso/', 'Inkasso NO'],
  ['/app/kravia/', 'Kravia'],
  ['/app/two/', 'Two B2B'],
  ['/app/airbnb/', 'Airbnb'],
  ['/app/husleie/', 'Husleie.no'],
  ['/app/fenistra/', 'Fenistra'],
  ['/app/simployer/', 'Simployer'],
  ['/app/acubiz/', 'Acubiz'],
  ['/app/quinyx/', 'Quinyx'],
  ['/app/severa/', 'Severa'],
  ['/app/saft/', 'SAF-T NO'],
  ['/app/hoopla/', 'Hoopla'],
  ['/app/squarespace/', 'Squarespace'],
  ['/app/paddle/', 'Paddle'],
  ['/app/salesforce/', 'Salesforce'],
  ['/app/import/', 'CSV Import'],
  ['/app/export/', 'BI & Excel Export'],
];

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
      <button type="button" class="nav-pill" popovertarget="app-switcher">Switch integration ▾</button>
      <a href="/web-apps/">All integrations</a>
      <a href="/docs/">Docs</a>
      <a class="button primary nav-cta" href="https://app.reai.no/auth/signup">Try ReAI free →</a>
    </nav>
    <nav id="app-switcher" popover class="app-switcher">
      <input type="search" id="app-switcher-filter" class="switcher-search" placeholder="Filter 80+ integrations…">
      ${APP_LINKS.map(
        ([href, label]) =>
          html`<a href="${href}"${props.activePath === href ? html` data-current="true"` : ''}>${label}</a>`,
      )}
    </nav>
  </header>
  <main class="app-main wrap">${props.body}</main>
  <footer class="app-footer wrap">
    <span>Free ReAI integration · <a href="https://app.reai.no/auth/signup">Try ReAI free →</a></span>
    <nav class="app-nav">
      <a href="/docs/">Docs</a>
      <a href="/app/lab/">UI Lab</a>
      <a href="https://github.com/beint-no/reai-apps">GitHub ↗</a>
      <a href="https://app.reai.no/user/profile#user-access-tokens">Manage tokens ↗</a>
    </nav>
  </footer>
</body>
</html>`;
}
