import AppKit
import SwiftUI

struct SettingsView: View {
    @Bindable var model: BridgeModel
    @State private var cashPointText = ""
    @State private var confirmDisconnect = false
    @State private var confirmPrint: ReceiptRecord?
    @State private var openAtLogin = LoginItem.enabled

    var body: some View {
        Form {
            Section {
                LabeledContent("Status") { Text(model.status).foregroundStyle(.secondary) }
                if let problem = model.connectionProblem ?? model.printerProblem {
                    Label(problem, systemImage: "exclamationmark.triangle").foregroundStyle(.orange).textSelection(.enabled)
                }
                if let check = model.lastCheck {
                    LabeledContent("Last check") { Text(check, style: .time).foregroundStyle(.secondary) }
                }
            }
            connection
            if model.connected {
                cashPoints
                printer
                receipts
            }
            Section {
                Toggle("Open at login", isOn: $openAtLogin)
                    .onChange(of: openAtLogin) { _, on in
                        do { try LoginItem.set(on) } catch {
                            model.error = "macOS did not allow opening at login. Check System Settings → General → Login Items."
                            openAtLogin = LoginItem.enabled
                        }
                    }
            }
        }
        .formStyle(.grouped)
        .safeAreaInset(edge: .bottom) { messages }
        .confirmationDialog("Disconnect this Mac?", isPresented: $confirmDisconnect) {
            Button("Disconnect", role: .destructive) { Task { await model.disconnect() } }
        } message: { Text("Receipts stop printing here. Revoke access in your ReAI profile to remove it from ReAI.") }
        .confirmationDialog("Print this receipt?", isPresented: Binding(get: { confirmPrint != nil }, set: { if !$0 { confirmPrint = nil } })) {
            if let record = confirmPrint { Button("Print receipt") { Task { await model.printOriginal(record.id) }; confirmPrint = nil } }
        } message: { Text("This receipt was never sent to the printer. It prints once.") }
    }

