import SwiftUI

@main struct HybelApp: App {
    @State private var model = JournalModel()
    var body: some Scene {
        WindowGroup("ReAI Hybel Journal") {
            JournalView(model: model).frame(minWidth: 950, minHeight: 760).task { await model.start() }
        }.defaultSize(width: 1040, height: 880)
    }
}
struct JournalView: View {
    @Bindable var model: JournalModel
    @State private var confirming = false
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                Image(systemName: "house.and.flag.fill").font(.system(size: 34)).foregroundStyle(.teal)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Hybel → ReAI").font(.largeTitle.bold())
                    Text("Monthly journal import · Experimental").foregroundStyle(.secondary)
                }
                Spacer()
                Link("Export instructions", destination: URL(string: "https://hjelpesenter.hybel.no/knowledge/hvordan-kan-jeg-importere-husleie-forfall-og-innbetalinger-til-mitt-regnskapssystem")!)
            }
            Text("Export a complete monthly bilagsjournal as CSV from Hybel → Rapporter. This version uses the ReAI API; direct Hybel API sync is awaiting documentation. Hybel retains the tenant-level subledger. No invoices or payments are sent.")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            GroupBox {
                if model.companies.isEmpty {
                    HStack {
                        Button("Connect to ReAI") { model.connect(browser: true) }.buttonStyle(.borderedProminent)
                        if let code = model.code { Text("Approve code \(code) in your browser").monospaced() }
                        Spacer()
                    }
                    DisclosureGroup("Use a ReAI API key instead") {
                        HStack {
                            SecureField("ReAI user API key", text: $model.keyInput)
                            Button("Connect with key") { model.connect(browser: false) }
                        }.padding(.top, 8)
                    }
                } else {
                    HStack {
                        Picker("Company", selection: $model.companyID) {
                            Text("Choose a company").tag(0)
                            ForEach(model.companies) { Text($0.companyName).tag($0.id) }
                        }
                        Button("Disconnect") { model.disconnect() }
                    }
                }
            } label: { Text("1. Connect").font(.headline) }
            GroupBox {
                HStack {
                    Button("Open Hybel CSV…") { model.openCSV() }
                    Text(model.filename.isEmpty ? "Choose the original journal export" : model.filename).foregroundStyle(.secondary).lineLimit(1)
                    Spacer()
                    TextField("Source report organization number", text: $model.sourceOrganization).frame(width: 260)
                }
                if let csv = model.csv {
                    Grid(alignment: .leading, horizontalSpacing: 20, verticalSpacing: 6) {
                        GridRow { column("Date", field: $model.mapping.date, csv: csv); column("Account", field: $model.mapping.account, csv: csv) }
                        GridRow { column("Voucher / BatchID", field: $model.mapping.reference, csv: csv); column("Description", field: $model.mapping.description, csv: csv) }
                        GridRow { column("Signed amount", field: $model.mapping.amount, csv: csv); column("VAT code", field: $model.mapping.vat, csv: csv) }
                        if model.mapping.amount < 0 {
                            GridRow { column("Debit amount", field: $model.mapping.debit, csv: csv); column("Credit amount", field: $model.mapping.credit, csv: csv) }
                        }
                    }.padding(.top, 8)
                    HStack {
                        Text("\(csv.rows.count) source lines · positive = debit, negative = credit · NOK · VAT 0 only").font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Button("Validate & preview") { model.validate() }.disabled(model.companyID == 0 || !model.mapping.complete)
                    }.padding(.top, 8)
                }
            } label: { Text("2. Open and map the journal").font(.headline) }
            if let journal = model.journal {
                HStack {
                    Text("\(journal.month) · \(journal.entries.count) postings").font(.headline)
                    Spacer()
                    Text("Debit = credit: \(NSDecimalNumber(value: journal.debitMinor).dividing(by: 100).stringValue) NOK").monospacedDigit()
                }
                Table(journal.entries) {
                    TableColumn("Date", value: \.date).width(90)
                    TableColumn("Reference / BatchID", value: \.reference)
                    TableColumn("Account", value: \.account).width(65)
                    TableColumn("Amount", value: \.amount).width(100)
                    TableColumn("Description", value: \.description)
                }.frame(minHeight: 120)
                VStack(alignment: .leading, spacing: 5) {
                    Toggle("The report belongs to \(model.registry?.name ?? "the selected company") (\(model.sourceOrganization)).", isOn: $model.confirmedCompany)
                    Toggle("This is the complete monthly journal; source reports and BatchIDs will be retained and attached in ReAI.", isOn: $model.confirmedSource)
                    Toggle("All source amounts are NOK and postings use VAT code 0; no customer/employee/supplier ledger or project/department detail is required.", isOn: $model.confirmedNoVAT)
                    Toggle("These entries are unbooked, including any bank entries. I will avoid booking the same payments again during reconciliation.", isOn: $model.confirmedNotBooked)
                }.font(.caption)
                HStack {
                    Text("Creates one manual voucher flagged for accountant review.").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("Create review voucher…") { confirming = true }.buttonStyle(.borderedProminent).disabled(!model.canPost)
                }
            } else {
                ContentUnavailableView("Review before booking", systemImage: "doc.text.magnifyingglass", description: Text("Choose one month, map the source columns and validate. No accounting entries are created until you confirm."))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            if let error = model.error { Text(error).foregroundStyle(.red).font(.callout).textSelection(.enabled).fixedSize(horizontal: false, vertical: true) }
            if let notice = model.notice { Text(notice).foregroundStyle(.secondary).font(.callout).textSelection(.enabled).fixedSize(horizontal: false, vertical: true) }
            HStack {
                if model.busy { ProgressView().controlSize(.small); Text("Working…").foregroundStyle(.secondary) }
                Spacer()
                if let url = model.voucherURL { Link("Open voucher in ReAI ↗", destination: url) }
            }.frame(height: 18)
        }.padding(24).disabled(model.busy)
        .confirmationDialog("Create this journal voucher in \(model.company?.companyName ?? "ReAI")?", isPresented: $confirming, titleVisibility: .visible) {
            Button("Create review voucher") { model.post() }
        } message: { Text("This books the previewed journal with VAT code 0. It does not send invoices, approve payments or close bank reconciliation.") }
    }
    private func column(_ title: String, field: Binding<Int>, csv: CSVDocument) -> some View {
        Picker(title, selection: field) {
            Text("Not mapped").tag(-1)
            ForEach(csv.headers.indices, id: \.self) { index in Text("\(index + 1). \(csv.headers[index])").tag(index) }
        }.frame(maxWidth: .infinity)
    }
}
