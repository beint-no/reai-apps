# ReAI Apps

Web and desktop apps that connect to the [ReAI API](https://app.reai.no/openapi/public/ui).

**[apps.reai.no](https://apps.reai.no/)** (and legacy [GitHub Pages downloads](https://beint-no.github.io/reai-apps/)) — Web apps run in modern browsers on `apps.reai.no/app/*`. Native apps support Mac (Apple Silicon, macOS 15+) and Windows (Windows 11 25H2+, x64 or ARM64).

### Web apps (hosted on `apps.reai.no` — 82 live integrations + UI Lab)

Server-rendered HTMX 4 apps running on a single Cloudflare Worker under `/app/*`, backed by encrypted `HttpOnly` session cookies and Declarative Shadow DOM `<r-*>` Web Components.

| Category | Apps & routes |
| --- | --- |
| **Migration & Exports** | [SAF-T Norway Switcher](/app/saft/), [CSV Import](/app/import/), [BI & Excel Export](/app/export/), [UI Component Lab](/app/lab/) |
| **Payments, Inkasso & POS** | [Vipps](/app/vipps/), [Klarna](/app/klarna/), [Stripe](/app/stripe/), [Zettle](/app/zettle/), [SumUp](/app/sumup/), [Dintero](/app/dintero/), [Nets Easy](/app/nets/), [PayPal](/app/paypal/), [Two B2B](/app/two/), [Paddle / Chargebee](/app/paddle/), [Inkasso (Kredinor/Intrum/Lowell)](/app/inkasso/), [Kravia / Svea](/app/kravia/), [POS Z-Report](/app/z-report/), [Front Systems](/app/front-systems/), [PCKasse](/app/pckasse/), [ExtendaGO](/app/extendago/), [Susoft](/app/susoft/), [Favrit](/app/favrit/), [Quickorder](/app/quickorder/), [Munu](/app/munu/), [Lightspeed](/app/lightspeed/), [VisBook](/app/visbook/), [Mews](/app/mews/), [Wolt & Foodora](/app/wolt-foodora/) |
| **Ecommerce, Transport & Fleet** | [Mystore.no](/app/mystore/), [24Nettbutikk](/app/24nettbutikk/), [Magento](/app/magento/), [PrestaShop](/app/prestashop/), [Shopware 6](/app/shopware/), [Wix Stores](/app/wix/), [Squarespace / BigCommerce](/app/squarespace/), [Ongoing WMS](/app/ongoing-wms/), [ABAX Driving Log](/app/abax/), [Opter TMS](/app/opter/), [AutoNet](/app/autonet/), [Logistra](/app/logistra/) |
| **Trades, Staffing, CRM & HR** | [RecMan](/app/recman/), [SmartDok](/app/smartdok/), [Svenn](/app/svenn/), [Cordel](/app/cordel/), [Holte](/app/holte/), [Handyman](/app/handyman/), [Minuba](/app/minuba/), [HubSpot](/app/hubspot/), [Pipedrive](/app/pipedrive/), [SuperOffice](/app/superoffice/), [Lime CRM](/app/lime/), [Salesforce](/app/salesforce/), [Planday](/app/planday/), [Tamigo](/app/tamigo/), [Quinyx](/app/quinyx/), [Huma HR](/app/huma/), [Simployer](/app/simployer/), [Acubiz](/app/acubiz/), [Busy](/app/busy/), [Milient](/app/milient/), [Severa](/app/severa/), [Toggl](/app/toggl/), [Clockify](/app/clockify/), [Harvest](/app/harvest/), [Tidsbanken](/app/tidsbanken/) |
| **Clinics, Salons, Events & Property** | [Pleo](/app/pleo/), [Revolut / Wise](/app/revolut/), [Opus Dental](/app/opus-dental/), [Fixit](/app/fixit/), [Hano](/app/hano/), [PasientSky](/app/pasientsky/), [Membro](/app/membro/), [EasyPractice](/app/easypractice/), [Booking & Clinic](/app/timma/), [TicketCo](/app/ticketco/), [Checkin](/app/checkin/), [Hoopla](/app/hoopla/), [Spond & Rubic](/app/spond-rubic/), [Hybel](/app/hybel/), [Fazile](/app/fazile/), [Airbnb / Booking.com](/app/airbnb/), [Husleie.no](/app/husleie/), [Fenistra / Propely](/app/fenistra/) |

### Maintained native apps

In daily use and actively developed (require direct OS printer access).

| App | What it does |
| --- | --- |
| [Product Labels for Mac](apple/product-labels) | Create price, product and barcode labels; print variants in bulk. |
| [Shipping for Mac](apple/shipping) | Ship orders and print carrier labels directly from your Mac. |
| [Shipping for Windows](windows/shipping) | Native Windows app to ship orders and print carrier labels. Unsigned ZIP download. |

### Example native apps

OS-integrated reference apps kept building on the same foundation. Non-native apps live on `apps.reai.no` to avoid desktop duplication.

| App | What it does |
| --- | --- |
| [Time Tracker for Mac](apple/time-tracker) | Start and stop your timesheet timer from the menu bar. |
| [Time Tracker for Windows](windows/time-tracker) | Native Windows timer, with or without a project. Unsigned ZIP download. |
| [Finder Vault](apple/finder-vault) | Upload documents and watch local Finder folders for new files. |

## Install

Download from the **[app page](https://beint-no.github.io/reai-apps/)**.

- **Mac:** open the disk image and drag the app to **Applications**. Mac releases are signed with Developer ID and notarized by Apple. Shipping and Product Labels offer signed in-app updates; for other apps, quit and replace the app in Applications.
- **Windows:** choose your processor (x64 or ARM64), **Extract All** from the ZIP, and open the app’s EXE. Keep the whole folder together. No .NET installation or administrator access is needed. Shipping updates itself from **Check for updates** in the app; for the other apps, close the app and extract the new version into a new folder.

**Windows downloads are unsigned.** Windows may warn or block them. If SmartScreen offers **More info → Run anyway**, you can choose it after confirming the download came from this repository and you trust it. Smart App Control, S mode and workplace policy may prevent running the app. Keep Windows security protections enabled. See the app README for details and checksum verification.

Most apps use **Connect to ReAI** with browser approval. The Vipps, Klarna, Zettle and Dintero apps instead accept a ReAI user access token pasted into the app. Visit the selected app README for provider credentials. Your password stays in the browser. Access keys stay in macOS Keychain or Windows Credential Locker, restricted to the approved company and your existing permissions. Revoke access in your [ReAI profile](https://app.reai.no/user/profile#user-access-tokens).

## Repository

```text
apple/
  hybel/            Hybel monthly journal bridge
  product-labels/   Product, price and barcode labels
  shipping/         Shipment booking and label printing
  time-tracker/     Swift package and app source
  finder-vault/     Swift package and app source
  import/           Swift package and app source
  stripe/           Stripe migration app
  vipps/            Vipps payout reconciliation app
  klarna/           Klarna payout reconciliation app
  zettle/           Zettle payout reconciliation app
  dintero/          Dintero payout fee app
windows/
  import/           .NET 11 / WinUI 3 app and app-local import logic
  shipping/         .NET 11 / WinUI 3 app and app-local shipping logic
  time-tracker/     .NET 11 / WinUI 3 app and app-local timer logic
  global.json       Pinned .NET SDK
apps.json          App identities and download names
web/               apps.reai.no Lyn static catalog + single Cloudflare Worker + SSR/HTMX web apps
site/              GitHub Pages download site and native update feeds (updates/*.xml, updates/*.json)
tools/apple/       Apple build, signing and release tools
tools/windows/     Windows build and packaging tools
tools/web/         Web build, JSDoc typecheck and Cloudflare deploy tools
.github/           CI, release and Pages workflows
```

Each app is independently versioned. Platform folders contain app source; shared release tooling stays in `tools/`.
Apple apps use SwiftUI. Windows apps use WinUI 3 and support Windows 11 25H2+, x64 and ARM64. Each platform uses native controls.

## Add an app

Follow **[Adding a new app](CONTRIBUTING.md)** for the starting points, identity checklist, `apps.json` examples and build/release steps.
Add the app inside this monorepo and reuse the existing release tooling. No ReAI backend registration or new signing credentials are needed for ordinary apps.

## Build and release

Install the [Swift](https://www.swift.org/install/macos/) version pinned in [.swift-version](.swift-version), the macOS SDK and [uv](https://docs.astral.sh/uv/) (the build scripts require Python 3.15 and run through `uv run --script`), then run from the repository root:

```sh
tools/apple/build.py time-tracker
tools/apple/build.py finder-vault
tools/apple/build.py import
tools/apple/build.py stripe
tools/apple/build.py vipps
tools/apple/build.py klarna
tools/apple/build.py zettle
tools/apple/build.py dintero
tools/apple/build.py hybel
tools/apple/build.py shipping
tools/apple/build.py product-labels
```

Set `SWIFT_BIN` to the pinned Swift executable if needed. Local builds appear in `dist/<app>/` and are ad-hoc signed for development.
Pull requests build affected apps without signing credentials. Apple releases use the shared [Apple release workflow](tools/apple/README.md).

To release a Mac app, merge your changes, then open **[Actions → Release app](https://github.com/beint-no/reai-apps/actions/workflows/apps.yml) → Run workflow**, keep **main**, and choose the app.
Or run:

```sh
gh workflow run apps.yml --repo beint-no/reai-apps --ref main -f app=time-tracker
```

GitHub chooses the next patch version, builds, signs, notarizes, verifies, publishes the download, and updates the site.
Pull requests run build checks; publishing requires the release action. Repository write access is required.
Apple credentials are already stored in GitHub. Teammates need no signing secrets or `.zshrc` changes.
A failed verification publishes nothing.

## Windows development

Windows apps use .NET and WinUI 3. The SDK is pinned in [windows/global.json](windows/global.json); app projects and lockfiles record dependencies. GitHub Windows runners build self-contained x64/ARM64 packages. App-local logic also builds on macOS.

See [Windows Import](windows/import), [Windows Shipping](windows/shipping) and [Windows Time Tracker](windows/time-tracker) for instructions. To publish a free unsigned release, merge changes, then open **[Actions → Windows apps](https://github.com/beint-no/reai-apps/actions/workflows/windows.yml) → Run workflow**, keep **main**, and choose the app. GitHub builds both architectures, verifies the archives, publishes ZIPs and checksums, and updates the download site. Pull requests run build checks. No Azure account, signing subscription or developer-held secret is needed. See [Windows release tooling](tools/windows/README.md).

## Dependency updates

Monthly Dependabot PRs cover GitHub Actions, NuGet, Swift packages and the .NET SDK. CI selects the latest stable Python 3.15 patch. Swift compiler pins in `.swift-version`, Python minor versions, target frameworks and platform SDK properties need explicit updates. When Sparkle changes, update the release-tool download and checksum in `tools/apple/sparkle.py` together with the Swift package pins.

For synthetic workloads, Instruments recordings and runtime-async comparisons, follow the [profiling guide](tools/profiling/README.md).

## Connect another app

No registration or ReAI backend change is required:

1. POST form data to `/oauth/device/authorize` with a self-chosen `client_id` and optional `client_name`.
2. Display `user_code` and open `verification_uri_complete`. The user compares the code, chooses a company, and approves.
3. Poll `/oauth/device/token` with `client_id`, `device_code`, and `grant_type=urn:ietf:params:oauth:grant-type:device_code`.
   Respect the returned polling interval, backoff, and expiry.
4. Store `access_token` securely. Call `/api/me` for the approved company and send its ID in `X-Tenant-Id` on company requests.

Read the [public API contract](https://app.reai.no/openapi/public) before constructing requests.
App names are self-declared, not publisher verification. See [Time Tracker’s connection code](apple/time-tracker/Sources/ReAITimeTracker/Connection.swift).

[Suggest an app](https://github.com/beint-no/reai-apps/issues/new?template=app-idea.yml) · [Report an issue](https://github.com/beint-no/reai-apps/issues) · [MIT license](LICENSE)
