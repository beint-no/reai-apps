# Profiling ReAI Apps

Profile optimized code with a repeatable synthetic workload before changing it. Keep the input, machine, toolchain and profiler settings the same for a before/after comparison. Record several runs; report allocations, CPU time and wall time separately. A synthetic result does not establish an improvement over a real network or printer.

These tools are manual developer commands, not CI jobs or performance gates. They do not contact ReAI, load Keychain credentials, read customer journals or submit print jobs. The Apple fixtures copy the actual views/models into a temporary app with a replacement entry point. They never call the production startup, authorization, import or print actions, and disable user input. Labels state is injected into the private output directory. The labels fixture does perform read-only printer discovery.

Keep all generated source, state, PDFs, logs and `.trace` bundles outside the checkout. They can contain machine identifiers, local paths or printer details. Do not upload real customer traces to PRs. Output directories must be new; the commands do not overwrite an earlier recording.

## Apple: real views and PDF rendering

Use a Mac with the Swift version in `.swift-version`, Xcode/Instruments and `uv`. Set `SWIFT_BIN` if needed. Check the tools:

```sh
swift --version
xcodebuild -version
xcrun xctrace list templates
```

Run from the repository root, **one recording at a time**, on an otherwise quiet machine:

```sh
uv run --script tools/profiling/apple.py labels --output /tmp/reai-labels-before --template SwiftUI
uv run --script tools/profiling/apple.py import --output /tmp/reai-import-before --template SwiftUI
```

The helper builds Release with debug symbols, packages an ad-hoc fixture app and records at most 30 seconds. It retains source and dSYM files so Instruments can resolve app frames. The fixtures run automatically and quit; do not sign in or interact with them.

| Fixture | Work performed | What to inspect |
| --- | --- | --- |
| `labels` | Real Product Labels view with 1,000 synthetic items; 20 preview changes; five 1,000-page price PDFs; one printer discovery | Main-thread work, renderer/formatter costs, UI invalidation, blocking subprocess waits |
| `import` | Real Import review table with 10,000 synthetic rows; excludes 40 rows locally, 100 ms apart | Table updates, counts/filtering, main-thread work; no records are created |

Each output directory contains `metadata.json` (commit, dirty state, toolchain and dependency), `results.json` (workload timings), `workload.jsonl` (stdout plus system diagnostics), `toc.xml`, the fixture source/app/dSYM and `profile.trace`. A missing workload result fails the helper: do not treat a timeout or failed launch as a successful profile.

Open the trace in Instruments:

```sh
open /tmp/reai-labels-before/profile.trace
```

Select the relevant interval after launch. In Time Profiler, filter to the fixture process, inspect the Main Thread and app call tree, and separate initialization from repeated work. In the SwiftUI lane, inspect long/frequent updates and their causes. Use `--template Allocations` in a separate run when investigating managed object lifetimes or repeated allocations. Do not run CPU profiling, allocation profiling and compilation concurrently.

If Instruments needs tracing permission, open it normally and follow macOS's developer-tools permission prompt, then rerun. A `could not lock kperf` error means another sampler is active: stop the other recording and make a new capture. An incomplete/error trace is not a clean baseline.

### Empty SwiftUI lane

On the tested Xcode/Instruments 27.2 and macOS 27.2 setup, the synthetic apps rendered and produced symbolicated CPU samples, but the SwiftUI instrument reported **“Trace file had no SwiftUI data.”** The helper exports the update table and warns when it has no rows. This is missing instrumentation, not evidence that views did not update. Do not report view-update counts or make SwiftUI invalidation fixes from that lane.

Use the Time Profiler lane included in the recording, or make an explicit CPU recording:

```sh
uv run --script tools/profiling/apple.py labels --output /tmp/reai-labels-cpu --template 'Time Profiler'
```

The following export commands were verified locally. CPU exports can be very large; normally inspect the trace in Instruments instead of loading the full XML into memory.

```sh
xcrun xctrace export --input /tmp/reai-labels-before/profile.trace --toc --output /tmp/reai-labels-toc.xml
xcrun xctrace export --input /tmp/reai-labels-before/profile.trace --xpath '/trace-toc/run[@number="1"]/data/table[@schema="time-profile"]' --output /tmp/reai-labels-cpu.xml
```

## .NET: preview runtime-async comparison

Install the SDK pinned in `windows/global.json`. Run this from the repository root, after stopping Instruments and other builds:

```sh
uv run --script tools/profiling/runtime_async.py --output /tmp/reai-runtime-async-before
```

Set `DOTNET_BIN` to a specific `dotnet` executable if it is not on PATH. The helper runs .NET from `windows/` so the SDK pin applies. It builds both Core libraries and the harness separately with `runtime-async=off` and `runtime-async=on`, keeping all build artifacts outside the checkout.

The harness calls the actual Import and Time Tracker `Account` methods through a fake HTTP handler and validates the returned synthetic account. There are no sockets, tokens or state files from a real account. Each measured iteration makes **two** client calls. `completed` measures an immediately completed handler; `yield` inserts a suspension. Both are CPU/allocation experiments, not a model of Internet latency.

For each mode, the default is five paired runs of 100,000 iterations, alternating which variant runs first. Every process warms the JIT before measurement. Build time is excluded. `stateMachines` must be `true` for the baseline and `false` for runtime async; otherwise the helper rejects the comparison. It saves raw samples, medians and environment metadata as JSON.

Compare `bytesPerIteration`, `cpuMs` and `elapsedMs`, including the spread of individual runs. The runtime-async switch is still a preview feature. Leave production compiler settings unchanged unless representative behavior, cancellation/errors and native Windows operation have been checked and the user benefit warrants it. Do not add preview compiler flags just to improve this synthetic benchmark.

## Initial measurements — 10 November 2026

Apple M5 Max, arm64, macOS 27.2; Swift 6.4.2 / Instruments 27.2; .NET SDK 11.0.100 and runtime 11.0.0. These are observations, not performance thresholds.

- Product Labels generated a 1,000-page synthetic price PDF in approximately **0.13–0.14 seconds** per repetition. There was no evidence here to justify a renderer cache or threading rewrite.
- Import's 10,000-row review fixture completed its 40 local exclusions. Its reported duration includes the intentional pauses; it is not a per-update latency measurement.
- Both SwiftUI recordings contained CPU samples but no SwiftUI update events, so no view-invalidation optimization was made.

The first runtime-async comparison used five alternating pairs, 100,000 iterations per sample:

| Fake handler | Compiler async: bytes / iteration | Runtime async: bytes / iteration | Median wall time, compiler / runtime |
| --- | ---: | ---: | ---: |
| Immediately completed | 7,888 | 7,152 | 1,085 / 989 ms |
| Suspends once | 8,599 | 7,939 | 2,335 / 1,689 ms |

Allocations fell by roughly 8–9%. Timing was less stable: the suspending baseline ranged from 1,542 to 2,433 ms, while runtime async ranged from 1,572 to 1,746 ms. This supports further evaluation, not an end-to-end throughput claim. Production Core projects retain their default compiler async setting.

The printer migration was checked separately with harmless commands for exact argument/output handling, non-zero exit, output limits and prompt cancellation of a sleeping process. No physical print was submitted or verified. Existing submission journals and ambiguous-print recovery remain authoritative.

References: [Apple SwiftUI profiling](https://developer.apple.com/videos/play/wwdc2025/306/), [.NET runtime async](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-11/runtime#runtime-async), [Swift Subprocess](https://github.com/swiftlang/swift-subprocess).
