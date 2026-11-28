import SwiftUI
import AppKit

@MainActor @Observable
final class ScannerModel {
    var companies: [Company] = []
    var selectedCompanyID: Int?
    var destination = Destination(rawValue: UserDefaults.standard.string(forKey: "destination") ?? "") ?? .documents {
        didSet { UserDefaults.standard.set(destination.rawValue, forKey: "destination") }
    }
    /// Where files dropped on the menu bar icon go. Receipts by default.
    var quickDestination = Destination(rawValue: UserDefaults.standard.string(forKey: "quickDestination") ?? "") ?? .receipts {
        didSet { UserDefaults.standard.set(quickDestination.rawValue, forKey: "quickDestination") }
    }
    var transfers: [Transfer] = []
    var connected = false
    var connecting = false
    var browserConnecting = false
    var connectionCode = ""
    private var browserTask: Task<Void, Never>?
    var paused = false
    var watching = false
    var error: String?
    var email = ""
    var uploadNotice: String?
    var migrationNotice: String?
    var migrationBlocked = false
    var watchedFolders: [WatchedFolder] = []
    var folderStatus: [UUID: String] = [:]
    var capturing = false
    var showScanner = false
    var captureShortcut = HotKey.shared.shortcut {
        didSet { HotKey.shared.shortcut = captureShortcut; shortcutTaken = !HotKey.shared.register() }
    }
    var shortcutTaken = false
    private let folderStorage: WatchedFolderStorage
    private var customWatchers: [UUID: FolderWatcher] = [:]
    private var folderURLs: [UUID: URL] = [:]
    private var scopedFolders: Set<UUID> = []
    private var folderScans: [UUID: Task<Void, Never>] = [:]
    private var folderChanges: Set<UUID> = []
    private var scanVersions: [UUID: UUID] = [:]
    /// Uploads that announce their result with a notification, such as hotkey captures.
    private var announced: Set<UUID> = []
    private var token = ""
    private let api: ReAIAPI
    let storage: ScannerStorage
    private var watcher: FolderWatcher?
    private var debounce: Task<Void, Never>?
    private var worker: Task<Void, Never>?
    private var scanning = false
    private var started = false
    var openMainWindow: () -> Void = {}

    init(api: ReAIAPI = ReAIAPI(), storage: ScannerStorage = ScannerStorage(), folderStorage: WatchedFolderStorage = WatchedFolderStorage()) {
        self.api = api
        self.storage = storage
        self.folderStorage = folderStorage
    }

    var company: Company? { companies.first { $0.id == selectedCompanyID } }
    var pending: Int { visibleTransfers.filter { $0.status == TransferStatus.queued || $0.status == TransferStatus.uploading }.count }
    var visibleTransfers: [Transfer] {
        transfers.filter { $0.company.id == selectedCompanyID }.reversed()
    }
    var needsAttention: Bool {
        error != nil || visibleTransfers.contains { $0.status == TransferStatus.checkReAI || $0.status == TransferStatus.rejected }
    }

    var uploadStatus: String {
        if !connected { return "Connect to ReAI to upload documents" }
        if needsAttention { return "Uploads need attention" }
        if paused { return "Uploads paused" }
        if pending > 0 { return "\(pending) uploads waiting" }
        return "No uploads waiting"
    }

    func start() async {
        guard !started else { return }
        started = true
        await migrateFinderVault()
        do {
            transfers = try await storage.load()
            watchedFolders = try await folderStorage.load()
            paused = transfers.contains { $0.status == TransferStatus.queued }
        } catch { self.error = error.localizedDescription; return }
        if let saved = await Task.detached(priority: .userInitiated, operation: { TokenStore.read() }).value {
            await connect(saved)
        } else if !UserDefaults.standard.bool(forKey: "finderVaultKeychainChecked") {
            UserDefaults.standard.set(true, forKey: "finderVaultKeychainChecked")
            switch await Task.detached(priority: .userInitiated, operation: { FinderVaultMigration.connection() }).value {
            case .token(let legacy):
                await connect(legacy)
                if !connected { migrationNotice = "Finder Vault’s connection no longer works. Connect to ReAI to continue." }
            case .unreadable:
                migrationNotice = "Finder Vault’s connection could not be read. Connect to ReAI again to continue."
            case .missing:
                break
            }
        }
    }

