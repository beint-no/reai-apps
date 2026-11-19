import SwiftUI

@main
@MainActor
struct ReceiptApp: App {
    @State private var model: ReceiptModel
    @StateObject private var updater: ReceiptUpdater

    init() {
        let model = ReceiptModel()
        _model = State(initialValue: model)
        _updater = StateObject(wrappedValue: ReceiptUpdater(model: model))
    }

    var body: some Scene {
        Window("ReAI Receipt Printer", id: "receipts") {
            ReceiptWindow(model: model, updating: updater.inProgress)
                .frame(minWidth: 800, minHeight: 590)
                .task { await model.restore() }
        }
        .defaultSize(width: 970, height: 680)
        .commands {
            CommandGroup(after: .appInfo) {
                if updater.configured {
                    Button("Check for Updates…") { updater.check() }
                        .disabled(!updater.canCheck || model.busy || model.connecting)
                }
            }
        }
    }
}

struct ReceiptWindow: View {
    let model: ReceiptModel
    let updating: Bool
    @State private var authorization: Task<Void, Never>?
    @State private var end = Date()
    @State private var start = ReceiptSearch.calendar.date(byAdding: .day, value: -6, to: Date()) ?? Date()
    @State private var number = ""
    @State private var register = ""
    @State private var selected: Receipt.ID?
    @State private var note = ""
    @State private var paper: PaperWidth = .wide
    @State private var submitted = false

    var body: some View {
        Group {
            if let company = model.company {
                connected(company).task(id: company.id) { await find() }
            } else {
                ContentUnavailableView {
                    Label("Connect to ReAI", systemImage: "printer")
                } description: {
                    if let code = model.code { Text("Approve this code in your browser: \(code)").textSelection(.enabled) }
                    else { Text("Sign in in your browser and select the company whose receipts you want to find.") }
                } actions: {
                    if model.connecting {
                        Button("Cancel") { authorization?.cancel() }
                    } else {
                        Button("Connect to ReAI") { authorization = Task { await model.connect() } }
                            .buttonStyle(.borderedProminent)
                            .disabled(model.busy)
                    }
                }
            }
        }
        .disabled(updating)
        .safeAreaInset(edge: .bottom) {
            if let error = model.error {
                Label(error, systemImage: "exclamationmark.circle")
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(.bar)
            }
        }
    }

    private func connected(_ company: Company) -> some View {
        HSplitView {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Label("Connected company", systemImage: "building.2").font(.caption).foregroundStyle(.secondary)
                    Text(company.companyName).font(.headline)
                }
                Divider()
                Text("Find a POS receipt").font(.headline)
                VStack(alignment: .leading, spacing: 6) {
                    DatePicker("From", selection: $start, displayedComponents: .date)
                    DatePicker("Through", selection: $end, displayedComponents: .date)
                }
                .environment(\.calendar, ReceiptSearch.calendar).environment(\.timeZone, ReceiptSearch.oslo)
                TextField("Receipt number (optional)", text: $number).onSubmit { Task { await find() } }
                TextField("Cash register ID (optional)", text: $register).onSubmit { Task { await find() } }
                HStack {
                    Button("Find receipts") { Task { await find() } }.buttonStyle(.borderedProminent)
                    if model.busy { ProgressView().controlSize(.small) }
                }
                .disabled(model.busy)
                Divider()
                HStack {
                    Text("Receipts").font(.headline)
                    Spacer()
                    if let total = model.totalItems {
                        Text("\(model.receipts.count) of \(total)").font(.caption).foregroundStyle(.secondary)
                    }
                }
                List(selection: $selected) {
                    ForEach(model.receipts) { receipt in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(receipt.receiptNumber).font(.headline)
                            Text("\(receipt.displayDate) · Register \(receipt.cashPointId)").foregroundStyle(.secondary)
                            Text(receipt.type.replacingOccurrences(of: "_", with: " ").capitalized).font(.caption)
                        }
                        .tag(receipt.id)
                    }
                }
                .overlay {
                    if model.receipts.isEmpty && model.attemptedSearch && !model.busy && model.error == nil {
                        ContentUnavailableView("No receipts found", systemImage: "doc.text.magnifyingglass",
                            description: Text("Try a different date range or clear the receipt number and register filters."))
                    }
                }
                HStack {
                    Button("Load older") { Task { await model.more() } }
                        .disabled(model.busy || !model.hasOlder)
                    Spacer()
                    Button("Change company…") {
                        Task {
                            await model.disconnect()
                            if model.company == nil {
                                selected = nil; number = ""; register = ""; note = ""; submitted = false
                                authorization = Task { await model.connect() }
                            }
                        }
                    }.disabled(model.busy)
                }
            }
            .padding().frame(minWidth: 310, idealWidth: 340, maxWidth: 420)

            if let receipt = model.receipts.first(where: { $0.id == selected }) {
                detail(company: company, receipt: receipt)
            } else {
                ContentUnavailableView("Select a receipt", systemImage: "doc.text",
                    description: Text("Choose a row on the left to view its purchase and print a store message."))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .onChange(of: selected) { _, _ in submitted = false }
    }

    private func detail(company: Company, receipt: Receipt) -> some View {
        let message = note.trimmingCharacters(in: .whitespacesAndNewlines)
        let document = receipt.isSale && !message.isEmpty && message.utf16.count <= NoteDocument.maxLength
            ? try? NoteDocument(company: company, receipt: receipt, message: message, paper: paper)
            : nil
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(receipt.receiptNumber).font(.title2.bold())
                Spacer()
                Text(receipt.amount(receipt.grossAmount)).font(.headline.monospacedDigit())
            }
            Text("\(receipt.displayDate) · Register \(receipt.cashPointId)").foregroundStyle(.secondary)
            List(receipt.lines) { line in
                HStack {
                    Text(line.quantity.formatted()).monospacedDigit()
                    Text(line.productText)
                    Spacer()
                    Text(receipt.amount(line.grossAmount)).monospacedDigit()
                }
            }.frame(minHeight: 95, idealHeight: 130, maxHeight: 160)

            if receipt.isSale {
                HStack {
                    Text("Store message").font(.headline)
                    Spacer()
                    Picker("Paper width", selection: $paper) {
                        ForEach(PaperWidth.allCases) { Text($0.label).tag($0) }
                    }.fixedSize()
                }
                TextField("e.g. Holiday returns accepted through 15 January", text: $note, axis: .vertical)
                    .textFieldStyle(.roundedBorder).lineLimit(3...5)
                Text("Print this separate message to hand out with the original POS receipt.")
                    .foregroundStyle(.secondary)

                if let document {
                    NotePreview(document: document).frame(minHeight: 115, maxHeight: .infinity)
                } else if !message.isEmpty {
                    Text("Shorten the message or select a wider roll (maximum \(NoteDocument.maxLength) characters).")
                        .foregroundStyle(.secondary)
                }
                HStack {
                    Button("Print store message…") {
                        if let document { submitted = model.printNote(document) }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(document == nil || model.busy)
                    if submitted { Text("Print dialog completed. Check the printer queue.").foregroundStyle(.secondary) }
                }
            } else {
                Text("Store messages are available for sales receipts.").foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding().frame(minWidth: 465, maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func find() async {
        guard !model.busy else { return }
        selected = nil
        await model.search(start: start, end: end, number: number, register: register)
    }
}
