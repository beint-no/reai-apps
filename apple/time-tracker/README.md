# ReAI Time Tracker

A macOS menu-bar app for starting and stopping your ReAI timesheet timer. Swift 6.4, SwiftUI, no third-party dependencies.

## Install

Requires **Apple Silicon (M1 or newer)** and **macOS 15 or newer**. Intel Macs are not supported.

1. [Download Time Tracker](https://beint-no.github.io/reai-apps/#time-tracker).
2. Open **ReAI-Time-Tracker-Apple-Silicon.dmg** and drag **ReAI Time Tracker.app** into Applications.
3. Open the app. Published downloads are Developer ID signed and Apple-notarized. No build tools or security-setting changes are needed.
4. Click **Connect to ReAI**, sign in in your browser, compare the approval code, choose a company, and approve.
5. Optionally select a project and activity, then click **Start tracking**. Use **Stop & save** when finished.

Your account needs a linked employee, timesheet read/write access, and time tracking enabled in the company.
Project tracking also requires project access. No app registration or API-key copying is needed.

To update, quit the app and replace it in Applications with the latest download.

## Timer behavior

- ReAI stores the timer. Closing the app, sleep, or losing your connection does not stop it.
- Stop saves immediately when ReAI confirms it; there is no periodic timesheet save while running.
- The app reads timer status every 30 seconds. Use **Refresh** to check immediately. Refresh an already-open ReAI timesheet to see changes.
- ReAI stops timers after 10 hours and splits time at Europe/Oslo midnight.
- Only completed whole minutes are saved: 0:59 saves nothing, 1:00 saves 1 minute, 1:59 saves 1 minute. Seconds do not carry between sessions.
- The timer counts down to the first saved minute and previews what Stop will save. ReAI’s response confirms the actual result.
- Minutes accumulate in matching unedited, unbilled timesheet rows; hours are shown with two decimals.
- If a request is interrupted, **Retry saved request** safely confirms its result without duplicating time.
  Pending requests survive restarting the app and require the original account and company.
- To use another company, disconnect and connect again. Existing timers keep running.

Choose **Without a project** for general work, or search for a project/sub-project and optional activity.
**Recent work** starts a previous selection with one click; selections are scoped to your account and company.
**Command + Return** starts/stops while the tracker is focused. **Open timesheet** opens the connected company for review, notes and corrections.

This app tracks your own time. Edit timesheets or track for another employee in ReAI.

## Access and privacy

The app connects directly to `https://app.reai.no`. It has no analytics.
Your password stays in the browser; the resulting access key is stored in macOS Keychain on this device.
The key is restricted to the company chosen during approval, with your existing API permissions, until revoked.

**Disconnect** removes the local key. It does not stop timers or revoke server access.
Revoke the key in [ReAI profile → Access tokens](https://app.reai.no/user/profile#user-access-tokens).
Pending requests and recent-work metadata are stored under `~/Library/Application Support/ReAI Time Tracker/`; it contains no access key.

## Development

From the repository root, with Swift 6.4 and Apple's macOS SDK installed:

```sh
python3 tools/apple/build.py time-tracker
```

Set `SWIFT_BIN` if Swift 6.4 is not your default toolchain. Development builds appear in `dist/time-tracker/`.
See the shared [release instructions](../../tools/apple/README.md).

## API connection

Any native app, CLI or server-side integration can connect without registering with ReAI:

1. POST `/oauth/device/authorize` as form data with a self-chosen `client_id` and optional `client_name`.
2. Display `user_code` and open `verification_uri_complete`. The user compares the code, chooses a company, and approves in ReAI.
3. Poll `/oauth/device/token` with `client_id`, `device_code`, and `grant_type=urn:ietf:params:oauth:grant-type:device_code`.
   Respect the returned interval, backoff and expiry.
4. Store `access_token` securely. Call `/api/me` to get the approved company, then send its ID as `X-Tenant-Id` on API calls.

The tracker uses `time-tracker` / `ReAI Time Tracker`. Names are self-declared, not publisher verification.
Start and stop use `/api/project-timer/start` and `/api/project-timer/stop` with durable request/timer IDs.
See the [public API contract](https://app.reai.no/openapi/public).

[MIT license](LICENSE) · [ReAI Apps](https://github.com/beint-no/reai-apps) · [Issues](https://github.com/beint-no/reai-apps/issues)
