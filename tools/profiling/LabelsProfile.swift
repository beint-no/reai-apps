import AppKit
import SwiftUI

@main
struct ProfileApp: App {
    @State private var model: LabelsModel
    init() {
        let directory = URL(fileURLWithPath: ProcessInfo.processInfo.environment["REAI_PROFILE_DIR"]!)
        let model = LabelsModel(storageURL: directory.appending(path: "state.json"))
        model.saved.settings.locale = "en_US"
        model.saved.draft = LabelItem(title: "Synthetic label", price: "129.50")
        model.saved.batch = (1...1000).map { LabelItem(title: "Synthetic item \($0)", price: "129.50") }
        model.previewId = model.saved.batch.first?.id
        self._model = State(initialValue: model)
        NSApplication.shared.setActivationPolicy(.regular)
    }
    var body: some Scene {
        Window("Synthetic profiling — 1,000 labels", id: "profile") {
            LabelsView(model: model).frame(width: 1200, height: 860)
                .allowsHitTesting(false)
                .task { await workload() }
        }
    }
    private func workload() async {
        // Do not call start(): no Keychain, saved customer data, authorization or API calls.
        do {
            try await Task.sleep(for: .seconds(1))
            for index in 0..<20 {
                model.previewId = model.saved.batch[index].id
                try await Task.sleep(for: .milliseconds(100))
            }
            let clock = ContinuousClock()
            for _ in 0..<5 {
                let started = clock.now
                let data = try LabelRenderer.pdf(model.saved.batch, settings: model.saved.settings)
                print("{\"workload\":\"price-pdf-1000\",\"seconds\":\(started.duration(to: clock.now).seconds),\"pdfBytes\":\(data.count)}")
                try await Task.sleep(for: .milliseconds(200))
            }
            let started = clock.now
            await model.refreshPrinters() // Discovery only; never submit a print job.
            print("{\"workload\":\"printer-discovery\",\"seconds\":\(started.duration(to: clock.now).seconds),\"count\":\(model.printers.count),\"succeeded\":\(model.error == nil)}")
            try await Task.sleep(for: .seconds(1))
        } catch { print("Synthetic workload failed: \(error)") }
        NSApp.terminate(nil)
    }
}

private extension Duration {
    var seconds: Double { Double(components.seconds) + Double(components.attoseconds) / 1e18 }
}
