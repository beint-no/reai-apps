# apps.reai.no (Web platform)

Single-origin, single-Worker web platform hosted on `apps.reai.no`.

## Architecture

- Everything outside `/app/*` is pure static HTML, plain modern CSS and AVIF/SVG assets built with `lyn` (`https://github.com/beint-no/lyn`) and served directly from Cloudflare edge without running the Worker.
- `/app/*` routes to the single Cloudflare Worker (`worker.js`), which dispatches cleanly to encapsulated JS modules under `worker/lib/` and `worker/apps/`.
- Interactive apps are server-rendered with auto-escaping `html\`...\`` tagged templates (`worker/lib/html.js`), HTMX 4 (`apps/shared/vendor/htmx-4.0.0.min.js`) and zero-framework Declarative Shadow DOM Web Components (`worker/lib/ui.js`) to eliminate FOUC.
- ReAI authentication runs strictly server-to-server inside `worker/lib/auth.js`. Access tokens are encrypted with AES-256-GCM inside an `HttpOnly; Secure; SameSite=Lax; Path=/app` cookie and never touch `localStorage` or browser JS.
- Plain modern ESM JavaScript with strict JSDoc (`// @ts-check`, `tsconfig.json` `checkJs: true`, `strict: true`) — zero bundler and zero runtime npm dependencies.
- Modern browser platform only (Baseline Newly Available is encouraged whenever it simplifies or speeds up the site): AVIF images, `@view-transition`, `interpolate-size`, `@starting-style`, `content-visibility`, native CSS nesting, `@layer`, `color-mix()`, Popover API, Invoker Commands (`command`/`commandfor`), Declarative Shadow DOM, Web Crypto and native ESM. Never add polyfills or legacy fallbacks—outdated browsers receive a notice to update.

## Commands

```sh
# Install dev-only JSDoc type-checking dependencies once
npm --prefix web ci

# Build catalog (offline placeholders), copy shared app assets and run strict JSDoc typecheck
tools/web/build.py --offline

# Local preview (static catalog + Worker SSR/HTMX apps)
wrangler dev --config web/wrangler.jsonc

# Deploy to apps.reai.no (requires CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and SESSION_SECRET set on Worker)
tools/web/deploy.py
```

## Production secret

Before deploying live auth, set the Worker secret once:

```sh
wrangler secret put SESSION_SECRET --config web/wrangler.jsonc
```

Local `wrangler dev` on `localhost`/`127.0.0.1` automatically generates an ephemeral in-memory secret; non-localhost requests fail closed if `SESSION_SECRET` is unset.
