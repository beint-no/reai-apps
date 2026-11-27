// @ts-check
import { handleCloseCheck } from './worker/apps/close-check.js';
import { handleHybel } from './worker/apps/hybel.js';
import { handleImport } from './worker/apps/import.js';
import { handleLab } from './worker/apps/lab.js';
import { handleReconcile } from './worker/apps/reconcile.js';
import { handleStripe } from './worker/apps/stripe.js';
import { handleAuth } from './worker/lib/auth.js';
import { HttpError, errorResponse, withAppHeaders } from './worker/lib/http.js';

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
      if (pathname === '/app/hybel' || pathname.startsWith('/app/hybel/')) {
        return await handleHybel(request, env);
      }
      if (pathname === '/app/import' || pathname.startsWith('/app/import/')) {
        return await handleImport(request, env);
      }
      if (pathname === '/app/stripe' || pathname.startsWith('/app/stripe/')) {
        return await handleStripe(request, env);
      }
      if (pathname === '/app/vipps' || pathname.startsWith('/app/vipps/')) {
        return await handleReconcile(request, env, 'vipps');
      }
      if (pathname === '/app/klarna' || pathname.startsWith('/app/klarna/')) {
        return await handleReconcile(request, env, 'klarna');
      }
      if (pathname === '/app/zettle' || pathname.startsWith('/app/zettle/')) {
        return await handleReconcile(request, env, 'zettle');
      }
      if (pathname === '/app/dintero' || pathname.startsWith('/app/dintero/')) {
        return await handleReconcile(request, env, 'dintero');
      }
      if (pathname === '/app/close-check' || pathname.startsWith('/app/close-check/')) {
        return await handleCloseCheck(request, env);
      }
      if (pathname === '/app/lab' || pathname.startsWith('/app/lab/')) {
        return await handleLab(request);
      }
      if (pathname.startsWith('/app/shared/')) {
        const assetResponse = await env.ASSETS.fetch(request);
        return withAppHeaders(assetResponse);
      }
      if (pathname === '/app' || pathname === '/app/') {
        return Response.redirect(new URL('/web-apps/', request.url), 302);
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
