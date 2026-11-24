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
    private static let serverPreference = "reaiServerURL"

    private(set) var server: ReAIServer
    private var api: ReAIAPI
    let recMan = RecManAPI()
    let recManCredentials = Credentials(account: "recman-read-only-key")
    var hasRecManKey = false
    var company: Company?
    var scope = AccountingScope.employees
    var sourceDate = Date.now
    var confirmedNOK = false
    var preview: ImportPreview?
    var invoiceBatch: InvoiceBatch?
    var payrollBatch: PayrollBatch?
    var payrollIssue: String?
    var reviewedEmployeeIDs: Set<Int> = []
    var selectedAccountingIDs: Set<String> = []
    var mappingChoices: [String: String] = [:]
    var selectedEmployeeIDs: Set<Int> = []
    var approvalCode: String?
    var isBusy = false
    var message: String?
    var importFeedback: ImportFeedback?
    var hasError = false
    private var token: String?
    private var action: Task<Void, Never>?

    private var credentials: Credentials { Credentials(account: server.credentialAccount) }

    init() {
        let savedURL = UserDefaults.standard.string(forKey: Self.serverPreference)
        let server = savedURL.flatMap { try? ReAIServer($0) } ?? .localDefault
        self.server = server
        api = ReAIAPI(server: server)
    }

    func restore() {
        run {
            self.hasRecManKey = try await self.recManCredentials.load() != nil
            try await self.restoreConnection()
        }
    }

    private func restoreConnection() async throws {
        guard let saved = try await credentials.load() else { return }
        try await use(saved)
    }

    func setReAIServer(_ value: String) throws {
        guard !isBusy else { throw appError("Wait for the current operation to finish.") }
        let next = try ReAIServer(value)
        guard next != server else { return }

        clearPreview()
        confirmedNOK = false
        importFeedback = nil
        token = nil
        company = nil
        server = next
        api = ReAIAPI(server: next)
        UserDefaults.standard.set(next.url.absoluteString, forKey: Self.serverPreference)
        run { try await self.restoreConnection() }
    }

    func connect() {
        run {
            let token = try await Connection(server: self.server).authorize { code in
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
            throw appError("Approve one company on the selected ReAI server.")
        }
        self.token = token
        company = approved
    }

    private func importer() throws -> RecManImport {
        guard let token, let company else { throw appError("Connect to ReAI first.") }
        return RecManImport(api: api, token: token, tenant: company)
    }

    func clearPreview() {
        preview = nil
        invoiceBatch = nil
        selectedAccountingIDs = []
        resetPayrollReview()
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
            self.confirmedNOK = false
            self.clearPreview()
            self.message = "RecMan key saved."
        }
    }

    private func sourceKey() async throws -> String {
        guard let key = try await recManCredentials.load() else {
            hasRecManKey = false
            throw appError("Set the RecMan API key first.")
        }
        return key
    }

    private func accountingTarget() throws -> AccountingTarget {
        guard let token, let company else { throw appError("Connect to ReAI first.") }
        return AccountingTarget(api: api, tenant: company, token: token)
    }

    func testRecMan() {
        run {
            let key = try await self.sourceKey()
            self.message = try await self.recMan.health(key: key)
        }
    }

    func load() {
        guard !isBusy else { return }
        clearPreview()
        run {
            let key = try await self.sourceKey()
            switch self.scope {
            case .employees:
                let importer = try self.importer()
                let employees = try await self.recMan.employees(key: key)
                self.preview = try await importer.preview(employees: employees)
                if employees.isEmpty { self.message = "RecMan returned no employees." }
            case .invoices:
                let importer = InvoiceImport(source: self.recMan, key: key, target: try self.accountingTarget())
                let batch = try await importer.load(from: osloDate(self.sourceDate))
                self.invoiceBatch = batch
                for mapping in batch.mappings { self.mappingChoices[mapping.id] = mapping.suggestion }
                if batch.rows.isEmpty { self.message = "No new records for this date selection." }
            }
        }
    }

    func updateEmployeeSelection(_ ids: Set<Int>) {
        selectedEmployeeIDs = ids
        resetPayrollReview()
    }

    private func resetPayrollReview() {
        payrollBatch = nil
        payrollIssue = nil
        reviewedEmployeeIDs = []
        mappingChoices = [:]
        if scope == .employees { confirmedNOK = false }
    }

    func reviewPayroll() {
        guard let preview, !isBusy, !selectedEmployeeIDs.isEmpty else { return }
        let ids = selectedEmployeeIDs
        resetPayrollReview()
        run {
            do {
                let key = try await self.sourceKey()
                let importer = PayrollImport(source: self.recMan, key: key, target: try self.accountingTarget())
                self.payrollBatch = try await importer.load(employeePreview: preview, selection: ids)
                if self.payrollBatch?.rows.isEmpty == true { self.message = "No new paychecks for the selected employees." }
            } catch {
                self.payrollIssue = error.localizedDescription
            }
            self.reviewedEmployeeIDs = ids
        }
    }

    var readyAccountingIDs: Set<String> {
        Set((invoiceBatch?.rows ?? []).filter { row in
            row.problem == nil && row.requirements.allSatisfy { mappingChoices[$0] != nil }
        }.map(\.id))
    }

    var payrollApproval: PayrollImportApproval? {
        payrollBatch?.approval(choices: mappingChoices, confirmedNOK: confirmedNOK)
    }

    var selectedEmployeeWriteCount: Int {
        guard let preview else { return 0 }
        let municipalities = payrollApproval?.employeeSetup ?? [:]
        return selectedEmployeeIDs.count { id in
            guard let plan = preview.plans[id] else { return false }
            return plan.existing?.employmentRelations.isEmpty != false ||
                plan.bankToImport != nil || municipalities[id] != nil
        }
    }

    var canApplyEmployees: Bool {
        !isBusy && !selectedEmployeeIDs.isEmpty && selectedEmployeeIDs == reviewedEmployeeIDs &&
            (selectedEmployeeWriteCount > 0 || payrollApproval?.rows.isEmpty == false)
    }

    var employeeImportButtonTitle: String {
        guard let approval = payrollApproval, !approval.rows.isEmpty else {
            return selectedEmployeeWriteCount > 0 ? "Save Employee Updates" : "Import Employees & Payroll"
        }
        return approval.heldCount == 0 ? "Import Employees & Payroll" : "Import Ready Records"
    }

    func changeMapping(_ id: String, choice: String?) {
        mappingChoices[id] = choice
        selectedAccountingIDs.formIntersection(readyAccountingIDs)
    }

    func applyAccounting() {
        let selection = selectedAccountingIDs
        guard !isBusy, confirmedNOK, let reviewed = invoiceBatch, !selection.isEmpty,
              selection.isSubset(of: readyAccountingIDs) else { return }
        let choices = mappingChoices
        run {
            do {
                let key = try await self.sourceKey()
                let target = try self.accountingTarget()
                let message = try await InvoiceImport(source: self.recMan, key: key, target: target)
                    .perform(reviewed, selection: selection, choices: choices)
                self.clearPreview()
                self.importFeedback = ImportFeedback(title: "Import Complete", message: message)
            } catch {
                self.clearPreview()
                self.importFeedback = ImportFeedback(title: "Import Incomplete", message: error.localizedDescription)
            }
        }
    }

    func apply() {
        guard let reviewed = preview, canApplyEmployees else { return }
        let selection = selectedEmployeeIDs
        let batch = payrollBatch
        let choices = mappingChoices
        let approval = payrollApproval
        let issue = payrollIssue
        clearPreview()
        run {
            let importer: RecManImport
            let result: EmployeeImportResult
            do {
                importer = try self.importer()
                result = try await importer.perform(reviewed, selectedEmployeeIDs: selection,
                                                    payrollSetup: approval?.employeeSetup ?? [:])
            } catch {
                self.importFeedback = ImportFeedback(title: "Employee Import Failed", message: error.localizedDescription)
                return
            }

            var summary = [result.message]
            var payrollFailed = false
            if let batch, let approval {
                if !approval.rows.isEmpty {
                    do {
                        let key = try await self.sourceKey()
                        let payroll = PayrollImport(source: self.recMan, key: key, target: try self.accountingTarget())
                        summary.append(try await payroll.perform(batch, approval: approval, choices: choices,
                                                                 employees: result.employees))
                    } catch {
                        payrollFailed = true
                        summary.append("Payroll import incomplete. \(error.localizedDescription)")
                    }
                }
                if approval.heldCount > 0 {
                    summary.append("Held \(approval.heldCount) paychecks for review.")
                }
            } else if let issue {
                summary.append("Payroll could not be reviewed. \(issue)")
            }
            self.importFeedback = ImportFeedback(title: payrollFailed ? "Employees Imported · Payroll Incomplete" : "Import Result",
                                                 message: summary.filter { !$0.isEmpty }.joined(separator: "\n\n"))
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
    @ViewState private var editingReAIServer = false
    @ViewState private var reaiURLInput = ""
    @ViewState private var reaiURLError: String?
    @ViewState private var editingRecManKey = false
    @ViewState private var recManKeyInput = ""

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            employeeControls
            Divider()
            if let preview = model.preview {
                if let payroll = model.payrollBatch, !payroll.rows.isEmpty {
                    VSplitView {
                        previewList(preview).frame(minHeight: 95, idealHeight: 115)
                        accountingPreview(rows: payroll.rows, mappings: payroll.mappings, isPayroll: true)
                            .frame(minHeight: 210)
                    }
                } else {
                    previewList(preview)
                }
            } else if let batch = model.invoiceBatch {
                accountingPreview(rows: batch.rows, mappings: batch.mappings, isPayroll: false)
            } else {
                ContentUnavailableView {
                    Label(model.scope.rawValue, systemImage: model.scope == .employees ? "person.2" : "doc.text")
                } description: {
                    if model.company == nil {
                        Text("Set the ReAI URL and connect to a company.")
                    } else if !model.hasRecManKey {
                        Text("Set the read-only RecMan API key.")
                    } else {
                        Text("Load records from RecMan to review before importing.")
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            Divider()
            footer
        }
        .task { model.restore() }
        .sheet(isPresented: $editingReAIServer) {
            VStack(alignment: .leading, spacing: 16) {
                Text("ReAI URL").font(.title2.bold())
                TextField("ReAI root URL", text: $reaiURLInput, prompt: Text("http://localhost:8080"))
                    .onChange(of: reaiURLInput) { reaiURLError = nil }
                HStack {
                    Button("Use Localhost") { reaiURLInput = ReAIServer.localDefault.url.absoluteString }
                    Button("Use Production") { reaiURLInput = "https://app.reai.no" }
                }
                if let reaiURLError {
                    Text(reaiURLError).foregroundStyle(.red)
                }
                HStack {
                    Spacer()
                    Button("Cancel", role: .cancel) { editingReAIServer = false }
                        .keyboardShortcut(.cancelAction)
                    Button("Save URL") {
                        do {
                            try model.setReAIServer(reaiURLInput)
                            editingReAIServer = false
                        } catch {
                            reaiURLError = error.localizedDescription
                        }
                    }
                    .keyboardShortcut(.defaultAction)
                }
            }
            .padding(24)
            .frame(width: 440)
        }
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
                if let company = model.company {
                    Text(company.companyName).fontWeight(.medium)
                }
                Text(model.server.displayName)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
            Spacer()
            Button("ReAI URL…") {
                reaiURLInput = model.server.url.absoluteString
                reaiURLError = nil
                editingReAIServer = true
            }
            .disabled(model.isBusy)
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
        @Bindable var model = model
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Picker("Import", selection: $model.scope) {
                    ForEach(AccountingScope.allCases, id: \.self) { scope in
                        Text(scope.rawValue).tag(scope)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .fixedSize()
                .onChange(of: model.scope) {
                    model.confirmedNOK = false
                    model.clearPreview()
                }
                Spacer()
                Button(model.hasRecManKey ? "Change RecMan Key…" : "Set RecMan Key…") {
                    editingRecManKey = true
                }
                Button("Test RecMan") { model.testRecMan() }.disabled(!model.hasRecManKey)
                Button(model.scope == .employees ? "Load Employees" : "Load Records") { model.load() }
                    .disabled(model.company == nil || !model.hasRecManKey)
            }
            if model.scope == .invoices {
                HStack {
                    DatePicker("On or after", selection: $model.sourceDate, displayedComponents: .date)
                        .fixedSize()
                        .onChange(of: model.sourceDate) { model.clearPreview() }
                    Spacer()
                    Toggle("RecMan amounts are in NOK", isOn: $model.confirmedNOK)
                        .toggleStyle(.checkbox)
                }
            }
            if let preview = model.preview {
                HStack {
                    Button("Select All") { model.updateEmployeeSelection(preview.selectableEmployeeIDs) }
                        .disabled(model.selectedEmployeeIDs == preview.selectableEmployeeIDs)
                    Button("Select None") { model.updateEmployeeSelection([]) }
                        .disabled(model.selectedEmployeeIDs.isEmpty)
                    Spacer()
                    Button("Review Import") { model.reviewPayroll() }
                        .disabled(model.selectedEmployeeIDs.isEmpty || model.selectedEmployeeIDs == model.reviewedEmployeeIDs && model.payrollIssue == nil)
                }
                if let payroll = model.payrollBatch, !payroll.rows.isEmpty,
                   let approval = model.payrollApproval {
                    payrollReviewControls(payroll, approval: approval)
                }
                if let issue = model.payrollIssue {
                    Text("Payroll could not be reviewed. \(issue)").font(.callout).foregroundStyle(.orange)
                }
            } else if model.invoiceBatch != nil {
                HStack {
                    Button("Select All Ready") { model.selectedAccountingIDs = model.readyAccountingIDs }
                        .disabled(model.selectedAccountingIDs == model.readyAccountingIDs)
                    Button("Select None") { model.selectedAccountingIDs.removeAll() }
                        .disabled(model.selectedAccountingIDs.isEmpty)
                }
            }
        }
        .disabled(model.isBusy)
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
    }

    private func payrollReviewControls(_ batch: PayrollBatch, approval: PayrollImportApproval) -> some View {
        @Bindable var model = model
        let required = Set(batch.rows.filter { $0.problem == nil }.flatMap(\.requirements))
        let unconfirmedMunicipalities = batch.mappings.filter {
            ($0.municipalityInput || required.contains($0.id) && $0.id.hasPrefix("municipality-")) &&
                !$0.accepts(model.mappingChoices[$0.id])
        }
        let unmappedWageCount = batch.mappings.count {
            required.contains($0.id) && $0.id.hasPrefix("wage-") && !$0.accepts(model.mappingChoices[$0.id])
        }
        let suggested = unconfirmedMunicipalities.filter {
            $0.municipalitySuggestion != nil && model.mappingChoices[$0.id] == nil
        }
        let sharedSuggestion = Set(suggested.compactMap { $0.municipalitySuggestion?.id }).count == 1
            ? suggested.first?.municipalitySuggestion : nil
        let steps = [
            unconfirmedMunicipalities.isEmpty ? nil : "\(unconfirmedMunicipalities.count) municipality confirmations needed",
            unmappedWageCount == 0 ? nil : "\(unmappedWageCount) wage types to map"
        ].compactMap { $0 }

        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("\(approval.rows.count) paychecks ready · \(approval.heldCount) held")
                    .fontWeight(.medium)
                Spacer()
                Toggle("Payroll amounts are in NOK", isOn: $model.confirmedNOK)
                    .toggleStyle(.checkbox)
            }
            if !steps.isEmpty {
                Text(steps.joined(separator: " · ")).foregroundStyle(.secondary)
            }
            if let suggestion = sharedSuggestion {
                let count = suggested.count == 1 ? "1 employee" : "\(suggested.count) employees"
                Button("Confirm \(suggestion.label) for \(count)") {
                    for mapping in suggested { model.changeMapping(mapping.id, choice: suggestion.id) }
                }
            }
        }
        .font(.callout)
        .accessibilityElement(children: .contain)
    }

    private func accountingPreview(rows: [AccountingRow], mappings: [AccountingMapping], isPayroll: Bool) -> some View {
        let ready = isPayroll ? Set(model.payrollApproval?.rows.map(\.id) ?? []) : model.readyAccountingIDs
        return HSplitView {
            List {
                Section(isPayroll ? "Payroll for selected employees" : "Records") {
                    ForEach(rows) { row in
                        HStack(alignment: .top, spacing: 10) {
                            if !isPayroll {
                                Toggle(row.title, isOn: Binding {
                                    model.selectedAccountingIDs.contains(row.id)
                                } set: { selected in
                                    if selected { model.selectedAccountingIDs.insert(row.id) }
                                    else { model.selectedAccountingIDs.remove(row.id) }
                                })
                                .toggleStyle(.checkbox)
                                .labelsHidden()
                                .disabled(!ready.contains(row.id) || model.isBusy)
                            }
                            VStack(alignment: .leading, spacing: 4) {
                                Text(row.title).fontWeight(.medium)
                                Text(row.detail).foregroundStyle(.secondary)
                                if let problem = row.problem {
                                    Text(problem).foregroundStyle(.orange)
                                } else if isPayroll && !ready.contains(row.id) {
                                    let missing = row.requirements.filter { requirement in
                                        mappings.first(where: { $0.id == requirement })?.accepts(model.mappingChoices[requirement]) != true
                                    }
                                    let reasons = [
                                        model.confirmedNOK ? nil : "Confirm NOK",
                                        missing.contains { $0.hasPrefix("municipality-") } ? "Confirm municipality" : nil,
                                        missing.contains { $0.hasPrefix("wage-") } ? "Map wage types" : nil
                                    ].compactMap { $0 }
                                    Text(reasons.joined(separator: " · ")).foregroundStyle(.orange)
                                } else if !ready.contains(row.id) {
                                    Text("Mapping required").foregroundStyle(.orange)
                                } else if isPayroll {
                                    Text("Included in draft payroll").foregroundStyle(.secondary)
                                }
                                if !row.lineDetails.isEmpty {
                                    DisclosureGroup("\(row.lineDetails.count) lines") {
                                        ForEach(row.lineDetails.indices, id: \.self) { index in
                                            Text(row.lineDetails[index])
                                                .foregroundStyle(.secondary)
                                                .frame(maxWidth: .infinity, alignment: .leading)
                                        }
                                    }
                                }
                            }
                            .font(.callout)
                        }
                        .padding(.vertical, 4)
                    }
                }
            }
            .frame(minWidth: 300)
            List {
                if isPayroll {
                    Section("Workplace Municipalities") {
                        ForEach(mappings.filter { $0.id.hasPrefix("municipality-") }) { mapping in
                            mappingRow(mapping, isPayroll: true)
                        }
                    }
                }
                Section(isPayroll ? "Wage Types" : "Mappings") {
                    ForEach(mappings.filter { !isPayroll || !$0.id.hasPrefix("municipality-") }) { mapping in
                        mappingRow(mapping, isPayroll: isPayroll)
                    }
                }
            }
            .frame(minWidth: 315)
        }
    }

    private func mappingRow(_ mapping: AccountingMapping, isPayroll: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(mapping.label).fontWeight(.medium)
            if mapping.municipalityInput {
                if let suggestion = mapping.municipalitySuggestion {
                    Button("Confirm \(suggestion.label)") {
                        model.changeMapping(mapping.id, choice: suggestion.id)
                    }
                    .buttonStyle(.borderless)
                    .disabled(model.isBusy || model.mappingChoices[mapping.id] == suggestion.id)
                }
                TextField("Four-digit municipality code", text: Binding {
                    model.mappingChoices[mapping.id] ?? ""
                } set: { choice in
                    model.changeMapping(mapping.id, choice: choice.isEmpty ? nil : choice)
                })
                .disabled(model.isBusy)
            } else {
                Picker(mapping.label, selection: Binding {
                    model.mappingChoices[mapping.id]
                } set: { choice in
                    model.changeMapping(mapping.id, choice: choice)
                }) {
                    Text(isPayroll ? "Choose an option" : "Choose a mapping").tag(nil as String?)
                    ForEach(mapping.options) { option in Text(option.label).tag(Optional(option.id)) }
                }
                .labelsHidden()
                .disabled(mapping.options.isEmpty || model.isBusy)
                if mapping.options.isEmpty && !isPayroll {
                    Text("No compatible ReAI record. Update ReAI and reload.").foregroundStyle(.secondary)
                }
            }
        }
        .font(.callout)
        .padding(.vertical, 4)
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
            var ids = model.selectedEmployeeIDs
            if selected { ids.insert(id) }
            else { ids.remove(id) }
            model.updateEmployeeSelection(ids)
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
        if model.scope == .invoices {
            let count = model.selectedAccountingIDs.count
            return "\(model.server.displayName)\n\nBook \(count) selected issued documents in NOK."
        }
        let names = model.preview?.employeeRows.compactMap { row -> String? in
            guard model.selectedEmployeeIDs.contains(row.id) else { return nil }
            return row.title
        }.joined(separator: ", ") ?? ""
        let bankCount = model.preview?.plans.filter { model.selectedEmployeeIDs.contains($0.key) && $0.value.bankToImport != nil }.count ?? 0
        let bank = bankCount == 0 ? "" : "\nFill \(bankCount) blank bank accounts from RecMan."
        let municipalityCount = model.payrollApproval?.employeeSetup.count ?? 0
        let municipality = municipalityCount == 0 ? "" : "\nSave \(municipalityCount) confirmed municipalities."
        let ready = model.payrollApproval?.rows.count ?? 0
        let held = model.payrollApproval?.heldCount ?? 0
        let payroll = model.payrollIssue == nil
            ? "\(ready) paychecks will be added to draft payroll. \(held) held for review."
            : "Payroll could not be reviewed and will be held."
        let employeeUpdates = model.selectedEmployeeWriteCount
        return """
            \(model.server.displayName)

            Review for \(names). \(employeeUpdates) employee records will be updated. \(payroll)\(bank)\(municipality)
            For new employment relations, ReAI applies its defaults to fields left unset.
            """
    }

    private var footer: some View {
        HStack {
            if model.isBusy { ProgressView().controlSize(.small) }
            if let message = model.message {
                Text(message)
                    .foregroundStyle(model.hasError ? Color.red : Color.secondary)
                    .textSelection(.enabled)
            } else {
                Text("Live RecMan").foregroundStyle(.secondary)
            }
            Spacer()
            Button(model.scope == .employees ? "\(model.employeeImportButtonTitle)…" : "Import Selected Records…") {
                confirmImport = true
            }
            .buttonStyle(.borderedProminent)
            .disabled(model.isBusy || (model.scope == .employees
                ? !model.canApplyEmployees
                : model.invoiceBatch == nil || model.selectedAccountingIDs.isEmpty || !model.confirmedNOK))
            .confirmationDialog("Save to \(model.company?.companyName ?? "ReAI")?",
                                isPresented: $confirmImport, titleVisibility: .visible) {
                Button(model.scope == .employees ? model.employeeImportButtonTitle : "Import") {
                    if model.scope == .employees { model.apply() }
                    else { model.applyAccounting() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text(confirmationMessage)
            }
        }
        .padding(16)
    }
}
