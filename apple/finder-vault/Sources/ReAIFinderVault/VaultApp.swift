import SwiftUI
import AppKit

@main
struct VaultApp: App {
    @State private var model = VaultModel()
    var body: some Scene {
        WindowGroup(VaultEnvironment.appName, id: "vault") {
            GeometryReader { geometry in
                VaultView(model: model, availableHeight: geometry.size.height)
                    .frame(width: geometry.size.width, height: geometry.size.height)
            }
                .frame(minWidth: 780, minHeight: 620)
                .task { await model.start() }
        }
        .defaultSize(width: 960, height: 650)
        Settings { ConnectionView(model: model).frame(width: 440).padding(28) }
        MenuBarExtra(VaultEnvironment.vaultFolder, systemImage: model.pending > 0 ? "tray.and.arrow.up.fill" : "tray.2.fill") {
            MenuContent(model: model)
        }
    }
}

struct MenuContent: View {
    @Bindable var model: VaultModel
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        Text(model.uploadStatus)
        Button("Open ReAI Finder Vault") { openWindow(id: "vault"); NSApp.activate() }
        Button("Show folder in Finder") { Task { await model.showFolder() } }.disabled(model.company == nil)
        Divider()
        Button(model.paused ? "Resume uploads" : "Pause uploads") {
            model.paused.toggle()
            model.runQueue()
        }
        SettingsLink()
        Divider()
        Button("Quit ReAI Finder Vault") { NSApp.terminate(nil) }.keyboardShortcut("q")
    }
}

struct ConnectionView: View {
    @Bindable var model: VaultModel
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Image(systemName: "externaldrive.badge.icloud").font(.system(size: 38)).foregroundStyle(.teal)
            Text("Connect to ReAI").font(.title2.bold())
            if VaultEnvironment.isLocal {
                Label("LOCAL TEST · localhost:18087", systemImage: "hammer.fill")
                    .font(.callout.bold()).foregroundStyle(.orange)
            }
            Text("Connect your ReAI account to upload documents from Finder. Your access token stays in macOS Keychain.")
                .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if model.connected {
                Label(model.email, systemImage: "checkmark.shield.fill")
                Button("Disconnect", role: .destructive) { model.disconnect() }
                Text("Disconnect removes the key from this Mac. To revoke access on the server, remove the key in your ReAI profile.")
                    .font(.caption).foregroundStyle(.secondary)
                Link("Manage access in ReAI ↗", destination: VaultEnvironment.profileURL)
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

struct VaultView: View {
    @Bindable var model: VaultModel
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
                    VStack(alignment: .leading, spacing: 22) {
                        Label(VaultEnvironment.vaultFolder, systemImage: "tray.2.fill").font(.title2.bold()).foregroundStyle(.teal)
                        if VaultEnvironment.isLocal {
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
                        Toggle("Watch company inboxes", isOn: Binding(get: { model.watching }, set: { enabled in
                            Task { await model.setWatching(enabled) }
                        })).disabled(model.company == nil)
                        Text("Files added to this company’s Inbox folders upload automatically while the app is open.")
                            .font(.caption).foregroundStyle(.secondary)
                        Button("Open in Finder", systemImage: "folder") { Task { await model.showFolder() } }
                            .disabled(model.company == nil)
                        Button("Manage watched folders…", systemImage: "folder.badge.gearshape") { showWatchedFolders = true }
                            .disabled(model.company == nil)
                        Spacer()
                        Label(model.paused ? "Uploads paused" : "Uploads active", systemImage: model.paused ? "pause.circle" : "checkmark.circle")
                            .font(.caption).foregroundStyle(.secondary)
                        SettingsLink { Text("Account settings") }
                    }.padding(20)
                        .frame(minWidth: 240, idealWidth: 260, maxWidth: 300, alignment: .topLeading)
                        .frame(height: availableHeight, alignment: .topLeading)
                    VStack(alignment: .leading, spacing: 20) {
                        HStack {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(model.company?.companyName ?? "Choose a company").font(.title.bold())
                                Text("Upload documents to ReAI.").foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button(model.paused ? "Resume" : "Pause", systemImage: model.paused ? "play" : "pause") {
                                model.paused.toggle(); model.runQueue()
                            }
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
                                Image(systemName: transfer.status == "Uploaded" ? "checkmark.circle.fill" : transfer.status == "Duplicate skipped" ? "doc.on.doc" : "doc.text")
                                    .foregroundStyle(transfer.status == "Uploaded" ? .teal : .secondary)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(transfer.filename).lineLimit(1)
                                    Text(transfer.detail.isEmpty ? transfer.destination.rawValue : transfer.detail)
                                        .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                }
                                Spacer()
                                if transfer.status == "Uploading" { ProgressView().controlSize(.small) }
                                Text(transfer.status).font(.caption).foregroundStyle(.secondary)
                            }
                            .padding(.vertical, 5)
                            .contextMenu {
                                Button("Show local copy in Finder") { NSWorkspace.shared.activateFileViewerSelecting([transfer.file]) }
                                if transfer.status == "Check ReAI" { Button("Retry upload…") { retryID = transfer.id } }
                            }
                        }
                        .listStyle(.plain)
                        .frame(minHeight: 100, maxHeight: .infinity)
                        .overlay {
                            if model.visibleTransfers.isEmpty {
                                ContentUnavailableView("No uploads yet", systemImage: "doc", description: Text("Upload a file or open your company’s inbox in Finder."))
                            }
                        }
                        Text("Originals stay untouched · Maximum 20 MB per file · Local copies available in Finder")
                            .font(.caption).foregroundStyle(.tertiary)
                    }.padding(28).frame(maxWidth: .infinity, alignment: .topLeading)
                        .frame(height: availableHeight, alignment: .topLeading)
                }
            }
        }
        .sheet(isPresented: $showWatchedFolders) { WatchedFoldersView(model: model) }
        .alert("Retry this upload?", isPresented: Binding(get: { retryID != nil }, set: { if !$0 { retryID = nil } })) {
            Button("Cancel", role: .cancel) { retryID = nil }
            Button("I checked ReAI — retry") { if let id = retryID { Task { await model.retry(id) } }; retryID = nil }
        } message: { Text("Check whether the document already exists in ReAI. Retrying an upload that was accepted can create a duplicate.") }
    }
}