    private var connection: some View {
        Section("ReAI") {
            if let company = model.company {
                LabeledContent("Company") { Text(company.companyName) }
                Button("Disconnect") { confirmDisconnect = true }.disabled(model.busy)
            } else {
                Text("Connect once and choose your company. Your password stays in the browser.").foregroundStyle(.secondary)
                HStack {
                    Button("Connect to ReAI") { model.connect() }.buttonStyle(.borderedProminent).disabled(model.connecting)
                    if model.connecting {
                        ProgressView().controlSize(.small)
                        Text(model.code).monospaced()
                        Button("Cancel") { model.cancelConnect() }
                    }
                }
                Text("Your ReAI user needs kassasystem read and company read permission.").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private var cashPoints: some View {
        Section {
            Toggle("All cash points", isOn: Binding(get: { model.state.allCashPoints }, set: { model.setAllCashPoints($0) }))
            if !model.state.allCashPoints {
                ForEach(model.knownCashPoints, id: \.self) { id in
                    Toggle(isOn: Binding(get: { model.state.cashPoints.contains(id) }, set: { model.setCashPoint(id, $0) })) {
                        Text("Cash point \(id)")
                        if let hint = model.hint(id) { Text(hint) }
                    }
                }
                HStack {
                    TextField("Cash point ID", text: $cashPointText).frame(maxWidth: 140)
                        .onSubmit { model.addCashPoint(cashPointText); cashPointText = "" }
                    Button("Add") { model.addCashPoint(cashPointText); cashPointText = "" }.disabled(cashPointText.isEmpty)
                    Spacer()
                    if model.finding { ProgressView().controlSize(.small) }
                    Button("Find cash points") { Task { await model.findCashPoints() } }.disabled(model.finding)
                }
            }
        } header: { Text("Cash points") } footer: {
            Text("New receipts from the chosen cash points print here. Receipts from before you choose a cash point are not printed. Let one computer print each cash point.")
        }
    }

    private var printer: some View {
        Section {
            Picker("Printer", selection: Binding(get: { model.state.printer.kind }, set: { kind in model.update { $0.printer.kind = kind } })) {
                Text("Network printer (port 9100)").tag(PrinterKind.network)
                Text("Installed printer (raw)").tag(PrinterKind.installed)
            }
            if model.state.printer.kind == .network {
                TextField("IP address or host name", text: Binding(get: { model.state.printer.host }, set: { host in model.update { $0.printer.host = host.trimmingCharacters(in: .whitespaces) } }))
                TextField("Port", value: Binding(get: { model.state.printer.port }, set: { port in model.update { $0.printer.port = port } }), format: .number.grouping(.never))
            } else {
                HStack {
                    Picker("Queue", selection: Binding(get: { model.state.printer.queue }, set: { queue in model.update { $0.printer.queue = queue } })) {
                        Text("Choose a printer").tag("")
                        ForEach(model.queues, id: \.self) { Text($0.replacingOccurrences(of: "_", with: " ")).tag($0) }
                    }
                    Button { Task { await model.refreshQueues() } } label: { Image(systemName: "arrow.clockwise") }.help("Refresh printers")
                }
            }
            Picker("Paper width", selection: Binding(get: { model.state.printer.paperWidth }, set: { width in model.update { $0.printer.paperWidth = width } })) {
                Text("80 mm").tag(80)
                Text("58 mm").tag(58)
            }.pickerStyle(.segmented)
            Toggle("Open cash drawer for cash payments", isOn: Binding(get: { model.state.openDrawerForCash }, set: { on in model.update { $0.openDrawerForCash = on } }))
            Toggle("Print receipt QR code", isOn: Binding(get: { model.state.printQRCode }, set: { on in model.update { $0.printQRCode = on } }))
            HStack {
                Button("Test print") { Task { await model.testPrint() } }
                Button("Open drawer") { Task { await model.openDrawer() } }
                Spacer()
                Toggle("Pause printing", isOn: Binding(get: { model.state.paused }, set: { _ in model.togglePaused() }))
            }.disabled(!model.state.printer.configured || model.busy)
        } header: { Text("Receipt printer") } footer: {
            Text("ESC/POS thermal printers such as Epson TM or Star in ESC/POS mode. The drawer connects to the printer's drawer port.")
        }
    }

    private var receipts: some View {
        Section("Recent receipts") {
            if model.receipts.isEmpty { Text("Printed receipts will appear here.").foregroundStyle(.secondary) }
            ForEach(model.receipts.prefix(40)) { record in
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(record.receiptNumber) · cash point \(record.cashPointId)").font(.callout.weight(.medium))
                        Text(record.date, format: .dateTime.day().month().hour().minute()).font(.caption).foregroundStyle(.secondary)
                        Text(describe(record)).font(.caption).foregroundStyle(record.state == .printed ? Color.secondary : Color.orange)
                    }
                    Spacer()
                    Text(ReceiptRenderer.money(record.grossAmount)).monospacedDigit()
                    if record.state == .blocked || record.state == .skipped {
                        Button("Print") { confirmPrint = record }.disabled(model.busy || !model.state.printer.configured)
                    }
                }
            }
        }
    }

    private func describe(_ record: ReceiptRecord) -> String {
        switch record.state {
        case .pending: record.detail.map { "Waiting: \($0)" } ?? "Waiting for the printer"
        case .printing: "Printing"
        case .printed: "Sent to printer"
        case .uncertain, .blocked, .skipped: record.detail ?? "Check the printer"
        }
    }

    @ViewBuilder private var messages: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let notice = model.notice {
                Label(notice, systemImage: "info.circle").font(.caption).onTapGesture { model.notice = nil }
            }
            if let error = model.error {
                Label(error, systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(.orange).textSelection(.enabled)
                    .onTapGesture { model.error = nil }
            }
        }.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 20).padding(.bottom, 10)
    }
}
