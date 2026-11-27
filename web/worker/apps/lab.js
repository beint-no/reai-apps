// @ts-check
import { html, htmlResponse } from '../lib/html.js';
import { errorResponse, requireSameOrigin } from '../lib/http.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../lib/ui.js';

/**
 * Handles /app/lab/* — SSR Declarative Shadow DOM Web Component playground.
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export async function handleLab(request) {
  const { pathname } = new URL(request.url);

  if (pathname === '/app/lab' && (request.method === 'GET' || request.method === 'HEAD')) {
    return Response.redirect(new URL('/app/lab/', request.url), 301);
  }

  if (pathname === '/app/lab/' && (request.method === 'GET' || request.method === 'HEAD')) {
    const body = html`
      <section class="app-intro">
        <p class="eyebrow">EXPERIMENTAL · ZERO FRAMEWORKS</p>
        <h1>ReAI UI Component Lab</h1>
        <p class="lead">Server-rendered Declarative Shadow DOM Web Components (<code>&lt;template shadowrootmode="open"&gt;</code>) paired with HTMX 4 and native HTML primitives. Zero Lit, zero bundler, zero FOUC.</p>
      </section>

      <div class="stack">
        ${reaiCard({
          eyebrow: 'COMPONENT · REAI-BADGE',
          title: 'Status badges',
          badge: reaiBadge({ text: 'SSR Shadow DOM', tone: 'accent' }),
          body: html`
            <div class="inline-row">
              ${reaiBadge({ text: 'Neutral', tone: 'neutral' })}
              ${reaiBadge({ text: 'Accent', tone: 'accent' })}
              ${reaiBadge({ text: 'Balanced', tone: 'success' })}
              ${reaiBadge({ text: 'Needs review', tone: 'warn' })}
              ${reaiBadge({ text: 'Blocked', tone: 'danger' })}
            </div>
          `,
        })}

        ${reaiCard({
          eyebrow: 'COMPONENT · REAI-METRIC',
          title: 'Tabular accounting metrics',
          body: html`
            <div class="metric-grid">
              ${reaiMetric({ label: 'Framework JS', value: '0 KB', detail: 'No Lit, no React, no bundler' })}
              ${reaiMetric({ label: 'First paint FOUC', value: '0 ms', detail: 'Styles arrive inside Declarative Shadow DOM' })}
              ${reaiMetric({ label: 'Monthly debit', value: '53 650,50 NOK', detail: 'font-variant-numeric: tabular-nums' })}
            </div>
          `,
        })}

        ${reaiCard({
          eyebrow: 'COMPONENT · REAI-CALLOUT',
          title: 'Feedback banners',
          body: html`
            <div class="stack-sm">
              ${reaiCallout({ tone: 'info', title: 'Single Cloudflare Worker', body: 'Static pages outside /app/* bypass the Worker completely and serve straight from Cloudflare edge.' })}
              ${reaiCallout({ tone: 'success', title: 'HTMX 4 fragment swap', body: html`Click below to swap an SSR fragment from the Worker without writing client JS.` })}
            </div>
          `,
        })}

        ${reaiCard({
          eyebrow: 'PLATFORM · POPOVER + INVOKER COMMANDS + HTMX 4',
          title: 'Zero-JS Popover, Dialog Invokers & HTMX swap',
          body: html`
            <div class="inline-row">
              <button type="button" class="button primary" hx-post="/app/lab/ping" hx-target="#lab-ping-result" hx-swap="innerHTML">Swap SSR fragment</button>
              <button type="button" class="button secondary" popovertarget="lab-popover">Open native popover</button>
              <button type="button" class="button secondary" command="show-modal" commandfor="lab-dialog">Open modal dialog</button>
            </div>
            <div id="lab-ping-result" class="stack-sm"></div>
            <div id="lab-popover" popover class="native-popover">
              <h3>Native HTML Popover API</h3>
              <p>Zero JavaScript needed for top-layer positioning, <code>@starting-style</code> entry transitions, light-dismiss and Escape handling.</p>
              <button type="button" class="button secondary" popovertarget="lab-popover" popovertargetaction="hide">Close</button>
            </div>
            <dialog id="lab-dialog" class="native-dialog">
              <h3>Invoker Commands API</h3>
              <p>Opened and closed purely with <code>command="show-modal"</code> and <code>commandfor="lab-dialog"</code> — zero JavaScript event listeners.</p>
              <button type="button" class="button primary" command="close" commandfor="lab-dialog">Close dialog</button>
            </dialog>
          `,
        })}

        ${reaiCard({
          eyebrow: 'COMPONENT · REAI-DROPZONE',
          title: 'Progressively enhanced dropzone',
          body: html`
            ${reaiDropzone({
              inputId: 'lab-demo-file',
              name: 'demo',
              accept: '.csv',
              label: 'Pick or drop a file',
              hint: 'Works as a plain file input without JS; /app/shared/ui.js adds drag-over feedback.',
            })}
          `,
        })}
      </div>
    `;
    return htmlResponse(
      appShell({
        title: 'UI Component Lab',
        description: 'Zero-framework Declarative Shadow DOM Web Components and HTMX 4 playground for ReAI.',
        activePath: '/app/lab/',
        body,
      }),
    );
  }

  if (pathname === '/app/lab/ping' && request.method === 'POST') {
    const originError = requireSameOrigin(request);
    if (originError) {
      return originError;
    }
    const now = new Date().toISOString();
    return htmlResponse(
      reaiCallout({
        tone: 'success',
        title: 'Rendered on Cloudflare Worker',
        body: `Swapped a Declarative Shadow DOM <reai-callout> fragment at ${now} with zero client rendering code.`,
      }),
    );
  }

  return errorResponse('Unknown UI Lab route.', 404);
}