    /// Moves Finder Vault's history, watched folders and inbox folders before anything is loaded.
    func migrateFinderVault() async {
        guard FinderVaultMigration.pending else { migrationBlocked = false; return }
        guard !FinderVaultMigration.oldAppRunning else {
            migrationBlocked = true
            migrationNotice = "Quit ReAI Finder Vault, then click Move Finder Vault setup to bring over its folders and history."
            return
        }
        migrationBlocked = false
        do {
            migrationNotice = try await Task.detached(priority: .userInitiated) { try FinderVaultMigration.run() }.value
        } catch { migrationNotice = error.localizedDescription }
    }

    /// Retries a migration that was blocked while Finder Vault was running.
    func retryMigration() async {
        guard worker == nil else { error = "Wait for the current upload before moving the Finder Vault setup."; return }
        await migrateFinderVault()
        guard !migrationBlocked else { return }
        do {
            transfers = try await storage.load()
            watchedFolders = try await folderStorage.load()
            await restoreCustomFolders()
            runQueue()
        } catch { self.error = error.localizedDescription }
    }

    func connectInBrowser() {
        guard !browserConnecting, !connecting, worker == nil else { return }
        browserConnecting = true
        connectionCode = ""
        error = nil
        browserTask = Task { [self] in
            defer { browserConnecting = false; browserTask = nil; connectionCode = "" }
            do {
                let credential = try await BrowserConnection(onCode: { [weak self] code in
                    await MainActor.run { self?.connectionCode = code }
                }).connect()
                try Task.checkCancellation()
                await connect(credential)
                NSApp.activate()
            } catch is CancellationError {
            } catch { self.error = error.localizedDescription }
        }
    }

    func cancelBrowserConnection() { browserTask?.cancel() }

    func connect(_ raw: String) async {
        guard !connecting, worker == nil else { return }
        connecting = true
        defer { connecting = false }
        do {
            let candidate = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !candidate.isEmpty else { throw appError("Connect to ReAI in your browser.") }
            let account = try await api.account(token: candidate)
            guard account.tenants.count == 1 else {
                throw appError("Connect again in your browser and choose one company.")
            }
            try await Task.detached(priority: .userInitiated) { try TokenStore.save(candidate) }.value
            token = candidate
            companies = account.tenants
            email = account.email
            selectedCompanyID = companies.first?.id
            connected = true
            error = nil
            if migrationNotice?.hasPrefix("Finder Vault’s connection") == true { migrationNotice = nil }
            if company != nil { await selectCompany() }
            await restoreCustomFolders()
        } catch { self.error = error.localizedDescription }
    }

    func disconnect() {
        guard worker == nil else { error = "Pause and wait for the current upload before disconnecting."; return }
        watching = false
        watcher = nil
        debounce?.cancel()
        stopCustomFolders()
        TokenStore.delete()
        token = ""
        connected = false
        companies = []
        selectedCompanyID = nil
    }

    func selectCompany() async {
        watching = false
        watcher = nil
        debounce?.cancel()
        guard let company else { return }
        do { _ = try await storage.prepare(company) } catch { self.error = error.localizedDescription }
    }

    func setWatching(_ enabled: Bool) async {
        watcher = nil
        debounce?.cancel()
        watching = enabled
        guard enabled, let company else { return }
        do {
            let folders = try await storage.prepare(company)
            watcher = try FolderWatcher(urls: folders) { [weak self] in
                Task { @MainActor in self?.scheduleScan() }
            }
            scheduleScan()
        } catch { watching = false; self.error = error.localizedDescription }
    }

    private func scheduleScan() {
        debounce?.cancel()
        debounce = Task {
            do { try await Task.sleep(for: .seconds(3)) } catch { return }
            guard watching else { return }
            await scan()
        }
    }

    func scan() async {
        guard !scanning, let company, connected else { return }
        scanning = true
        defer { scanning = false }
        do {
            for (url, destination) in try await storage.inboxFiles(company) {
                await stage([url], company: company, destination: destination)
            }
        } catch { self.error = error.localizedDescription }
    }

    func add(_ urls: [URL]) async {
        guard let company, connected else { return }
        await stage(urls, company: company, destination: destination)
    }

    /// Files dropped on the menu bar icon or its panel.
    func quickAdd(_ urls: [URL]) async {
        guard let company, connected else { error = "Connect to ReAI before dropping files."; openMainWindow(); return }
        await stage(urls, company: company, destination: quickDestination)
    }

