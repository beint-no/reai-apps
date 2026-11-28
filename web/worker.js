// @ts-check
import { handle as app_24nettbutikk } from './worker/apps/24nettbutikk.js';
import { handle as app_24sevenoffice_migrate } from './worker/apps/24sevenoffice-migrate.js';
import { handle as app_4human } from './worker/apps/4human.js';
import { handle as app_abax } from './worker/apps/abax.js';
import { handle as app_aksjonaer } from './worker/apps/aksjonaer.js';
import { handle as app_amendo } from './worker/apps/amendo.js';
import { handle as app_autogear } from './worker/apps/autogear.js';
import { handle as app_automations } from './worker/apps/automations.js';
import { handle as app_baemingo } from './worker/apps/baemingo.js';
import { handle as app_budget } from './worker/apps/budget.js';
import { handle as app_busy } from './worker/apps/busy.js';
import { handle as app_caspeco } from './worker/apps/caspeco.js';
import { handle as app_clockify } from './worker/apps/clockify.js';
import { handle as app_dintero } from './worker/apps/dintero.js';
import { handle as app_duell } from './worker/apps/duell.js';
import { handle as app_easypractice } from './worker/apps/easypractice.js';
import { handleExport as app_export } from './worker/apps/export.js';
import { handle as app_extendago } from './worker/apps/extendago.js';
import { handle as app_favrit } from './worker/apps/favrit.js';
import { handle as app_fazile } from './worker/apps/fazile.js';
import { handle as app_flow_retail } from './worker/apps/flow-retail.js';
import { handle as app_fonn } from './worker/apps/fonn.js';
import { handle as app_front_systems } from './worker/apps/front-systems.js';
import { handle as app_handyman } from './worker/apps/handyman.js';
import { handle as app_harvest } from './worker/apps/harvest.js';
import { handle as app_holte } from './worker/apps/holte.js';
import { handleHubSpot as app_hubspot } from './worker/apps/hubspot.js';
import { handle as app_huma } from './worker/apps/huma.js';
import { handle as app_husleie } from './worker/apps/husleie.js';
import { handleHybel as app_hybel } from './worker/apps/hybel.js';
import { handleImport as app_import } from './worker/apps/import.js';
import { handle as app_klarna } from './worker/apps/klarna.js';
import { handle as app_kvalitetskontroll } from './worker/apps/kvalitetskontroll.js';
import { handleLab as app_lab } from './worker/apps/lab.js';
import { handle as app_lime } from './worker/apps/lime.js';
import { handle as app_magento } from './worker/apps/magento.js';
import { handle as app_mynt } from './worker/apps/mynt.js';
import { handle as app_mystore } from './worker/apps/mystore.js';
import { handle as app_nets } from './worker/apps/nets.js';
import { handle as app_nshift } from './worker/apps/nshift.js';
import { handle as app_ongoing_wms } from './worker/apps/ongoing-wms.js';
import { handle as app_ordrestyring } from './worker/apps/ordrestyring.js';
import { handle as app_paddle } from './worker/apps/paddle.js';
import { handle as app_paypal } from './worker/apps/paypal.js';
import { handle as app_pindena } from './worker/apps/pindena.js';
import { handlePipedrive as app_pipedrive } from './worker/apps/pipedrive.js';
import { handle as app_planday } from './worker/apps/planday.js';
import { handle as app_pleo } from './worker/apps/pleo.js';
import { handle as app_power_bi } from './worker/apps/power-bi.js';
import { handle as app_poweroffice_migrate } from './worker/apps/poweroffice-migrate.js';
import { handle as app_prestashop } from './worker/apps/prestashop.js';
import { handle as app_proresult } from './worker/apps/proresult.js';
import { handle as app_proteria } from './worker/apps/proteria.js';
import { handle as app_provet_cloud } from './worker/apps/provet-cloud.js';
import { handle as app_psykbase } from './worker/apps/psykbase.js';
import { handle as app_qliro } from './worker/apps/qliro.js';
import { handle as app_quinyx } from './worker/apps/quinyx.js';
import { handle as app_rackbeat } from './worker/apps/rackbeat.js';
import { handleRecMan as app_recman } from './worker/apps/recman.js';
import { handle as app_revolut } from './worker/apps/revolut.js';
import { handle as app_saft } from './worker/apps/saft.js';
import { handle as app_salesforce } from './worker/apps/salesforce.js';
import { handle as app_severa } from './worker/apps/severa.js';
import { handle as app_sharefox } from './worker/apps/sharefox.js';
import { handle as app_shopware } from './worker/apps/shopware.js';
import { handle as app_sitoo } from './worker/apps/sitoo.js';
import { handle as app_smartdok } from './worker/apps/smartdok.js';
import { handle as app_speedycraft } from './worker/apps/speedycraft.js';
import { handle as app_spense } from './worker/apps/spense.js';
import { handle as app_squarespace } from './worker/apps/squarespace.js';
import { handleStripe as app_stripe } from './worker/apps/stripe.js';
import { handle as app_sumup } from './worker/apps/sumup.js';
import { handle as app_superoffice } from './worker/apps/superoffice.js';
import { handle as app_svea } from './worker/apps/svea.js';
import { handle as app_tamigo } from './worker/apps/tamigo.js';
import { handle as app_ticketco } from './worker/apps/ticketco.js';
import { handle as app_tidsbanken } from './worker/apps/tidsbanken.js';
import { handle as app_timely } from './worker/apps/timely.js';
import { handle as app_toggl } from './worker/apps/toggl.js';
import { handle as app_two } from './worker/apps/two.js';
import { handle as app_vipps } from './worker/apps/vipps.js';
import { handle as app_walley } from './worker/apps/walley.js';
import { handle as app_wix } from './worker/apps/wix.js';
import { handle as app_workfeed } from './worker/apps/workfeed.js';
import { handle as app_zettle } from './worker/apps/zettle.js';
import { handleAuth } from './worker/lib/auth.js';
import { HttpError, errorResponse, withAppHeaders } from './worker/lib/http.js';

