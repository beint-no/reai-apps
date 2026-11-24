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

private struct ImportFeedback {
    let title: String
    let message: String
}

@MainActor @Observable
private final class ImportModel {
    let api = ReAIAPI()
    let recMan = RecManAPI()
    let credentials = Credentials()
    let recManCredentials = Credentials(account: "recman-read-only-key")
    var hasRecManKey = false
    var company: Company?
    var preview: ImportPreview?
    var selectedEmployeeIDs: Set<Int> = []
    var approvalCode: String?
    var isBusy = false
    var message: String?
    var importFeedback: ImportFeedback?
    var hasError = false
    private var token: String?
    private var action: Task<Void, Never>?

    func restore() {
        run {
            self.hasRecManKey = try await self.recManCredentials.load() != nil
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
        return RecManImport(api: api, token: token, tenant: company)
    }

    private func clearPreview() {
        preview = nil
        selectedEmployeeIDs = []
        message = nil
        hasError = false
    }

    func saveRecManKey(_ value: String) {
        let key = value.trimmingCharacters(in: .whitespacesAndNewlines)
        run {
            guard !key.isEmpty else { throw appError("Enter the RecMan API key.") }
            try await self.recManCredentials.save(key)
            self.hasRecManKey = true
            self.clearPreview()
            self.message = "RecMan key saved. Load Employees to connect."
        }
    }

    func load() {
        clearPreview()
        run {
            let importer = try self.importer()
            guard let key = try await self.recManCredentials.load() else {
                self.hasRecManKey = false
                throw appError("Set the RecMan API key first.")
            }
            let employees = try await self.recMan.employees(key: key)
            self.preview = try await importer.preview(employees: employees)
            if employees.isEmpty {
                self.message = "RecMan returned no employees."
            }
        }
    }

    func apply() {
        guard let reviewed = preview, !selectedEmployeeIDs.isEmpty else { return }
        let selection = selectedEmployeeIDs
        clearPreview()
        run {
            let importer: RecManImport
            do {
                importer = try self.importer()
                let result = try await importer.perform(reviewed, selectedEmployeeIDs: selection)
                self.importFeedback = ImportFeedback(
                    title: result.added.isEmpty ? "Employee Import Complete" : "Employees Added",
                    message: result.message
                )
            } catch {
                self.importFeedback = ImportFeedback(title: "Employee Import Failed", message: error.localizedDescription)
                return
            }
            self.preview = try await importer.preview(employees: reviewed.source)
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
    @ViewState private var editingRecManKey = false
    @ViewState private var recManKeyInput = ""

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            employeeControls
            Divider()
            if let preview = model.preview {
                previewList(preview)
            } else {
                ContentUnavailableView {
                    Label("RecMan employees", systemImage: "person.2")
                } description: {
                    if model.company == nil {
                        Text("Connect to a disposable ReAI company at localhost:8080.")
                    } else if !model.hasRecManKey {
                        Text("Set the read-only RecMan API key to load employees.")
                    } else {
                        Text("Load employees from RecMan and choose which records to import.")
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            Divider()
            footer
        }
        .task { model.restore() }
        .sheet(isPresented: $editingRecManKey, onDismiss: { recManKeyInput = "" }) {
            VStack(alignment: .leading, spacing: 16) {
                Text("RecMan API Key").font(.title2.bold())
                SecureField("Read-only API key", text: $recManKeyInput)
                HStack {
                    Spacer()
                    Button("Cancel", role: .cancel) { editingRecManKey = false }
                        .keyboardShortcut(.cancelAction)
                    Button("Save Key") {
                        model.saveRecManKey(recManKeyInput)
                        recManKeyInput = ""
                        editingRecManKey = false
                    }
                    .keyboardShortcut(.defaultAction)
                    .disabled(recManKeyInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .padding(24)
            .frame(width: 420)
        }
        .alert(model.importFeedback?.title ?? "", isPresented: isImportFeedbackPresented,
               presenting: model.importFeedback) { _ in
            Button("OK", role: .cancel) {}
        } message: { feedback in
            Text(feedback.message)
        }
    }

    private var isImportFeedbackPresented: Binding<Bool> {
        Binding {
            model.importFeedback != nil
        } set: { isPresented in
            if !isPresented { model.importFeedback = nil }
        }
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

    private var employeeControls: some View {
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
            Button(model.hasRecManKey ? "Change RecMan Key…" : "Set RecMan Key…") {
                editingRecManKey = true
            }
            Button("Load Employees") { model.load() }
                .disabled(model.company == nil || !model.hasRecManKey)
        }
        .disabled(model.isBusy)
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
    }

    private func previewList(_ preview: ImportPreview) -> some View {
        List {
            Section("Employees") {
                ForEach(preview.employeeRows) { row in
                    HStack(spacing: 12) {
                        Toggle(row.title, isOn: employeeSelection(row.id))
                            .toggleStyle(.checkbox)
                            .labelsHidden()
                            .disabled(row.needsReview || model.isBusy)
                        previewRow(row)
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
            guard model.selectedEmployeeIDs.contains(row.id) else { return nil }
            return row.title
        }.joined(separator: ", ") ?? ""
        return "This imports \(names). For new employment relations, ReAI applies its defaults to fields this import leaves unset."
    }

    private var footer: some View {
        HStack {
            if model.isBusy { ProgressView().controlSize(.small) }
            if let message = model.message {
                Text(message)
                    .foregroundStyle(model.hasError ? Color.red : Color.secondary)
                    .textSelection(.enabled)
            } else {
                Text("localhost:8080 · Live RecMan").foregroundStyle(.secondary)
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
