import Combine
import Sparkle

@MainActor
final class LabelsUpdater: NSObject, ObservableObject, SPUUpdaterDelegate {
    @Published private(set) var canCheck = false
    @Published private(set) var inProgress = false
    private var controller: SPUStandardUpdaterController!
    private let model: LabelsModel

    init(model: LabelsModel) {
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
        guard !model.busy, !model.connecting else {
            throw NSError(domain: "no.reai.productlabels.updater", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Updates wait until loading products, printing and sign-in finish."])
        }
        let weekday = Calendar(identifier: .gregorian).component(.weekday, from: Date())
        if updateCheck != .updates, !(2...6).contains(weekday) {
            throw NSError(domain: "no.reai.productlabels.updater", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "Automatic update checks run on weekdays."])
        }
    }
}
