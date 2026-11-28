import SwiftUI
import AppKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let model = ScannerModel()
    private var statusItem: StatusItemController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = StatusItemController(model: model)
        NSApp.registerServicesMenuSendTypes([], returnTypes: DeviceImportControl.returnTypes)
        HotKey.shared.action = { [model] in Task { await model.captureReceipt() } }
        model.shortcutTaken = !HotKey.shared.register()
        Task { await model.start() }
    }

    /// The app keeps running in the menu bar so watched folders, drops and the capture shortcut keep working.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        if !hasVisibleWindows { model.openMainWindow() }
        return true
    }
}

@main
struct DocumentScannerApp: App {
    @NSApplicationDelegateAdaptor private var delegate: AppDelegate

    var body: some Scene {
        Window(AppEnvironment.appName, id: "scanner") {
            MainWindowContent(model: delegate.model)
        }
        .defaultSize(width: 980, height: 680)
        .commands {
            CommandGroup(after: .newItem) {
                Button("Capture Receipt") { Task { await delegate.model.captureReceipt() } }
                Button("Scan with Scanner…") { delegate.model.showScanner = true }
                    .disabled(delegate.model.company == nil)
            }
        }
        Settings { SettingsView(model: delegate.model).frame(width: 460).padding(28) }
    }
}

struct MainWindowContent: View {
    @Bindable var model: ScannerModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        GeometryReader { geometry in
            ScannerView(model: model, availableHeight: geometry.size.height)
                .frame(width: geometry.size.width, height: geometry.size.height)
        }
        .frame(minWidth: 800, minHeight: 640)
        .onAppear {
            let open = openWindow
            model.openMainWindow = { open(id: "scanner"); NSApp.activate() }
        }
    }
}

struct SettingsView: View {
    @Bindable var model: ScannerModel
    @State private var launchAtLogin = LoginItem.enabled
    @State private var loginError: String?

    var body: some View {
        TabView {
            ConnectionView(model: model).padding(.top, 8).tabItem { Label("Account", systemImage: "person.crop.circle") }
            Form {
                Toggle("Open at login", isOn: Binding(get: { launchAtLogin }, set: { enabled in
                    do { try LoginItem.set(enabled); loginError = nil } catch { loginError = error.localizedDescription }
                    launchAtLogin = LoginItem.enabled
                }))
                if let loginError { Text(loginError).font(.caption).foregroundStyle(.red) }
                Text("The app stays in the menu bar, so watched folders, drops and the capture shortcut keep working.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                Picker("Capture shortcut", selection: $model.captureShortcut) {
                    ForEach(Shortcut.options) { Text($0.title).tag($0) }
                }
                if model.shortcutTaken {
                    Text("Another app already uses this shortcut. Choose another one.").font(.caption).foregroundStyle(.red)
                }
                Text("The shortcut lets you select part of the screen and uploads it to Receipt reception.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                Picker("Menu bar drops go to", selection: $model.quickDestination) {
                    ForEach(Destination.allCases) { Text($0.rawValue).tag($0) }
                }
            }
            .formStyle(.grouped)
            .tabItem { Label("General", systemImage: "gearshape") }
            .onAppear { launchAtLogin = LoginItem.enabled }
        }
        .frame(minHeight: 380)
    }
}

struct ConnectionView: View {
    @Bindable var model: ScannerModel
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Image(systemName: "doc.viewfinder").font(.system(size: 38)).foregroundStyle(.teal)
            Text("Connect to ReAI").font(.title2.bold())
            if AppEnvironment.isLocal {
                Label("LOCAL TEST · localhost:18087", systemImage: "hammer.fill")
                    .font(.callout.bold()).foregroundStyle(.orange)
            }
            Text("Connect your ReAI account to upload scans, receipts and documents from this Mac. Your access token stays in macOS Keychain.")
                .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if let notice = model.migrationNotice {
                Text(notice).font(.callout).fixedSize(horizontal: false, vertical: true)
            }
            if model.connected {
                Label(model.email, systemImage: "checkmark.shield.fill")
                Button("Disconnect", role: .destructive) { model.disconnect() }
                Text("Disconnect removes the key from this Mac. To revoke access on the server, remove the key in your ReAI profile.")
                    .font(.caption).foregroundStyle(.secondary)
                Link("Manage access in ReAI ↗", destination: AppEnvironment.profileURL)
            } else {
                Button(model.browserConnecting ? "Waiting for your browser…" : "Connect to ReAI") {
                    model.connectInBrowser()
                }
                .buttonStyle(.borderedProminent).tint(.teal).disabled(model.connecting || model.browserConnecting)
                if model.browserConnecting {
                    Text("Choose a company and approve in your browser.")
                        .font(.callout).foregroundStyle(.secondary)
                    if !model.connectionCode.isEmpty {
                        Text(model.connectionCode).font(.title2.monospaced().bold()).textSelection(.enabled)
                        Text("Only approve if this code matches the one shown in ReAI.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Button("Cancel connection") { model.cancelBrowserConnection() }
                }
            }
            if let error = model.error { Text(error).font(.callout).foregroundStyle(.red).textSelection(.enabled) }
        }
    }
}

