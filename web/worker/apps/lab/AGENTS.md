# UI Component Lab

Route `/app/lab/`. No docs pages and no catalog entry: this is an internal playground for the shared
SSR components in `web/worker/lib/ui.js` (Declarative Shadow DOM, HTMX 4 swap, native popover and
dialog invokers).

## Vendor API

None. The app calls no third-party API.

## ReAI API

None. No session, no ReAI calls, zero subrequests per action.

## Routes

- `GET /app/lab/`: component gallery.
- `POST /app/lab/ping`: same-origin HTMX fragment swap demo.
- No `/sample` route by design: the page is itself the sample, and there is no data to preview.

## Caveats

Keep it free of credentials and customer data. If a shared component changes, check it renders here.

Last verified: 2026-11-28.
