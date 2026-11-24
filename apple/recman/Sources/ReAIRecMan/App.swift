import Observation
import SwiftUI

private typealias ViewState<Value> = SwiftUI.State<Value>

@main
struct RecManApp: App {
    var body: some Scene {
        Window("ReAI RecMan", id: "recman") {
            ImportView()
                .frame(minWidth: 760, minHeight: 575)
        }
        .defaultSize(width: 860, height: 685)
    }
}

@MainActor @Observable
private final class ImportModel {
    let api = ReAIAPI()
    let credentials = Credentials()
    var company: Company?
    var preview: ImportPreview?
    var selectedEmployeeIDs: Set<Int> = []
    var approvalCode: String?
    var isBusy = false
    var message: String?
    var hasError = false
    private var token: String?
    private var action: Task<Void, Never>?

    func restore() {
        run {
            guard let saved = try await self.credentials.load() else { return }
            try await self.use(saved)
        }
    }

    func connect() {
        run {
            let token = try await Connection().authorize { code in
                await self.showApproval(code)
            }
            try await self.use(token)
            try await self.credentials.save(token)
        }
    }

    private func showApproval(_ code: String) {
        approvalCode = code
    }

    func cancelConnection() { action?.cancel() }

    func disconnect() {
        run {
            try await self.credentials.delete()
            self.token = nil
            self.company = nil
            self.clearPreview()
        }
    }

    private func use(_ token: String) async throws {
        let account = try await api.account(token: token)
        guard account.tenants.count == 1, let approved = account.tenants.first else {
            throw appError("Approve one disposable company in localhost ReAI.")
        }
        self.token = token
        company = approved
    }

    private func importer() throws -> RecManImport {
        guard let token, let company else { throw appError("Connect to localhost ReAI first.") }
        return RecManImport(api: api, token: token, tenant: company, demo: Demo(date: .now))
    }

    private func clearPreview() {
        preview = nil
        selectedEmployeeIDs = []
        message = nil
        hasError = false
    }

    func load() {
        clearPreview()
        run { self.preview = try await self.importer().preview(scope: .employees) }
    }

    func apply() {
        guard let reviewed = preview, !selectedEmployeeIDs.isEmpty else { return }
        let selection = selectedEmployeeIDs
        clearPreview()
        run {
            let importer = try self.importer()
            try await importer.perform(reviewed, selectedEmployeeIDs: selection)
            self.preview = try await importer.preview(scope: .employees)
            self.message = "Selected employee records verified in localhost ReAI."
        }
    }

    private func run(_ operation: @escaping @MainActor () async throws -> Void) {
        guard !isBusy else { return }
        isBusy = true
        message = nil
        hasError = false
        action = Task {
            defer {
                approvalCode = nil
                action = nil
                isBusy = false
            }
            do {
                try await operation()
            } catch is CancellationError {
                message = "Connection cancelled."
            } catch {
                hasError = true
                message = error.localizedDescription
            }
        }
    }
}

private struct ImportView: View {
    @ViewState private var model = ImportModel()
    @ViewState private var confirmImport = false

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            sampleControls
            Divider()
            if let preview = model.preview {
                previewList(preview)
            } else {
                ContentUnavailableView {
                    Label("Synthetic RecMan sample", systemImage: "tray.and.arrow.down")
                } description: {
                    Text(model.company == nil
                         ? "Connect to a disposable ReAI company at localhost:8080."
                         : "Load the sample to choose which employees to import.")
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            Divider()
            footer
        }
        .task { model.restore() }
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 5) {
                Text("ReAI RecMan").font(.title2.bold())
                Text(model.company?.companyName ?? "Local proof of concept")
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if let code = model.approvalCode {
                Text(code).font(.body.monospaced()).textSelection(.enabled)
                Button("Cancel Connection") { model.cancelConnection() }
            } else if model.company == nil {
                Button("Connect to ReAI") { model.connect() }
                    .buttonStyle(.borderedProminent)
                    .disabled(model.isBusy)
            } else {
                Button("Disconnect") { model.disconnect() }.disabled(model.isBusy)
            }
        }
        .padding(20)
    }

    private var sampleControls: some View {
        HStack {
            if let preview = model.preview {
                Button("Select All") {
                    model.selectedEmployeeIDs = preview.selectableEmployeeIDs
                }
                .disabled(model.selectedEmployeeIDs == preview.selectableEmployeeIDs)

                Button("Select None") {
                    model.selectedEmployeeIDs.removeAll()
                }
                .disabled(model.selectedEmployeeIDs.isEmpty)
            }
            Spacer()
            Button("Load Sample") { model.load() }.disabled(model.company == nil)
        }
        .disabled(model.isBusy)
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
    }

    private func previewList(_ preview: ImportPreview) -> some View {
        List {
            Section("Employees") {
                ForEach(preview.employeeRows) { row in
                    if let candidateID = row.candidateID {
                        HStack(spacing: 12) {
                            Toggle(row.title, isOn: employeeSelection(candidateID))
                                .toggleStyle(.checkbox)
                                .labelsHidden()
                                .disabled(row.needsReview || model.isBusy)
                            previewRow(row)
                        }
                    }
                }
            }
        }
        .listStyle(.inset)
    }

    private func employeeSelection(_ id: Int) -> Binding<Bool> {
        Binding {
            model.selectedEmployeeIDs.contains(id)
        } set: { selected in
            if selected {
                model.selectedEmployeeIDs.insert(id)
            } else {
                model.selectedEmployeeIDs.remove(id)
            }
        }
    }

    private func previewRow(_ row: PreviewRow) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(row.title).fontWeight(.medium)
                Text(row.detail).font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 20)
            if row.needsReview {
                Label(row.action, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.orange)
            } else {
                Text(row.action).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 3)
        .frame(maxWidth: .infinity)
    }

    private var confirmationMessage: String {
        let names = model.preview?.employeeRows.compactMap { row -> String? in
            guard let id = row.candidateID, model.selectedEmployeeIDs.contains(id) else { return nil }
            return row.title
        }.joined(separator: ", ") ?? ""
        return "This imports \(names)."
    }

    private var footer: some View {
        HStack {
            if model.isBusy { ProgressView().controlSize(.small) }
            if let message = model.message {
                Text(message)
                    .foregroundStyle(model.hasError ? Color.red : Color.secondary)
                    .textSelection(.enabled)
            } else {
                Text("localhost:8080 · Synthetic data").foregroundStyle(.secondary)
            }
            Spacer()
            Button("Import Selected Employees…") {
                confirmImport = true
            }
            .buttonStyle(.borderedProminent)
            .disabled(model.preview == nil || model.selectedEmployeeIDs.isEmpty || model.isBusy)
            .confirmationDialog("Import into \(model.company?.companyName ?? "localhost ReAI")?",
                                isPresented: $confirmImport, titleVisibility: .visible) {
                Button("Import") { model.apply() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text(confirmationMessage)
            }
        }
        .padding(16)
    }
}
