import SwiftUI
import AppKit

@MainActor @Observable
final class VaultModel {
    var companies: [Company] = []
    var selectedCompanyID: Int?
    var destination = Destination.documents
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
    var watchedFolders: [WatchedFolder] = []
    var folderStatus: [UUID: String] = [:]
    private let folderStorage: WatchedFolderStorage
    private var customWatchers: [UUID: FolderWatcher] = [:]
    private var folderURLs: [UUID: URL] = [:]
    private var scopedFolders: Set<UUID> = []
    private var folderScans: [UUID: Task<Void, Never>] = [:]
    private var folderChanges: Set<UUID> = []
    private var scanVersions: [UUID: UUID] = [:]
    private var token = ""
    private let api: ReAIAPI
    private let storage: VaultStorage
    private var watcher: FolderWatcher?
    private var debounce: Task<Void, Never>?
    private var worker: Task<Void, Never>?
    private var scanning = false
    private var started = false

    init(api: ReAIAPI = ReAIAPI(), storage: VaultStorage = VaultStorage(), folderStorage: WatchedFolderStorage = WatchedFolderStorage()) {
        self.api = api
        self.storage = storage
        self.folderStorage = folderStorage
    }

    var company: Company? { companies.first { $0.id == selectedCompanyID } }
    var pending: Int { transfers.filter { $0.status == "Queued" || $0.status == "Uploading" }.count }
    var visibleTransfers: [Transfer] {
        transfers.filter { $0.company.id == selectedCompanyID }.reversed()
    }

    func start() async {
        guard !started else { return }
        started = true
        do {
            transfers = try await storage.load()
            watchedFolders = try await folderStorage.load()
            paused = transfers.contains { $0.status == "Queued" }
        } catch { self.error = error.localizedDescription; return }
        if let saved = await Task.detached(priority: .userInitiated, operation: { TokenStore.read() }).value {
            await connect(saved)
        }
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
                NSApp.activate(ignoringOtherApps: true)
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
            guard !candidate.isEmpty else { throw vaultError("Enter a ReAI user access token.") }
            let account = try await api.account(token: candidate)
            guard account.tenants.count == 1 else {
                throw vaultError("Connect again in your browser and choose one company.")
            }
            try await Task.detached(priority: .userInitiated) { try TokenStore.save(candidate) }.value
            token = candidate
            companies = account.tenants
            email = account.email
            selectedCompanyID = companies.count == 1 ? companies.first?.id : nil
            connected = true
            error = nil
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
        guard let original = transfers.first(where: { $0.fingerprint == fingerprint && $0.status != "Duplicate skipped" }) else { return }
        let match = original.remoteID.map { "ReAI document #\($0)" } ?? "existing upload (\(original.status.lowercased()))"
        let detail = "Same contents as \(original.filename) — \(match)."
        uploadNotice = "Duplicate skipped: \(source.lastPathComponent) (\(original.company.companyName)). \(detail)"
        if !transfers.contains(where: { $0.status == "Duplicate skipped" && $0.filename == source.lastPathComponent && $0.fingerprint == fingerprint }) {
            var skipped = Transfer(company: original.company, destination: original.destination,
                filename: source.lastPathComponent, fingerprint: fingerprint, file: original.file)
            skipped.status = "Duplicate skipped"
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
                      entry.status == "Queued" && companies.contains(where: { $0.id == entry.company.id })
                  }) {
                transfers[index].status = "Uploading"
                do {
                    try await storage.save(transfers)
                } catch {
                    transfers[index].status = "Queued"
                    self.error = error.localizedDescription
                    break
                }
                do {
                    let id = try await api.upload(transfers[index], token: token)
                    transfers[index].remoteID = id
                    transfers[index].status = "Uploaded"
                    transfers[index].detail = "ReAI document #\(id)"
                } catch {
                    transfers[index].status = "Check ReAI"
                    transfers[index].detail = error.localizedDescription + " Check ReAI before retrying; the server may have received the file."
                }
                do { try await storage.save(transfers) }
                catch { self.error = error.localizedDescription; paused = true }
            }
        }
    }

    func retry(_ id: UUID) async {
        guard let index = transfers.firstIndex(where: { $0.id == id }), transfers[index].status == "Check ReAI" else { return }
        transfers[index].status = "Queued"
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
        if panel.runModal() == .OK { Task { await add(panel.urls) } }
    }

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
                let vaultRoot = storage.root.resolvingSymlinksInPath().standardizedFileURL.path
                guard canonical.path != vaultRoot, !canonical.path.hasPrefix(vaultRoot + "/") else {
                    throw vaultError("Use Watch company inboxes for ReAI Vault folders. Choose another folder here.")
                }
                guard !watchedFolders.contains(where: { $0.path == canonical.path }) else {
                    throw vaultError("This folder is already mapped. Remove its existing mapping before assigning it again.")
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

    private func activateFolder(_ id: UUID) async {
        guard connected, let index = watchedFolders.firstIndex(where: { $0.id == id }),
              watchedFolders[index].enabled, watchedFolders[index].accountEmail == email,
              companies.contains(where: { $0.id == watchedFolders[index].company.id }) else { return }
        stopFolder(id)
        do {
            var stale = false
            let url = try URL(resolvingBookmarkData: watchedFolders[index].bookmark,
                              options: [.withSecurityScope, .withoutUI], relativeTo: nil, bookmarkDataIsStale: &stale)
            if url.startAccessingSecurityScopedResource() { scopedFolders.insert(id) }
            folderURLs[id] = url
            if stale {
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
            folderStatus[id] = "Unavailable — remove and choose the folder again."
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
                        folderStatus[id] = "Still copying — use Scan after the copy finishes."
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
                            folderStatus[id] = "File needs attention — check the upload error, then Scan."
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
