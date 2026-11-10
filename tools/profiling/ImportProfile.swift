import AppKit
import SwiftUI

@main
struct ProfileApp: App {
    @State private var model: ImportModel
    init() {
        let model = ImportModel()
        model.company = Company(id: 1, companyName: "Synthetic profiling company")
        model.email = "profile@example.invalid"
        model.batch = ImportBatch(filename: "synthetic.csv", kind: .products, company: model.company!, email: model.email,
            rows: (1...10000).map {
                ImportRow(line: $0, name: "Synthetic product \($0)", fields: ["name": "Synthetic product \($0)"],
                          payload: nil, state: .ready, detail: "Synthetic profiling row")
            })
        self._model = State(initialValue: model)
        NSApplication.shared.setActivationPolicy(.regular)
    }
    var body: some Scene {
        Window("Synthetic profiling — 10,000 import rows", id: "profile") {
            ImportView(model: model).frame(width: 1160, height: 800)
                .allowsHitTesting(false)
                .task {
                    // No start/review/runImport: no credentials, journals, API calls or mutations.
                    try? await Task.sleep(for: .seconds(1))
                    let clock = ContinuousClock(), started = ContinuousClock.now
                    for row in 1...40 {
                        model.skip(row)
                        try? await Task.sleep(for: .milliseconds(100))
                    }
                    let duration = started.duration(to: clock.now).components
                    let seconds = Double(duration.seconds) + Double(duration.attoseconds) / 1e18
                    print("{\"workload\":\"import-review-10000\",\"secondsIncludingPauses\":\(seconds),\"ready\":\(model.readyCount)}")
                    try? await Task.sleep(for: .seconds(1))
                    NSApp.terminate(nil)
                }
        }
    }
}