    /// Stages a file the app created (capture, camera or scan) and removes the temporary original.
    @discardableResult
    func addCreated(_ url: URL, destination: Destination, announce: Bool) async -> Bool {
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        guard let company, connected else {
            error = "Connect to ReAI to upload \(url.lastPathComponent)."
            if announce { Notifications.post(title: "Not uploaded", body: "Connect ReAI Document Scanner to a company first.") }
            return false
        }
        let before = Set(transfers.map(\.id))
        let succeeded = await stage([url], company: company, destination: destination)
        if announce {
            let added = transfers.filter { !before.contains($0.id) }
            if let entry = added.first, entry.status != TransferStatus.duplicate {
                announced.insert(entry.id)
                if paused { Notifications.post(title: "Capture saved", body: "Uploads are paused. Resume to send it to \(destination.rawValue).") }
            } else if !succeeded {
                Notifications.post(title: "Not uploaded", body: error ?? "The capture could not be saved.")
            } else {
                Notifications.post(title: "Already uploaded", body: uploadNotice ?? "The same file was uploaded before.")
            }
        }
        return succeeded
    }

    @discardableResult
    private func stage(_ urls: [URL], company: Company, destination: Destination) async -> Bool {
        var succeeded = true
        for url in urls {
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            do {
                switch try await storage.stage(url, company: company, destination: destination,
                                                known: Set(transfers.map(\.fingerprint))) {
                case .staged(let entry):
                    if !transfers.contains(where: { $0.fingerprint == entry.fingerprint }) {
                        transfers.append(entry)
                        try await storage.save(transfers)
                    } else {
                        try await recordDuplicate(url, fingerprint: entry.fingerprint)
                    }
                case .duplicate(let fingerprint):
                    try await recordDuplicate(url, fingerprint: fingerprint)
                case .ignored:
                    break
                }
            } catch { self.error = error.localizedDescription; succeeded = false }
        }
        runQueue()
        return succeeded
    }

    private func recordDuplicate(_ source: URL, fingerprint: String) async throws {
        guard let original = transfers.first(where: { $0.fingerprint == fingerprint && $0.status != TransferStatus.duplicate }) else { return }
        let match = original.remoteID.map { "ReAI document #\($0)" } ?? "existing upload (\(original.status.lowercased()))"
        let detail = "Same contents as \(original.filename): \(match)."
        uploadNotice = "Duplicate skipped: \(source.lastPathComponent) (\(original.company.companyName)). \(detail)"
        if !transfers.contains(where: { $0.status == TransferStatus.duplicate && $0.filename == source.lastPathComponent && $0.fingerprint == fingerprint }) {
            var skipped = Transfer(company: original.company, destination: original.destination,
                filename: source.lastPathComponent, fingerprint: fingerprint, file: original.file)
            skipped.status = TransferStatus.duplicate
            skipped.detail = detail
            skipped.remoteID = original.remoteID
            transfers.append(skipped)
        }
        try await storage.save(transfers)
    }

    func runQueue() {
        guard worker == nil, connected, !paused else { return }
        worker = Task {
            defer { worker = nil }
            while !paused, connected,
                  let index = transfers.firstIndex(where: { entry in
                      entry.status == TransferStatus.queued && companies.contains(where: { $0.id == entry.company.id })
                  }) {
                transfers[index].status = TransferStatus.uploading
                do {
                    try await storage.save(transfers)
                } catch {
                    transfers[index].status = TransferStatus.queued
                    self.error = error.localizedDescription
                    break
                }
                let id = transfers[index].id
                do {
                    let remote = try await api.upload(transfers[index], token: token)
                    transfers[index].remoteID = remote
                    transfers[index].status = TransferStatus.uploaded
                    transfers[index].detail = "ReAI document #\(remote)"
                } catch let rejected as UploadRejected {
                    transfers[index].status = TransferStatus.rejected
                    transfers[index].detail = rejected.message
                } catch {
                    transfers[index].status = TransferStatus.checkReAI
                    let message = error.localizedDescription
                    transfers[index].detail = message + (message.hasSuffix(".") ? " " : ". ") + "Check ReAI before retrying; the server may have received the file."
                }
                if announced.remove(id) != nil { announce(transfers[index]) }
                do { try await storage.save(transfers) }
                catch { self.error = error.localizedDescription; paused = true }
            }
        }
    }

    private func announce(_ transfer: Transfer) {
        switch transfer.status {
        case TransferStatus.uploaded:
            Notifications.post(title: "Uploaded to \(transfer.destination.rawValue)", body: "\(transfer.filename) · \(transfer.detail)")
        case TransferStatus.rejected:
            Notifications.post(title: "Not uploaded", body: "\(transfer.filename): \(transfer.detail)")
        default:
            Notifications.post(title: "Check ReAI", body: "\(transfer.filename) may not have uploaded. Check ReAI before retrying.")
        }
    }

