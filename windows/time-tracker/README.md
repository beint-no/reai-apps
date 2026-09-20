# ReAI Time Tracker for Windows

Track your own work in ReAI, with or without a project. Native WinUI 3, Windows 11 25H2+, x64 or ARM64.

## Download

The public Windows download is pending trusted Windows code signing. CI builds are for development.
The app bundles .NET and the Windows App SDK; customers will not need build tools or separate runtimes.
The [Mac version](../../apple/time-tracker) is available now.

## Track time

1. **Connect to ReAI**, compare the code in your browser, choose a company and approve.
2. Choose **Without a project** for general work, or search for a project/sub-project. Optionally choose an activity.
3. **Start tracking**. Recent-work buttons start the same project/activity with one click.
4. **Stop & save** when finished. The app confirms exactly how many minutes ReAI saved.

**Ctrl + Enter** starts/stops while the app is focused. **Keep on top** keeps the timer visible while you work.
The last selection and recent work stay scoped to the connected account/company. **Open timesheet** opens that company in ReAI for review, notes and corrections.
Your ReAI account needs a linked employee, timesheet read/write permission and time tracking enabled. Project access is only needed for project work.

## When time is saved

Stop sends the request immediately. ReAI saves completed whole minutes before replying; it does not save timesheet entries periodically while running.

| Session duration | Saved time |
| --- | --- |
| 0:59 | No timesheet entry |
| 1:00 | 1 minute |
| 1:59 | 1 minute |
| 2:00 | 2 minutes |

The app counts down to the first saved minute and previews the whole minutes Stop will save. The response from ReAI is authoritative.
Seconds are rounded down for each session, not carried between sessions. Matching unedited/unbilled timesheet rows accumulate saved minutes; hours are displayed with two decimals.
Status is checked every 30 seconds and on window activation. This is a read interval, not a save interval. Refresh an already-open ReAI timesheet to see changes.

Timers keep running when the app closes, the PC sleeps, or the network disconnects. Start/Stop need internet; an unconfirmed Stop may leave the timer running until the request reaches ReAI.
ReAI caps each session at 10 hours. Its once-per-minute expiry job completes timers that reach that limit. Sessions crossing midnight split by Europe/Oslo dates.

Interrupted requests show **Retry saved request**. The exact start UUID or stop timer ID is saved before sending, and retries cannot create a second session or stop a newer timer.
Reconnect with the original account/company to resolve a pending request.

## Storage

Access keys stay in Windows Credential Locker. Disconnect removes the local key; revoke server access in your [ReAI profile](https://app.reai.no/user/profile#user-access-tokens).
Pending operations, recent work and the last saved result are in `%LOCALAPPDATA%\ReAI\TimeTracker\tracker.json`. No token is stored there. Running timers remain in ReAI when you disconnect.

## Development

[.NET SDK 11.0.100-rc.1.26425.128](https://dotnet.microsoft.com/en-us/download/dotnet/11.0), C# 15, Windows App SDK 2.5.1, Windows SDK Build Tools 10.0.28000.2705 and .NET Windows reference package 10.0.26100.87. Checked 20 September 2026. .NET 11 RC1 is explicitly selected and has Microsoft go-live support.

On macOS, build the app-local logic from `windows/`: `dotnet build time-tracker/Core`.
WinUI requires Windows. CI builds both apps for x64 and ARM64 and checks native x64 startup.

```powershell
./tools/windows/build.ps1 -App time-tracker-windows -Architecture x64
```

API: `/api/me`, `/api/projects`, `/api/projects/activities`, `/api/project-timer`, `/api/project-timer/start`, `/api/project-timer/stop`. Authentication uses the registration-free device flow with `time-tracker-windows`. ReAI owns accounting and permissions.

Windows dependencies use individual WinUI/runtime components, without unused AI/ML, widgets or search packages. All resolved NuGet packages were checked against their latest stable versions: WinUI 2.3.9, Runtime 2.5.1, Interactive Experiences 2.1.9, Foundation 2.3.12, Base 2.0.4, WebView2 1.0.4191.47, SDK Build Tools 10.0.28000.2705 and MSIX Build Tools 1.7.260903100.