/**
 * 1-to-1 route dispatch map: every external integration lives in its own isolated file
 * under web/worker/apps/<slug>.js.
 * @type {Record<string, (request: Request, env: import('./worker/lib/types.d.ts').Env) => Promise<Response> | Response>}
 */
const ROUTES = {
  '24nettbutikk': app_24nettbutikk,
  '24sevenoffice-migrate': app_24sevenoffice_migrate,
  '4human': app_4human,
  'abax': app_abax,
  'aksjonaer': app_aksjonaer,
  'amendo': app_amendo,
  'autogear': app_autogear,
  'automations': app_automations,
  'baemingo': app_baemingo,
  'budget': app_budget,
  'busy': app_busy,
  'caspeco': app_caspeco,
  'clockify': app_clockify,
  'dintero': app_dintero,
  'duell': app_duell,
  'easypractice': app_easypractice,
  'export': app_export,
  'extendago': app_extendago,
  'favrit': app_favrit,
  'fazile': app_fazile,
  'flow-retail': app_flow_retail,
  'fonn': app_fonn,
  'front-systems': app_front_systems,
  'handyman': app_handyman,
  'harvest': app_harvest,
  'holte': app_holte,
  'hubspot': app_hubspot,
  'huma': app_huma,
  'husleie': app_husleie,
  'hybel': app_hybel,
  'import': app_import,
  'klarna': app_klarna,
  'kvalitetskontroll': app_kvalitetskontroll,
  'lab': (request) => app_lab(request),
  'lime': app_lime,
  'magento': app_magento,
  'mynt': app_mynt,
  'mystore': app_mystore,
  'nets': app_nets,
  'nshift': app_nshift,
  'ongoing-wms': app_ongoing_wms,
  'ordrestyring': app_ordrestyring,
  'paddle': app_paddle,
  'paypal': app_paypal,
  'pindena': app_pindena,
  'pipedrive': app_pipedrive,
  'planday': app_planday,
  'pleo': app_pleo,
  'power-bi': app_power_bi,
  'poweroffice-migrate': app_poweroffice_migrate,
  'prestashop': app_prestashop,
  'proresult': app_proresult,
  'proteria': app_proteria,
  'provet-cloud': app_provet_cloud,
  'psykbase': app_psykbase,
  'qliro': app_qliro,
  'quinyx': app_quinyx,
  'rackbeat': app_rackbeat,
  'recman': app_recman,
  'revolut': app_revolut,
  'saft': app_saft,
  'salesforce': app_salesforce,
  'severa': app_severa,
  'sharefox': app_sharefox,
  'shopware': app_shopware,
  'sitoo': app_sitoo,
  'smartdok': app_smartdok,
  'speedycraft': app_speedycraft,
  'spense': app_spense,
  'squarespace': app_squarespace,
  'stripe': app_stripe,
  'sumup': app_sumup,
  'superoffice': app_superoffice,
  'svea': app_svea,
  'tamigo': app_tamigo,
  'ticketco': app_ticketco,
  'tidsbanken': app_tidsbanken,
  'timely': app_timely,
  'toggl': app_toggl,
  'two': app_two,
  'vipps': app_vipps,
  'walley': app_walley,
  'wix': app_wix,
  'workfeed': app_workfeed,
  'zettle': app_zettle,
};

/** Retired apps that duplicated the ReAI UI; old links land on the catalog. */
const RETIRED = new Set(['brreg-leads', 'accountant-hub', 'assets', 'gift-cards', 'mrr', 'stock-count', 'ads-spend', 'acubiz', 'airbnb', 'aspit', 'autonet', 'autopass', 'checkin', 'cordel', 'fenistra', 'fixit', 'fresha', 'hano', 'hoopla', 'ledigtime', 'lightspeed', 'logistra', 'membro', 'mews', 'milient', 'minuba', 'munu', 'opter', 'opus-dental', 'pasientsky', 'pckasse', 'propely', 'quickorder', 'simployer', 'spond-rubic', 'susoft', 'svenn', 'timma', 'unibo', 'visbook', 'wolt-foodora', 'z-report', 'tripletex-migrate', 'fiken-migrate']);

/**
 * Single Cloudflare Worker for apps.reai.no.
 * Everything outside /app/* is pure static assets served directly by Cloudflare edge.
 * @type {ExportedHandler<import('./worker/lib/types.d.ts').Env>}
 */
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    try {
      if (pathname.startsWith('/app/auth/')) return await handleAuth(request, env);
      if (pathname.startsWith('/app/shared/')) return withAppHeaders(await env.ASSETS.fetch(request));
      if (pathname === '/app' || pathname === '/app/') return Response.redirect(new URL('/en/web-apps/', request.url), 302);

      const segment = pathname.startsWith('/app/') ? (pathname.slice(5).split('/')[0] ?? '') : '';
      if (RETIRED.has(segment)) return Response.redirect(new URL('/en/web-apps/', request.url), 301);
      const handler = segment ? ROUTES[segment] : undefined;
      if (handler) return await handler(request, env);

      if (pathname.startsWith('/app/')) return errorResponse('Unknown app route.', 404);
      return env.ASSETS.fetch(request);
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err.message, err.status);
      return errorResponse(err instanceof Error ? err.message : 'Unexpected server error.', 500);
    }
  },
};
