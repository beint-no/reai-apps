import Combine
import Sparkle

@MainActor
final class LabelsUpdater: ObservableObject {
    @Published private(set) var canCheck = false
    @Published private(set) var inProgress = false
    private let controller: SPUStandardUpdaterController

    init() {
        controller = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
        controller.updater.publisher(for: \.canCheckForUpdates).assign(to: &$canCheck)
        controller.updater.publisher(for: \.sessionInProgress).assign(to: &$inProgress)
    }

    func check() {
        controller.checkForUpdates(nil)
    }
}
