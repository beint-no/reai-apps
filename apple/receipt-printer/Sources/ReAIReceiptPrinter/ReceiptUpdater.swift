import Combine
import Foundation
import Sparkle

@MainActor
final class ReceiptUpdater: NSObject, ObservableObject, SPUUpdaterDelegate {
    @Published private(set) var canCheck = false
    @Published private(set) var inProgress = false
    private var controller: SPUStandardUpdaterController?
    var configured: Bool { controller != nil }
    private let model: ReceiptModel

    init(model: ReceiptModel) {
        self.model = model
        super.init()
        guard let key = Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") as? String,
              Data(base64Encoded: key)?.count == 32 else { return }
        let controller = SPUStandardUpdaterController(startingUpdater: false, updaterDelegate: self, userDriverDelegate: nil)
        controller.updater.publisher(for: \.canCheckForUpdates).assign(to: &$canCheck)
        controller.updater.publisher(for: \.sessionInProgress).assign(to: &$inProgress)
        self.controller = controller
        controller.startUpdater()
    }

    func check() {
        controller?.checkForUpdates(nil)
    }

    func updater(_ updater: SPUUpdater, mayPerform updateCheck: SPUUpdateCheck) throws {
        guard !model.busy, !model.connecting else {
            throw NSError(domain: "no.reai.receiptprinter.updater", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Updates wait until loading receipts, printing and sign-in finish."])
        }
        let weekday = Calendar(identifier: .gregorian).component(.weekday, from: Date())
        if updateCheck != .updates, !(2...6).contains(weekday) {
            throw NSError(domain: "no.reai.receiptprinter.updater", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "Automatic update checks run on weekdays."])
        }
    }
}
