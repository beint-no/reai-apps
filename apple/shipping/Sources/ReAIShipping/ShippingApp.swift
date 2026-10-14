import AppKit
import SwiftUI

@main
struct ShippingApp: App {
    @State private var model = ShippingModel()
    @Environment(\.openWindow) private var openWindow

    var body: some Scene {
        Window("ReAI Shipping", id: "shipping") {
            ShippingView(model: model)
                .frame(width: 460, height: 610)
                .task { await model.start() }
                .onOpenURL { url in Task { await model.receive(url) } }
        }
        .defaultSize(width: 460, height: 610)
        .windowResizability(.contentSize)
        MenuBarExtra("ReAI Shipping", systemImage: "printer") {
            Button(t("Open ReAI Shipping")) { openWindow(id: "shipping"); NSApp.activate() }
            Button(t("Open orders in ReAI")) { NSWorkspace.shared.open(AppEnvironment.origin.appending(path: "order")) }
            Divider()
            Button(t("Quit")) { NSApp.terminate(nil) }.disabled(model.busy)
        }
    }
}

struct ShippingView: View {
    @Bindable var model: ShippingModel
    @State private var reprint: PrintRecord?
    @State private var disconnect = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                HStack(spacing: 14) {
                    Image(systemName: "shippingbox.and.arrow.backward").font(.system(size: 32)).foregroundStyle(.teal)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("ReAI Shipping").font(.title2.bold())
                        Text(t("One click in ReAI. Label printed.")).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if model.busy { ProgressView().controlSize(.small) }
                }
                if let company = model.company {
                    GroupBox {
                        HStack {
                            Label(company.companyName, systemImage: "checkmark.shield").foregroundStyle(.secondary)
                            Spacer()
                            Button(t("Disconnect")) { disconnect = true }.disabled(model.busy)
                        }.padding(8)
                    }
                } else {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(t("Connect once and choose your company. Your password stays in the browser."))
                            .foregroundStyle(.secondary)
                        Button(t("Connect to ReAI")) { model.connect() }
                            .buttonStyle(.borderedProminent).controlSize(.large).disabled(model.connecting)
                        if model.connecting {
                            HStack {
                                ProgressView().controlSize(.small)
                                Text(model.code).monospaced().textSelection(.enabled)
                                Button(t("Cancel")) { Task { await model.disconnect() } }
                            }
                        }
                    }
                }
                VStack(alignment: .leading, spacing: 10) {
                    Text(t("Label printer")).font(.headline)
                    HStack {
                        Picker(t("Printer"), selection: $model.printerId) {
                            Text(t("Choose a printer")).tag("")
                            ForEach(model.printers) { printer in Text(printer.name).tag(printer.id) }
                        }.labelsHidden().disabled(model.busy)
                        Button { Task { await model.refreshPrinters() } } label: { Image(systemName: "arrow.clockwise") }
                            .help(t("Refresh printers"))
                    }
                    Text(t("Zebra is selected automatically when available. Label size follows the carrier PDF. One copy, no print dialog."))
                        .font(.caption).foregroundStyle(.secondary)
                    if model.printers.isEmpty {
                        Button(t("Add printer in System Settings")) {
                            NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.Print-Scan-Settings.extension")!)
                        }
                    }
                }
                if let company = model.company {
                    VStack(alignment: .leading, spacing: 10) {
                        Button(t("Enable printing in ReAI")) { NSWorkspace.shared.open(AppEnvironment.setup(company: company.id)) }
                            .buttonStyle(.borderedProminent).controlSize(.large).disabled(model.printerId.isEmpty)
                        Text(t("Then create a shipping label as usual in ReAI. This Mac prints it automatically. Allow your browser to open ReAI Shipping when asked."))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                if !model.pending.isEmpty {
                    Button(t("Print waiting labels")) { Task { await model.drain() } }
                        .disabled(model.busy || model.company == nil || model.printerId.isEmpty)
                }
                if let notice = model.notice { Label(notice, systemImage: "info.circle").font(.callout).foregroundStyle(.secondary) }
                if let error = model.error { Label(error, systemImage: "exclamationmark.triangle").font(.callout).foregroundStyle(.orange).textSelection(.enabled) }
                Divider()
                HStack {
                    Text(t("Recent labels")).font(.headline)
                    Spacer()
                    Button(t("Open orders in ReAI")) { NSWorkspace.shared.open(AppEnvironment.origin.appending(path: "order")) }
                }
                if model.records.isEmpty { Text(t("Labels sent from ReAI will appear here.")).font(.callout).foregroundStyle(.secondary) }
                ForEach(model.records.prefix(10)) { record in
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(t("Shipment") + " #\(record.request.shipmentId)")
                            Text(t(record.state == "queued" ? "In printer queue" : "Check before reprinting"))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button(t("Reprint")) { reprint = record }
                            .disabled(model.busy || model.company?.id != record.request.tenantId || model.printerId.isEmpty)
                    }
                }
            }.padding(26)
        }
        .onChange(of: model.printerId) { _, _ in Task { await model.drain() } }
        .confirmationDialog(t("Print another copy? Check the printer queue first."), isPresented: Binding(get: { reprint != nil }, set: { if !$0 { reprint = nil } })) {
            if let record = reprint {
                Button(t("Print another copy")) { Task { await model.reprint(record) }; reprint = nil }
            }
        }
        .confirmationDialog(t("Disconnect this Mac?"), isPresented: $disconnect) {
            Button(t("Disconnect"), role: .destructive) { Task { await model.disconnect() } }
        }
    }
}
