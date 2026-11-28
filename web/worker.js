// @ts-check
import { handleBilling } from './worker/apps/billing.js';
import { handleCards } from './worker/apps/cards.js';
import { handleEcommerce } from './worker/apps/ecommerce.js';
import { handleExport } from './worker/apps/export.js';
import { handleHubSpot } from './worker/apps/hubspot.js';
import { handleHybel } from './worker/apps/hybel.js';
import { handleImport } from './worker/apps/import.js';
import { handleLab } from './worker/apps/lab.js';
import { handlePipedrive } from './worker/apps/pipedrive.js';
import { handlePos } from './worker/apps/pos.js';
import { handleReconcile } from './worker/apps/reconcile.js';
import { handleStripe } from './worker/apps/stripe.js';
import { handleTimeTracking } from './worker/apps/timetracking.js';
import { handleAuth } from './worker/lib/auth.js';
import { HttpError, errorResponse, withAppHeaders } from './worker/lib/http.js';

/** @type {ReadonlySet<import('./worker/apps/reconcile.js').ProviderSlug>} */
const RECONCILE_SLUGS = new Set(['vipps', 'klarna', 'zettle', 'dintero', 'sumup', 'nets', 'paypal']);

/** @type {ReadonlySet<import('./worker/apps/ecommerce.js').EcommerceSlug>} */
const ECOMMERCE_SLUGS = new Set(['mystore', '24nettbutikk', 'magento', 'prestashop', 'shopware', 'wix']);

/** @type {ReadonlySet<import('./worker/apps/timetracking.js').TimeSlug>} */
const TIME_SLUGS = new Set(['toggl', 'clockify', 'harvest', 'tidsbanken']);

/**
 * Single Cloudflare Worker for apps.reai.no.
 * Everything outside /app/* is pure static assets served directly by Cloudflare edge.
 * @type {ExportedHandler<import('./worker/lib/types.d.ts').Env>}
 */
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    try {
      if (pathname.startsWith('/app/auth/')) {
        return await handleAuth(request, env);
      }
      if (pathname.startsWith('/app/shared/')) {
        const assetResponse = await env.ASSETS.fetch(request);
        return withAppHeaders(assetResponse);
      }
      if (pathname === '/app' || pathname === '/app/') {
        return Response.redirect(new URL('/web-apps/', request.url), 302);
      }

      const segment = pathname.startsWith('/app/') ? (pathname.slice(5).split('/')[0] ?? '') : '';

      if (segment === 'hybel') {
        return await handleHybel(request, env);
      }
      if (segment === 'import') {
        return await handleImport(request, env);
      }
      if (segment === 'export') {
        return await handleExport(request, env);
      }
      if (segment === 'hubspot') {
        return await handleHubSpot(request, env);
      }
      if (segment === 'pipedrive') {
        return await handlePipedrive(request, env);
      }
      if (segment === 'stripe') {
        return await handleStripe(request, env);
      }
      if (segment === 'z-report' || segment === 'front-systems') {
        return await handlePos(request, env, segment);
      }
      if (segment === 'pleo' || segment === 'revolut') {
        return await handleCards(request, env, segment);
      }
      if (segment === 'fazile' || segment === 'timma') {
        return await handleBilling(request, env, segment);
      }
      if (segment === 'lab') {
        return await handleLab(request);
      }
      if (RECONCILE_SLUGS.has(/** @type {any} */ (segment))) {
        return await handleReconcile(request, env, /** @type {import('./worker/apps/reconcile.js').ProviderSlug} */ (segment));
      }
      if (ECOMMERCE_SLUGS.has(/** @type {any} */ (segment))) {
        return await handleEcommerce(request, env, /** @type {import('./worker/apps/ecommerce.js').EcommerceSlug} */ (segment));
      }
      if (TIME_SLUGS.has(/** @type {any} */ (segment))) {
        return await handleTimeTracking(request, env, /** @type {import('./worker/apps/timetracking.js').TimeSlug} */ (segment));
      }
      if (pathname.startsWith('/app/')) {
        return errorResponse('Unknown app route.', 404);
      }
      return env.ASSETS.fetch(request);
    } catch (err) {
      if (err instanceof HttpError) {
        return errorResponse(err.message, err.status);
      }
      const message = err instanceof Error ? err.message : 'Unexpected server error.';
      return errorResponse(message, 500);
    }
  },
};
