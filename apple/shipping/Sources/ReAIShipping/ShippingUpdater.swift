import Combine
import Sparkle

@MainActor
final class ShippingUpdater: NSObject, ObservableObject, SPUUpdaterDelegate {
    @Published private(set) var canCheck = false
    @Published private(set) var inProgress = false
    private var controller: SPUStandardUpdaterController!
    private let model: ShippingModel

    init(model: ShippingModel) {
        self.model = model
        super.init()
        controller = SPUStandardUpdaterController(startingUpdater: false, updaterDelegate: self, userDriverDelegate: nil)
        controller.updater.publisher(for: \.canCheckForUpdates).assign(to: &$canCheck)
        controller.updater.publisher(for: \.sessionInProgress).assign(to: &$inProgress)
        controller.startUpdater()
    }

    func check() {
        controller.checkForUpdates(nil)
    }

    func updater(_ updater: SPUUpdater, mayPerform updateCheck: SPUUpdateCheck) throws {
        guard !model.busy, !model.loadingLocations, !model.connecting else {
            throw NSError(domain: "no.reai.shipping.updater", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Updates wait until shipping, printing and sign-in finish."])
        }
        let weekday = Calendar(identifier: .gregorian).component(.weekday, from: Date())
        if updateCheck != .updates, !(2...6).contains(weekday) {
            throw NSError(domain: "no.reai.shipping.updater", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "Automatic update checks run on weekdays."])
        }
    }
}
