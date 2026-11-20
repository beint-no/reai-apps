import AppKit
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
    @State private var printer = ""
    @State private var printers: [String] = []
    @State private var confirmingPrint = false
    @State private var refresh = 0

    private struct SearchTrigger: Equatable {
        let companyID: Int
        let start: Date
        let end: Date
        let refresh: Int
    }

    var body: some View {
        Group {
            if let company = model.company {
                connected(company)
                    .task(id: SearchTrigger(companyID: company.id, start: start, end: end, refresh: refresh)) {
                        await find()
                        await watchForNewReceipts()
                    }
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
        .onAppear { refreshPrinters() }
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
                TextField("Receipt number (optional)", text: $number).onSubmit { refresh += 1 }
                TextField("Cash register ID (optional)", text: $register).onSubmit { refresh += 1 }
                HStack {
                    Button("Find receipts") { refresh += 1 }.buttonStyle(.borderedProminent)
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
                                selected = nil; number = ""; register = ""; note = ""
                                authorization = Task { await model.connect() }
                            }
                        }
                    }.disabled(model.busy)
                }
            }
            .padding().frame(minWidth: 310, idealWidth: 340, maxWidth: 420)

            if let receipt = model.receipts.first(where: { $0.id == selected }) {
                detail(receipt: receipt)
            } else {
                ContentUnavailableView("Select a receipt", systemImage: "doc.text",
                    description: Text("Choose a row on the left to view its purchase and print its receipt."))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    private func detail(receipt: Receipt) -> some View {
        let message = note.trimmingCharacters(in: .whitespacesAndNewlines)

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

            Text("Store message (optional)").font(.headline)
            TextField("e.g. Holiday returns accepted through 15 January", text: $note, axis: .vertical)
                .textFieldStyle(.roundedBorder).lineLimit(3...5)
            if message.utf16.count > ReceiptPDF.maximumMessageLength {
                Text("Use at most 500 characters.").foregroundStyle(.red)
            }

            HStack {
                Picker("Printer", selection: $printer) {
                    Text("Select an 80 mm printer").tag("")
                    ForEach(printers, id: \.self) { Text($0).tag($0) }
                }
                Button("Refresh printers", action: refreshPrinters)
            }
            HStack {
                Button("Print receipt…") { confirmingPrint = true }
                    .buttonStyle(.borderedProminent)
                    .disabled(printer.isEmpty || message.utf16.count > ReceiptPDF.maximumMessageLength || model.busy)
                if model.queuedReceiptID == receipt.id {
                    Text("Sent to printer.").foregroundStyle(.secondary)
                }
            }
            .confirmationDialog("Print receipt \(receipt.receiptNumber)?", isPresented: $confirmingPrint, titleVisibility: .visible) {
                Button("Print") {
                    Task { await model.printReceipt(receipt, message: message, printer: printer) }
                }
            } message: {
                Text("Use this printer for the receipt you will give the customer at checkout.")
            }
            Spacer(minLength: 0)
        }
        .padding().frame(minWidth: 465, maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func refreshPrinters() {
        printers = NSPrinter.printerNames.sorted()
        if !printers.contains(printer) {
            let defaultPrinter = NSPrintInfo.shared.printer.name
            printer = printers.contains(defaultPrinter) ? defaultPrinter : (printers.count == 1 ? printers[0] : "")
        }
    }

    private func find() async {
        selected = nil
        do {
            try await Task.sleep(for: .milliseconds(250))
            while model.busy { try await Task.sleep(for: .milliseconds(50)) }
            try Task.checkCancellation()
            await model.search(start: start, end: end, number: number, register: register)
        } catch {
            // Selecting another date cancels this search.
        }
    }

    private func watchForNewReceipts() async {
        let calendar = ReceiptSearch.calendar
        let today = calendar.startOfDay(for: Date())
        guard calendar.startOfDay(for: start) <= today, today <= calendar.startOfDay(for: end) else { return }
        let followsToday = calendar.isDateInToday(end)
        while !Task.isCancelled {
            do { try await Task.sleep(for: .seconds(10)) }
            catch { return }
            if followsToday, !calendar.isDateInToday(end) {
                end = Date()
                return
            }
            await model.refreshLatest()
        }
    }
}
