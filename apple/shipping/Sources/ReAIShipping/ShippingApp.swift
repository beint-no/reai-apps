import AppKit
import SwiftUI

@main
struct ShippingApp: App {
    @State private var model = ShippingModel()
    @Environment(\.openWindow) private var openWindow
    var body: some Scene {
        Window("ReAI Shipping", id: "shipping") {
            ShippingView(model: model).frame(minWidth: 860, minHeight: 700).task { await model.start() }
        }.defaultSize(width: 960, height: 780)
        MenuBarExtra("ReAI Shipping", systemImage: "shippingbox") {
            Button(t("Open ReAI Shipping")) { openWindow(id: "shipping"); NSApp.activate() }
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
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Image(systemName: "shippingbox.fill").font(.title).foregroundStyle(.teal)
                VStack(alignment: .leading, spacing: 3) {
                    Text("ReAI Shipping").font(.title2.bold())
                    Text(model.company?.companyName ?? t("Connect once. Ship and print here.")).foregroundStyle(.secondary)
                }
                Spacer()
                if model.busy { ProgressView().controlSize(.small) }
                if model.company != nil { Button(t("Disconnect")) { disconnect = true }.disabled(model.busy) }
            }.padding(20)
            Divider()
            if model.company == nil { connection.padding(32); Spacer() }
            else {
                HSplitView {
                    orderList.frame(minWidth: 260, idealWidth: 300, maxWidth: 360)
                    ScrollView { details.padding(24).frame(maxWidth: .infinity, alignment: .leading) }.frame(minWidth: 480)
                }
                Divider()
                HStack {
                    Label(t("Label printer"), systemImage: "printer")
                    Picker(t("Printer"), selection: $model.printerId) {
                        Text(t("Choose a printer")).tag("")
                        ForEach(model.printers) { Text($0.name).tag($0.id) }
                    }.labelsHidden().frame(maxWidth: 280).disabled(model.busy)
                    Button { Task { await model.refreshPrinters() } } label: { Image(systemName: "arrow.clockwise") }.help(t("Refresh printers"))
                    if model.printers.isEmpty {
                        Button(t("Add printer")) { NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.Print-Scan-Settings.extension")!) }
                    }
                    Spacer()
                    Text(t("One copy · Carrier label size")).font(.caption).foregroundStyle(.secondary)
                }.padding(16)
            }
            if let notice = model.notice { Label(notice, systemImage: "info.circle").font(.callout).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 20).padding(.bottom, 12) }
            if let error = model.error { Label(error, systemImage: "exclamationmark.triangle").font(.callout).foregroundStyle(.orange).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 20).padding(.bottom, 12) }
        }
        .confirmationDialog(t("Print another copy? Check the printer queue first."), isPresented: Binding(get: { reprint != nil }, set: { if !$0 { reprint = nil } })) {
            if let record = reprint { Button(t("Print another copy")) { Task { await model.reprint(record) }; reprint = nil } }
        }
        .confirmationDialog(t("Disconnect this Mac?"), isPresented: $disconnect) {
            Button(t("Disconnect"), role: .destructive) { Task { await model.disconnect() } }
        }
    }
    private var connection: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(t("Open orders, shipping and labels in one place.")).font(.title2)
            Text(t("Connect once and choose your company. Your password stays in the browser.")).foregroundStyle(.secondary)
            Button(t("Connect to ReAI")) { model.connect() }.buttonStyle(.borderedProminent).controlSize(.large).disabled(model.connecting)
            if model.connecting { HStack { ProgressView().controlSize(.small); Text(model.code).monospaced(); Button(t("Cancel")) { Task { await model.disconnect() } } } }
            Text(t("Add your Zebra in macOS Printers & Scanners. A single Zebra is selected automatically.")).font(.callout).foregroundStyle(.secondary)
        }
    }
    private var orderList: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(t("Orders")).font(.headline)
                Spacer()
                Button { Task { await model.refreshOrders() } } label: { Image(systemName: "arrow.clockwise") }.disabled(model.busy)
            }.padding(.horizontal, 16).padding(.top, 16)
            Picker(t("Orders"), selection: Binding(get: { model.showingHistory }, set: { history in
                Task { await model.changeOrderView(history: history) }
            })) {
                Text(t("Ready to ship")).tag(false)
                Text(t("History")).tag(true)
            }.pickerStyle(.segmented).labelsHidden().padding(.horizontal, 16).disabled(model.busy || model.loadingOrders)
            HStack {
                TextField(t(model.showingHistory ? "Order number, ID or link" : "Order or customer"), text: $model.search).onSubmit { Task { await model.refreshOrders() } }
                Button(t("Search")) { Task { await model.refreshOrders() } }.disabled(model.loadingOrders)
            }.padding(.horizontal, 16).disabled(model.busy)
            if model.loadingOrders { ProgressView().controlSize(.small).padding(.horizontal, 16) }
            if model.orders.isEmpty && !model.loadingOrders {
                Text(t(model.showingHistory ? "Search all past orders by number, ID or ReAI link." : "No orders ready to ship. Find past labels in History."))
                    .font(.callout).foregroundStyle(.secondary).padding(.horizontal, 16)
            }
            List {
                ForEach(model.orders) { order in
                    Button { Task { await model.select(order) } } label: {
                        VStack(alignment: .leading, spacing: 5) {
                            HStack { Text(order.orderNumber).fontWeight(.semibold); Spacer(); if order.preparedShipmentId != nil { Image(systemName: "shippingbox").foregroundStyle(.teal) } }
                            Text(order.customerName).lineLimit(2)
                            Text(order.date).font(.caption).foregroundStyle(.secondary)
                        }.padding(.vertical, 7).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                    }.buttonStyle(.plain).listRowBackground(model.selectedOrder?.id == order.id ? Color.accentColor.opacity(0.12) : Color.clear).disabled(model.busy)
                }
                if model.canLoadMore { Button(t("Load more")) { Task { await model.refreshOrders(more: true) } }.disabled(model.busy || model.loadingOrders) }
            }.listStyle(.sidebar)
            Text("\(model.totalOrders) " + t("orders")).font(.caption).foregroundStyle(.secondary).padding(.horizontal, 16).padding(.bottom, 12)
        }
    }
    @ViewBuilder private var details: some View {
        VStack(alignment: .leading, spacing: 20) {
            if let order = model.selectedOrder {
                VStack(alignment: .leading, spacing: 5) { Text(order.orderNumber).font(.title.bold()); Text(order.customerName).font(.title3).foregroundStyle(.secondary) }
                if model.testMode { Label(t("Carrier test mode"), systemImage: "testtube.2").foregroundStyle(.orange) }
                if let shipment = model.shipment { savedShipment(shipment) }
                else if let draft = Binding($model.draft) { proposal(draft) }
                else if let reason = model.options?.unavailableReason { Text(reason).foregroundStyle(.secondary) }
                if model.shipment?.status == "booked", model.shipment?.labelAvailable == true {
                    Button { reprint = model.selectedPrintRecord } label: {
                        Label(t("Print label"), systemImage: "printer.fill").frame(maxWidth: .infinity)
                    }.buttonStyle(.borderedProminent).controlSize(.large)
                        .disabled(!model.canPrint)
                    Text(t("Sends one label to your printer.")).font(.caption).foregroundStyle(.secondary)
                    if model.printerId.isEmpty { Text(t("Choose a printer below to ship and print.")).font(.caption).foregroundStyle(.secondary) }
                } else if !model.showingHistory && (model.draft != nil || model.shipment?.actions.contains("book") == true) {
                    Button { Task { await model.shipAndPrint() } } label: {
                        Label(t("Ship & print") + (model.quote.map { " · " + $0.display } ?? ""), systemImage: "printer.fill").frame(maxWidth: .infinity)
                    }.buttonStyle(.borderedProminent).controlSize(.large).disabled(!model.canShip)
                    if model.printerId.isEmpty { Text(t("Choose a printer below to ship and print.")).font(.caption).foregroundStyle(.secondary) }
                    Text(t("Books this parcel, updates ReAI and sends one label to your printer.")).font(.caption).foregroundStyle(.secondary)
                }
                if !model.savedShipments.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(t("Saved shipments")).font(.headline)
                        ForEach(model.savedShipments) { s in
                            Button { Task { await model.chooseShipment(s.id) } } label: {
                                HStack {
                                    Image(systemName: model.shipment?.id == s.id ? "largecircle.fill.circle" : "circle")
                                    Text("#\(s.id) · " + t(s.status))
                                }
                            }.buttonStyle(.plain).disabled(model.busy)
                        }
                        if model.shipmentBeforeId != nil {
                            Button(t("Load more")) { Task { await model.loadMoreShipments() } }.disabled(model.busy)
                        }
                    }
                }
                if let company = model.company {
                    Link(t("Open order in ReAI"), destination: AppEnvironment.origin.appending(path: "order/\(order.id)")
                        .appending(queryItems: [URLQueryItem(name: "tenantId", value: String(company.id))]))
                }
            } else {
                ContentUnavailableView(t("Choose an order"), systemImage: "shippingbox", description: Text(t("Review the parcel and price, then ship and print in one click.")))
            }
            if !model.unfinished.isEmpty {
                Divider()
                Text(t("Shipping requests to check")).font(.headline)
                ForEach(model.unfinished) { op in
                    HStack {
                        Text(t("Order") + " #\(op.orderId)")
                        Spacer()
                        if ["rejected", "failed"].contains(op.state) {
                            Button(t("Review parcel again")) { Task { await model.review(op) } }.disabled(model.busy)
                        } else {
                            Button(t("Resume safely")) { Task { await model.resume(op) } }.disabled(model.busy || model.printerId.isEmpty)
                        }
                    }
                }
                Text(t("Resume checks the saved request and shipment before continuing. It never creates a replacement after an uncertain response.")).font(.caption).foregroundStyle(.secondary)
            }
            Divider()
            Text(t("Recent labels")).font(.headline)
            if model.records.filter({ $0.request.tenantId == model.company?.id }).isEmpty { Text(t("Printed labels will appear here.")).foregroundStyle(.secondary) }
            ForEach(model.records.filter { $0.request.tenantId == model.company?.id }.prefix(10)) { record in
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(t("Shipment") + " #\(record.request.shipmentId)")
                        Text(t(record.state == "queued" ? "In printer queue" : "Check before reprinting")).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button(t("Reprint")) { reprint = record }.disabled(model.busy || model.printerId.isEmpty)
                }
            }
        }
    }
    private func savedShipment(_ shipment: Shipment) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(t(shipment.status), systemImage: "shippingbox").font(.headline)
            Text([shipment.recipient.name, shipment.recipient.addressPart1, shipment.recipient.postalCode, shipment.recipient.city].compactMap { $0 }.joined(separator: "\n"))
            Text("\(shipment.parcel.weightGrams) g · \(shipment.parcel.lengthCm.formatted()) × \(shipment.parcel.widthCm.formatted()) × \(shipment.parcel.heightCm.formatted()) cm").foregroundStyle(.secondary)
            if let amount = shipment.customerCharge.amount, let currency = shipment.customerCharge.currencyCode { Text(t("Shipping price") + ": \(amount.formatted()) \(currency)").font(.headline) }
            if let error = shipment.error { Text(error).foregroundStyle(.orange) }
            if !model.showingHistory && shipment.actions.contains("cancel") { Button(t("Cancel preparation")) { Task { await model.cancelPreparation() } }.disabled(model.busy) }
            if shipment.inventoryRecordingPending || shipment.customerCharge.recordingPending { Text(t("Booked shipment has pending recording in ReAI. Check its status before further action.")).foregroundStyle(.orange) }
        }
    }
    private func proposal(_ value: Binding<Draft>) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            DisclosureGroup(t("Recipient")) {
                VStack(spacing: 8) {
                    optionalField("Name", value.recipient.name); optionalField("Email", value.recipient.email)
                    optionalField("Phone", value.recipient.phone); optionalField("Address", value.recipient.addressPart1)
                    optionalField("Address 2", value.recipient.addressPart2)
                    HStack { optionalField("Postal code", value.recipient.postalCode); optionalField("City", value.recipient.city) }
                    optionalField("Country code", value.recipient.countryCode)
                }.padding(.top, 8)
            }
            Text([value.wrappedValue.recipient.name, value.wrappedValue.recipient.addressPart1, value.wrappedValue.recipient.postalCode, value.wrappedValue.recipient.city].compactMap { $0 }.joined(separator: ", ")).foregroundStyle(.secondary)
            if model.options?.weightEstimated == true { Label(t("Estimated weight. Weigh the actual parcel before shipping."), systemImage: "scalemass").font(.caption).foregroundStyle(.orange) }
            HStack {
                VStack(alignment: .leading) { Text(t("Weight (g)")).font(.caption); TextField(t("Weight (g)"), value: value.parcel.weightGrams, format: .number) }
                VStack(alignment: .leading) { Text(t("Length (cm)")).font(.caption); TextField(t("Length (cm)"), value: value.parcel.lengthCm, format: .number) }
                VStack(alignment: .leading) { Text(t("Width (cm)")).font(.caption); TextField(t("Width (cm)"), value: value.parcel.widthCm, format: .number) }
                VStack(alignment: .leading) { Text(t("Height (cm)")).font(.caption); TextField(t("Height (cm)"), value: value.parcel.heightCm, format: .number) }
            }.textFieldStyle(.roundedBorder)
            DisclosureGroup(t("Items in this parcel")) {
                ForEach(value.lines) { line in
                    HStack {
                        Text(model.options?.availableLines.first(where: { $0.orderLineId == line.wrappedValue.orderLineId })?.name ?? "#\(line.wrappedValue.orderLineId)")
                        Spacer()
                        TextField(t("Quantity"), value: line.quantity, format: .number).frame(width: 70)
                    }
                }
            }
            Button(t("Refresh shipping rates")) { Task { await model.refreshRates() } }
            if !model.rates.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text(t("Shipping service")).font(.headline)
                    ForEach(model.rates.filter { $0.status == "quoted" && $0.bookingBlockedReason == nil }) { rate in
                        Button { Task { await model.chooseRate(rate.id) } } label: {
                            HStack {
                                Image(systemName: model.selectedRate == rate.id ? "largecircle.fill.circle" : "circle")
                                Text(model.options?.services.first(where: { $0.id == rate.id }).map { $0.carrierName + " · " + $0.name } ?? rate.id)
                                Spacer()
                                Text(rate.quote?.display ?? "")
                            }.contentShape(Rectangle())
                        }.buttonStyle(.plain)
                    }
                }
            }
            if !model.pickups.isEmpty {
                Picker(t("Pickup place"), selection: Binding(get: { value.wrappedValue.pickupProviderId ?? "" }, set: { id in Task { await model.choosePickup(id) } })) {
                    Text(t("Choose pickup place")).tag("")
                    ForEach(model.pickups) { Text($0.displayName).tag($0.id) }
                }
            }
        }
        .disabled(model.busy || model.unfinished.contains { $0.orderId == model.selectedOrder?.id })
        .onChange(of: value.wrappedValue.recipient) { _, _ in model.invalidateQuote() }
        .onChange(of: value.wrappedValue.parcel) { _, _ in model.invalidateQuote() }
        .onChange(of: value.wrappedValue.lines) { _, _ in model.invalidateQuote() }
    }
    private func optionalField(_ title: String, _ value: Binding<String?>) -> some View {
        TextField(t(title), text: Binding(get: { value.wrappedValue ?? "" }, set: { value.wrappedValue = $0.isEmpty ? nil : $0 })).textFieldStyle(.roundedBorder)
    }
}
