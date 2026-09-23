import SwiftUI

@main struct ReconcileApp: App {
    @State private var model = ReviewModel()
    var body: some Scene {
        Window("\(AppInfo.brand) → ReAI", id: "reconcile") {
            ReviewView(model: model).frame(minWidth: 760, minHeight: 620).task { await model.start() }
        }.defaultSize(width: 940, height: 720)
    }
}
struct ReviewView: View {
    @Bindable var model: ReviewModel
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack { Label("\(AppInfo.brand) → ReAI", systemImage: "arrow.left.arrow.right").font(.title.bold()); Spacer(); if model.busy { ProgressView() } }
            Text("Review payouts against ReAI bank transactions. Data is fetched only when you click Review.").foregroundStyle(.secondary)
            HStack(alignment: .top, spacing: 16) { providerBox; reaiBox }
            if let error = model.error { Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange).textSelection(.enabled) }
            if let notice = model.notice { Label(notice, systemImage: "info.circle").foregroundStyle(.secondary).textSelection(.enabled) }
            HStack {
                DatePicker("Month", selection: $model.month, displayedComponents: .date).datePickerStyle(.compact).disabled(model.busy)
                Spacer()
                Button("Review payouts") { model.review() }.disabled(model.busy || !model.connectedProvider || model.bankID == 0)
                Button("Export CSV") { model.exportCSV() }.disabled(model.payouts.isEmpty)
            }
            Table(model.rows) {
                TableColumn("Payout date") { Text($0.payout.date) }.width(95)
                TableColumn("Reference") { Text($0.payout.reference).textSelection(.enabled) }
                TableColumn("Amount") { Text($0.payout.amount, format: .number.precision(.fractionLength(2))).monospacedDigit() }.width(100)
                TableColumn("Currency") { Text($0.payout.currency) }.width(65)
                TableColumn("ReAI bank") { Text($0.status).foregroundStyle($0.status == "Reference + amount" ? .green : .secondary) }.width(175)
            }
            Text("A candidate is a suggestion. No voucher, bank match, sale, VAT entry, or payment is created automatically. Verify in ReAI before booking.")
                .font(.caption).foregroundStyle(.secondary)
            HStack { Link("\(AppInfo.brand) credential instructions", destination: AppInfo.helpURL); Spacer(); Link("Create a ReAI user access token", destination: URL(string: "https://app.reai.no/user/profile#user-access-tokens")!) }.font(.caption)
        }.padding(24)
    }
    private var providerBox: some View {
        GroupBox(AppInfo.brand) {
            VStack(alignment: .leading, spacing: 8) {
                if model.connectedProvider {
                    Label("Credentials saved in Keychain", systemImage: "checkmark.shield").foregroundStyle(.green)
                    Button("Remove credentials") { model.removeProvider() }.disabled(model.busy)
                } else {
                    ForEach(AppInfo.fields, id: \.key) { field in
                        if field.secret { SecureField(field.label, text: Binding(get: { model.inputs[field.key] ?? "" }, set: { model.inputs[field.key] = $0 })) }
                        else { TextField(field.label, text: Binding(get: { model.inputs[field.key] ?? "" }, set: { model.inputs[field.key] = $0 })) }
                    }
                    Button("Save credentials") { model.saveProvider() }.disabled(model.busy)
                    Text(AppInfo.credentialHint).font(.caption).foregroundStyle(.secondary)
                }
            }.textFieldStyle(.roundedBorder).frame(maxWidth: .infinity, alignment: .leading).padding(6)
        }.frame(maxWidth: .infinity)
    }
    private var reaiBox: some View {
        GroupBox("ReAI") {
            VStack(alignment: .leading, spacing: 8) {
                if let account = model.account {
                    Picker("Company", selection: $model.companyID) {
                        ForEach(account.tenants) { Text($0.companyName).tag($0.id) }
                    }.onChange(of: model.companyID) { _, _ in model.refreshBanks() }
                    Picker("Bank", selection: $model.bankID) {
                        ForEach(model.availableBanks) { Text($0.displayName).tag($0.id) }
                    }
                    Button("Remove ReAI token") { model.removeReAI() }.disabled(model.busy)
                } else {
                    SecureField("Paste ReAI user access token", text: $model.reaiInput)
                    Button("Connect ReAI") { model.connectReAI() }.disabled(model.busy)
                    Text("Create a user access token in ReAI. No app registration or browser authorization flow.").font(.caption).foregroundStyle(.secondary)
                }
            }.textFieldStyle(.roundedBorder).frame(maxWidth: .infinity, alignment: .leading).padding(6)
        }.frame(maxWidth: .infinity)
    }
}
