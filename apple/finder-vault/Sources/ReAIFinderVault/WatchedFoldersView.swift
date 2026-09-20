import SwiftUI
import AppKit

struct WatchedFoldersView: View {
    @Bindable var model: VaultModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                VStack(alignment: .leading, spacing: 5) {
                    Text("Watched folders").font(.title2.bold())
                    Text(model.company?.companyName ?? "Choose a company").foregroundStyle(.secondary)
                }
                Spacer()
                Button("Done") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            Text("Link a folder to this company and a destination. Only folders for the connected company and account are watched.")
                .fixedSize(horizontal: false, vertical: true)
            HStack {
                Picker("Destination for new folder", selection: $model.destination) {
                    ForEach(Destination.allCases) { Text($0.rawValue).tag($0) }
                }
                Button("Choose folder…") { model.chooseWatchedFolder() }
                    .buttonStyle(.borderedProminent).disabled(model.company == nil)
            }
            Text("Existing files are skipped. New or changed files upload automatically while ReAI Vault is open. Only files directly inside the folder are watched; add subfolders separately.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    ForEach(model.visibleWatchedFolders) { folder in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Toggle(isOn: Binding(get: { folder.enabled }, set: { enabled in
                                    Task { await model.setFolderEnabled(folder.id, enabled) }
                                })) { Text(URL(fileURLWithPath: folder.path).lastPathComponent).font(.headline) }
                                Spacer()
                                Text(folder.destination.rawValue).font(.caption).foregroundStyle(.secondary)
                            }
                            Text(folder.path).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                            Text(model.folderStatus[folder.id] ?? (folder.enabled ? "Starting…" : "Paused"))
                                .font(.caption).foregroundStyle(.secondary)
                            HStack {
                                Button("Open folder") { NSWorkspace.shared.open(URL(fileURLWithPath: folder.path)) }
                                Button("Scan") { model.scheduleFolderScan(folder.id) }.disabled(!folder.enabled)
                                Spacer()
                                Button("Remove", role: .destructive) { Task { await model.removeFolder(folder.id) } }
                            }
                        }.padding(14).background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 10))
                    }
                    if model.visibleWatchedFolders.isEmpty {
                        Text("No custom folders for this company yet.").foregroundStyle(.secondary).padding(.vertical, 25)
                    }
                }
            }
            if let error = model.error { Text(error).font(.caption).foregroundStyle(.red).textSelection(.enabled) }
            Text("Removing a mapping stops watching. It never deletes files or cancels uploads already queued. Pause in the main window pauses uploads for all folders.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }.padding(24).frame(width: 650, height: 540)
    }
}