    /// Uncertain uploads are retried only after the user has checked ReAI. Rejected uploads can be retried directly.
    func retry(_ id: UUID) async {
        guard let index = transfers.firstIndex(where: { $0.id == id }),
              [TransferStatus.checkReAI, TransferStatus.rejected].contains(transfers[index].status) else { return }
        transfers[index].status = TransferStatus.queued
        transfers[index].detail = ""
        do { try await storage.save(transfers); runQueue() }
        catch { self.error = error.localizedDescription }
    }

    func showFolder() async {
        guard let company else { return }
        do {
            _ = try await storage.prepare(company)
            let url = await storage.folder(company, destination)
            NSWorkspace.shared.open(url)
        } catch { self.error = error.localizedDescription }
    }

    func chooseFiles() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.pdf, .image]
        if panel.runModal() == .OK { Task { await add(panel.urls) } }
    }

    // MARK: Capture, camera and scanners

    /// Lets the user select a screen region and uploads it to Receipt reception.
    func captureReceipt() async {
        guard !capturing else { return }
        guard connected, company != nil else {
            openMainWindow()
            error = "Connect to ReAI before capturing receipts."
            return
        }
        capturing = true
        defer { capturing = false }
        do {
            guard let url = try await ScreenCapture.region() else { return }
            await Notifications.requestAuthorization()
            await addCreated(url, destination: .receipts, announce: true)
        } catch {
            self.error = error.localizedDescription
            Notifications.post(title: "Capture failed", body: error.localizedDescription)
        }
    }

    /// Files from Continuity Camera or a scanner: written to a temporary folder, then staged.
    func addScan(_ data: Data, filename: String, destination: Destination) async {
        do {
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let url = folder.appendingPathComponent(filename)
            try data.write(to: url, options: .atomic)
            await addCreated(url, destination: destination, announce: false)
        } catch { self.error = error.localizedDescription }
    }

    // MARK: Watched folders

    var visibleWatchedFolders: [WatchedFolder] {
        watchedFolders.filter { $0.company.id == selectedCompanyID && $0.accountEmail == email }
    }

    func chooseWatchedFolder() {
        guard let company else { return }
        let destination = destination
        let accountEmail = email
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.prompt = "Watch folder"
        panel.message = "New files will upload to \(company.companyName) → \(destination.rawValue). Existing files are skipped. Subfolders are not watched."
        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task {
            let accessed = url.startAccessingSecurityScopedResource()
            defer { if accessed { url.stopAccessingSecurityScopedResource() } }
            do {
                let canonical = url.resolvingSymlinksInPath().standardizedFileURL
                let appRoot = storage.root.resolvingSymlinksInPath().standardizedFileURL.path
                guard canonical.path != appRoot, !canonical.path.hasPrefix(appRoot + "/") else {
                    throw appError("Use Watch company inboxes for \(AppEnvironment.documentsFolder) folders. Choose another folder here.")
                }
                guard !watchedFolders.contains(where: { $0.path == canonical.path }) else {
                    throw appError("This folder is already mapped. Remove its existing mapping before assigning it again.")
                }
                let entry = WatchedFolder(company: company, destination: destination, accountEmail: accountEmail,
                    bookmark: try canonical.bookmarkData(options: .withSecurityScope, includingResourceValuesForKeys: nil, relativeTo: nil),
                    path: canonical.path, knownFiles: try await folderStorage.snapshot(canonical))
                var updated = watchedFolders
                updated.append(entry)
                try await folderStorage.save(updated)
                watchedFolders = updated
                await activateFolder(entry.id)
            } catch { self.error = error.localizedDescription }
        }
    }

    private func stopFolder(_ id: UUID) {
        customWatchers[id] = nil
        folderScans.removeValue(forKey: id)?.cancel()
        folderChanges.remove(id)
        scanVersions[id] = nil
        if let url = folderURLs.removeValue(forKey: id), scopedFolders.remove(id) != nil {
            url.stopAccessingSecurityScopedResource()
        }
    }

    private func stopCustomFolders() {
        for id in Array(folderURLs.keys) { stopFolder(id) }
        folderStatus = [:]
    }

    private func restoreCustomFolders() async {
        stopCustomFolders()
        for folder in watchedFolders where folder.enabled && folder.accountEmail == email {
            await activateFolder(folder.id)
        }
    }

    /// Resolves the saved bookmark. Bookmarks made by Finder Vault belong to that app, so a moved folder falls back to
    /// its saved path and gets a new bookmark.
    private func resolveFolder(_ folder: WatchedFolder) throws -> (url: URL, renewed: Bool) {
        var stale = false
        if let url = try? URL(resolvingBookmarkData: folder.bookmark, options: [.withSecurityScope, .withoutUI],
                              relativeTo: nil, bookmarkDataIsStale: &stale) {
            return (url, stale)
        }
        if let url = try? URL(resolvingBookmarkData: folder.bookmark, options: [.withoutUI], relativeTo: nil, bookmarkDataIsStale: &stale) {
            return (url, true)
        }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: folder.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            throw appError("\(URL(fileURLWithPath: folder.path).lastPathComponent) is no longer available.")
        }
        return (URL(fileURLWithPath: folder.path, isDirectory: true), true)
    }

    private func activateFolder(_ id: UUID) async {
        guard connected, let index = watchedFolders.firstIndex(where: { $0.id == id }),
              watchedFolders[index].enabled, watchedFolders[index].accountEmail == email,
              companies.contains(where: { $0.id == watchedFolders[index].company.id }) else { return }
        stopFolder(id)
        do {
            let (url, renewed) = try resolveFolder(watchedFolders[index])
            if url.startAccessingSecurityScopedResource() { scopedFolders.insert(id) }
            folderURLs[id] = url
            if renewed {
                watchedFolders[index].bookmark = try url.bookmarkData(options: .withSecurityScope, includingResourceValuesForKeys: nil, relativeTo: nil)
            }
            watchedFolders[index].path = url.path
            customWatchers[id] = try FolderWatcher(urls: [url]) { [weak self] in
                Task { @MainActor in self?.scheduleFolderScan(id) }
            }
            try await folderStorage.save(watchedFolders)
            folderStatus[id] = "Watching"
            scheduleFolderScan(id)
        } catch {
            stopFolder(id)
            folderStatus[id] = "Unavailable. Remove it and choose the folder again."
            self.error = error.localizedDescription
        }
    }

    func setFolderEnabled(_ id: UUID, _ enabled: Bool) async {
        guard let index = watchedFolders.firstIndex(where: { $0.id == id }) else { return }
        watchedFolders[index].enabled = enabled
        stopFolder(id)
        do {
            try await folderStorage.save(watchedFolders)
            folderStatus[id] = enabled ? "Starting…" : "Paused"
            if enabled { await activateFolder(id) }
        } catch { self.error = error.localizedDescription }
    }

    func removeFolder(_ id: UUID) async {
        stopFolder(id)
        let updated = watchedFolders.filter { $0.id != id }
        do {
            try await folderStorage.save(updated)
            watchedFolders = updated
            folderStatus[id] = nil
        } catch { self.error = error.localizedDescription }
    }

    func scheduleFolderScan(_ id: UUID) {
        guard folderURLs[id] != nil else { return }
        folderChanges.insert(id)
        guard folderScans[id] == nil else { return }
        let version = UUID()
        scanVersions[id] = version
        folderScans[id] = Task {
            defer { if scanVersions[id] == version { folderScans[id] = nil } }
            var previous: [String: FileStamp] = [:]
            var attempts = 0
            while !Task.isCancelled, connected, let url = folderURLs[id] {
                folderChanges.remove(id)
                do {
                    attempts += 1
                    guard attempts <= 100 else {
                        folderStatus[id] = "Still copying. Use Scan after the copy finishes."
                        return
                    }
                    let snapshot = try await folderStorage.snapshot(url)
                    guard !Task.isCancelled,
                          let folder = watchedFolders.first(where: { $0.id == id && $0.enabled }),
                          folder.accountEmail == email else { return }
                    var waiting = false
                    for (name, stamp) in snapshot where folder.knownFiles[name] != stamp {
                        guard !Task.isCancelled, folderURLs[id] != nil else { return }
                        guard previous[name] == stamp, stamp.size > 0 else { waiting = true; continue }
                        folderStatus[id] = "Queuing \(name)"
                        let success = await stage([url.appendingPathComponent(name)], company: folder.company, destination: folder.destination)
                        guard !Task.isCancelled, let index = watchedFolders.firstIndex(where: { $0.id == id }) else { return }
                        if success {
                            watchedFolders[index].knownFiles[name] = stamp
                            try await folderStorage.save(watchedFolders)
                        } else {
                            folderStatus[id] = "File needs attention. Check the upload error, then Scan."
                            return
                        }
                    }
                    previous = snapshot
                    if !waiting && !folderChanges.contains(id) { folderStatus[id] = "Watching"; return }
                    folderStatus[id] = "Waiting for files to finish copying…"
                    try await Task.sleep(for: .seconds(3))
                } catch is CancellationError { return }
                catch { folderStatus[id] = "Cannot scan folder"; self.error = error.localizedDescription; return }
            }
        }
    }
}