enum TransferRow {
    static func symbol(_ status: String) -> String {
        switch status {
        case TransferStatus.uploaded: "checkmark.circle.fill"
        case TransferStatus.duplicate: "doc.on.doc"
        case TransferStatus.checkReAI, TransferStatus.rejected: "exclamationmark.triangle"
        default: "doc.text"
        }
    }

    static func tint(_ status: String) -> Color {
        switch status {
        case TransferStatus.uploaded: .teal
        case TransferStatus.checkReAI, TransferStatus.rejected: .orange
        default: .secondary
        }
    }
}

struct ScannerView: View {
    @Bindable var model: ScannerModel
    let availableHeight: CGFloat
    @State private var search = ""
    @State private var targeted = false
    @State private var retryID: UUID?
    @State private var showWatchedFolders = false

    var body: some View {
        Group {
            if !model.connected {
                ConnectionView(model: model).frame(maxWidth: 440).padding(44).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                HSplitView {
                    sidebar
                        .padding(20)
                        .frame(minWidth: 250, idealWidth: 270, maxWidth: 310, alignment: .topLeading)
                        .frame(height: availableHeight, alignment: .topLeading)
                    uploads
                        .padding(28).frame(maxWidth: .infinity, alignment: .topLeading)
                        .frame(height: availableHeight, alignment: .topLeading)
                }
            }
        }
        .sheet(isPresented: $showWatchedFolders) { WatchedFoldersView(model: model) }
        .sheet(isPresented: $model.showScanner) { ScannerSheet(model: model) }
        .alert("Retry this upload?", isPresented: Binding(get: { retryID != nil }, set: { if !$0 { retryID = nil } })) {
            Button("Cancel", role: .cancel) { retryID = nil }
            Button("I checked ReAI, retry") { if let id = retryID { Task { await model.retry(id) } }; retryID = nil }
        } message: { Text("Check whether the document already exists in ReAI. Retrying an upload that was accepted can create a duplicate.") }
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 18) {
            Label("Document Scanner", systemImage: "doc.viewfinder").font(.title2.bold()).foregroundStyle(.teal)
            if AppEnvironment.isLocal {
                Text("LOCAL TEST · localhost:18087").font(.caption.bold()).foregroundStyle(.orange)
            }
            if let company = model.company {
                Text(company.companyName).font(.headline)
            }
            VStack(alignment: .leading, spacing: 10) {
                Text("Upload destination").font(.headline)
                Picker("Upload destination", selection: $model.destination) {
                    ForEach(Destination.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.radioGroup).labelsHidden()
                .fixedSize(horizontal: false, vertical: true)
            }
            Divider()
            VStack(alignment: .leading, spacing: 8) {
                Button("Capture receipt", systemImage: "rectangle.dashed") { Task { await model.captureReceipt() } }
                if model.captureShortcut.id != "off" {
                    Text("\(model.captureShortcut.title) from any app uploads a screen selection to Receipt reception.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                DeviceImportButton { data, name in
                    let destination = model.destination
                    Task { await model.addScan(data, filename: name, destination: destination) }
                }
                .fixedSize()
                Button("Scan with scanner…", systemImage: "scanner") { model.showScanner = true }
            }
            .disabled(model.company == nil)
            Divider()
            Toggle("Watch company inboxes", isOn: Binding(get: { model.watching }, set: { enabled in
                Task { await model.setWatching(enabled) }
            })).disabled(model.company == nil)
            Text("Files added to this company’s Inbox folders upload automatically while the app is running.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Button("Open in Finder", systemImage: "folder") { Task { await model.showFolder() } }
                .disabled(model.company == nil)
            Button("Manage watched folders…", systemImage: "folder.badge.gearshape") { showWatchedFolders = true }
                .disabled(model.company == nil)
            Spacer()
            Label(model.paused ? "Uploads paused" : "Uploads active", systemImage: model.paused ? "pause.circle" : "checkmark.circle")
                .font(.caption).foregroundStyle(.secondary)
            SettingsLink { Text("Settings") }
        }
    }

    private var uploads: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                VStack(alignment: .leading, spacing: 5) {
                    Text(model.company?.companyName ?? "Choose a company").font(.title.bold())
                    Text("Scan, capture and upload documents to ReAI.").foregroundStyle(.secondary)
                }
                Spacer()
                Button(model.paused ? "Resume" : "Pause", systemImage: model.paused ? "play" : "pause") {
                    model.paused.toggle(); model.runQueue()
                }
            }
            if let notice = model.migrationNotice {
                HStack(alignment: .top) {
                    Label(notice, systemImage: "arrow.right.doc.on.clipboard").font(.callout).fixedSize(horizontal: false, vertical: true)
                    Spacer()
                    if model.migrationBlocked {
                        Button("Move Finder Vault setup") { Task { await model.retryMigration() } }
                    } else {
                        Button("Dismiss") { model.migrationNotice = nil }
                    }
                }
                .padding(12).background(.teal.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
            }
            VStack(spacing: 10) {
                Image(systemName: "tray.and.arrow.down").font(.system(size: 32, weight: .light)).foregroundStyle(.teal)
                Text("Drop files into \(model.destination.rawValue.lowercased())").font(.headline)
                Text(model.destination.explanation)
                    .font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                Button("Choose files…") { model.chooseFiles() }.buttonStyle(.borderedProminent).tint(.teal)
            }
            .frame(maxWidth: .infinity).padding(25)
            .background(.teal.opacity(targeted ? 0.13 : 0.05), in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(.teal.opacity(0.25), style: StrokeStyle(lineWidth: 1, dash: [5])))
            .disabled(model.company == nil)
            .dropDestination(for: URL.self) { urls, _ in
                guard model.company != nil else { return false }
                Task { await model.add(urls) }; return true
            } isTargeted: { targeted = $0 }
            HStack {
                Text("Recent uploads").font(.headline)
                Spacer()
                Button("Scan inboxes", systemImage: "arrow.clockwise") { Task { await model.scan() } }.disabled(model.company == nil)
            }
            TextField("Find an upload", text: $search).textFieldStyle(.roundedBorder)
            if let notice = model.uploadNotice {
                HStack(alignment: .top) {
                    Label(notice, systemImage: "doc.on.doc").font(.caption).textSelection(.enabled)
                    Spacer()
                    Button("Dismiss") { model.uploadNotice = nil }
                }
            }
            if let error = model.error {
                HStack {
                    Text(error).font(.caption).foregroundStyle(.red).textSelection(.enabled)
                    Spacer()
                    Button("Dismiss") { model.error = nil }
                }
            }
            List(model.visibleTransfers.filter { search.isEmpty || $0.filename.localizedCaseInsensitiveContains(search) }) { transfer in
                HStack(spacing: 12) {
                    Image(systemName: TransferRow.symbol(transfer.status)).foregroundStyle(TransferRow.tint(transfer.status))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(transfer.filename).lineLimit(1)
                        Text(transfer.detail.isEmpty ? transfer.destination.rawValue : transfer.detail)
                            .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    }
                    Spacer()
                    if transfer.status == TransferStatus.uploading { ProgressView().controlSize(.small) }
                    Text(transfer.status).font(.caption).foregroundStyle(.secondary)
                }
                .padding(.vertical, 5)
                .contextMenu {
                    Button("Show local copy in Finder") { NSWorkspace.shared.activateFileViewerSelecting([transfer.file]) }
                    if transfer.status == TransferStatus.checkReAI { Button("Retry upload…") { retryID = transfer.id } }
                    if transfer.status == TransferStatus.rejected { Button("Retry upload") { Task { await model.retry(transfer.id) } } }
                }
            }
            .listStyle(.plain)
            .frame(minHeight: 100, maxHeight: .infinity)
            .overlay {
                if model.visibleTransfers.isEmpty {
                    ContentUnavailableView("No uploads yet", systemImage: "doc", description: Text("Drop a file, capture a receipt or scan a document."))
                }
            }
            Text("Originals stay untouched · Maximum 20 MB per file · Local copies available in Finder")
                .font(.caption).foregroundStyle(.tertiary)
        }
    }
}
