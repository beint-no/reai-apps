import AppKit
import SwiftUI

final class ShippingAppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        Diagnostics.startSession()
    }
    func applicationWillTerminate(_ notification: Notification) {
        Diagnostics.endSession()
    }
}

@main
struct ShippingApp: App {
    @NSApplicationDelegateAdaptor(ShippingAppDelegate.self) private var appDelegate
    @State private var model: ShippingModel
    @StateObject private var updater: ShippingUpdater
    @Environment(\.openWindow) private var openWindow
    init() {
        let model = ShippingModel()
        _model = State(initialValue: model)
        _updater = StateObject(wrappedValue: ShippingUpdater(model: model))
    }

    var body: some Scene {
        Window("ReAI Shipping", id: "shipping") {
            ShippingView(model: model).disabled(updater.inProgress).frame(minWidth: 860, minHeight: 640).task { await model.start() }
        }.defaultSize(width: 980, height: 740)
        .commands {
            CommandGroup(after: .appInfo) {
                Button("Check for Updates…") { updater.check() }
                    .disabled(model.busy || model.loadingLocations || model.loadingPickups || model.connecting || !updater.canCheck)
            }
        }
        MenuBarExtra("ReAI Shipping", systemImage: "shippingbox") {
            Button("Open ReAI Shipping") { openWindow(id: "shipping"); NSApp.activate() }
            Button("Check for Updates…") { updater.check() }
                .disabled(model.busy || model.loadingLocations || model.loadingPickups || model.connecting || !updater.canCheck)
            Divider()
            Button("Quit") { NSApp.terminate(nil) }.disabled(model.busy)
        }
    }
}

struct ShippingView: View {
    @Bindable var model: ShippingModel
    @State private var reprint: PrintRecord?
    @State private var disconnect = false
    @State private var editingRecipient = false
    @State private var showingRecentPrints = false
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "shippingbox.fill").font(.title3).foregroundStyle(.teal)
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("ReAI Shipping").font(.headline)
                    Text(model.company?.companyName ?? "Connect once. Ship and print here.")
                        .font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                if model.company != nil {
                    Picker("Section", selection: $model.section) {
                        Text("Shipping").tag(AppSection.shipping)
                        Text(model.pickupCount > 0 ? "Click & Collect (\(model.pickupCount))" : "Click & Collect").tag(AppSection.pickup)
                        Text("Locations").tag(AppSection.locations)
                    }.pickerStyle(.segmented).labelsHidden().fixedSize()
                        .disabled(model.busy || model.loadingLocations || model.loadingPickups)
                }
                if model.busy { ProgressView().controlSize(.small) }
                if model.company != nil { Button("Disconnect") { disconnect = true }.controlSize(.small).disabled(model.busy) }
            }.padding(.horizontal, 14).padding(.vertical, 8)
            Divider()
            if model.company == nil { connection.padding(32); Spacer() }
            else {
                switch model.section {
                case .locations:
                    LocationLabelsView(model: model)
                case .pickup:
                    ClickAndCollectView(model: model)
                case .shipping:
                    HSplitView {
                        orderList.frame(minWidth: 190, idealWidth: 225, maxWidth: 270)
                        ScrollView { details.padding(16).frame(maxWidth: .infinity, alignment: .leading) }.frame(minWidth: 520)
                    }
                }
                Divider()
                HStack(spacing: 8) {
                    Label("Printer", systemImage: "printer").font(.callout)
                    Picker("Printer", selection: $model.printerId) {
                        Text("Choose a printer").tag("")
                        ForEach(model.printers) { Text($0.name).tag($0.id) }
                    }.labelsHidden().controlSize(.small).fixedSize().disabled(model.busy)
                    Button { Task { await model.refreshPrinters() } } label: { Image(systemName: "arrow.clockwise") }
                        .controlSize(.small).help("Refresh printers")
                    if model.printers.isEmpty {
                        Button("Add printer") {
                            if let url = URL(string: "x-apple.systempreferences:com.apple.Print-Scan-Settings.extension") {
                                NSWorkspace.shared.open(url)
                            }
                        }.controlSize(.small)
                    }
                    Spacer()
                    Text(footerCaption).font(.caption).foregroundStyle(.secondary)
                }.padding(.horizontal, 14).padding(.vertical, 8)
            }
            if let notice = model.notice { Label(notice, systemImage: "info.circle").font(.caption).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 14).padding(.bottom, 8) }
            if let error = model.error { Label(error, systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(.orange).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 14).padding(.bottom, 8) }
        }
        .onChange(of: model.selectedOrder?.id) { _, _ in editingRecipient = false }
        .confirmationDialog("Print again? Check the printer queue first.", isPresented: Binding(get: { reprint != nil }, set: { if !$0 { reprint = nil } })) {
            if let record = reprint { Button("Print again") { Task { await model.reprint(record) }; reprint = nil } }
        } message: {
            if let record = reprint { Text("\(record.copies ?? 1) × " + record.request.document.title) }
        }
        .confirmationDialog("Disconnect this Mac?", isPresented: $disconnect) {
            Button("Disconnect", role: .destructive) { Task { await model.disconnect() } }
        }
    }

    private var connection: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Open orders, shipping and labels in one place.").font(.title2)
            Text("Connect once and choose your company. Your password stays in the browser.").foregroundStyle(.secondary)
            Button("Connect to ReAI") { model.connect() }.buttonStyle(.borderedProminent).controlSize(.large).disabled(model.connecting)
            if model.connecting { HStack { ProgressView().controlSize(.small); Text(model.code).monospaced(); Button("Cancel") { Task { await model.disconnect() } } } }
            Text("Add your Zebra in macOS Printers & Scanners. A single Zebra is selected automatically.").font(.callout).foregroundStyle(.secondary)
        }
    }

    private var orderList: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text("Orders").font(.subheadline.weight(.semibold))
                Text("\(model.totalOrders)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                Spacer()
                if model.loadingOrders { ProgressView().controlSize(.mini) }
                Button { Task { await model.refreshOrders() } } label: { Image(systemName: "arrow.clockwise") }
                    .buttonStyle(.borderless).help("Refresh orders").disabled(model.busy)
            }.padding(.horizontal, 10).padding(.top, 8)
            Picker("Orders", selection: Binding(get: { model.showingHistory }, set: { history in
                Task { await model.changeOrderView(history: history) }
            })) {
                Text("Ready").tag(false)
                Text("History").tag(true)
            }.pickerStyle(.segmented).labelsHidden().controlSize(.small).frame(maxWidth: .infinity).padding(.horizontal, 10).disabled(model.busy || model.loadingOrders)
            HStack(spacing: 4) {
                TextField(model.showingHistory ? "Number, ID or link" : "Order or customer", text: $model.search)
                    .textFieldStyle(.roundedBorder).controlSize(.small)
                    .onSubmit { Task { await model.refreshOrders() } }
                Button { Task { await model.refreshOrders() } } label: { Image(systemName: "magnifyingglass") }
                    .controlSize(.small).help("Search orders").disabled(model.loadingOrders)
            }.padding(.horizontal, 10).disabled(model.busy)
            if !model.showingHistory {
                Toggle("Include older (>14d)", isOn: Binding(get: { model.includeOlderOrders }, set: { includeOlder in
                    Task { await model.changeOrderAge(includeOlder: includeOlder) }
                })).toggleStyle(.checkbox).controlSize(.small).font(.caption).foregroundStyle(.secondary)
                    .padding(.horizontal, 10).disabled(model.busy || model.loadingOrders)
            }
            if model.orders.isEmpty && !model.loadingOrders {
                Text(model.showingHistory ? "Search past orders by number, ID or link." : "No orders ready to ship.")
                    .font(.caption).foregroundStyle(.secondary).padding(.horizontal, 10).padding(.top, 4)
            }
            List {
                ForEach(model.orders) { order in
                    Button { Task { await model.select(order) } } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 4) {
                                Text(order.orderNumber).font(.callout.weight(.semibold)).lineLimit(1)
                                if order.preparedShipmentId != nil {
                                    Image(systemName: "shippingbox.fill").font(.caption2).foregroundStyle(.teal)
                                }
                                Spacer(minLength: 4)
                                Text(order.date).font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
                            }
                            Text(order.customerName).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }.padding(.vertical, 2).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                    }.buttonStyle(.plain)
                        .listRowBackground(model.selectedOrder?.id == order.id ? Color.accentColor.opacity(0.14) : Color.clear)
                        .disabled(model.busy)
                }
                if model.canLoadMore {
                    Button("Load more") { Task { await model.refreshOrders(more: true) } }
                        .controlSize(.small).disabled(model.busy || model.loadingOrders)
                }
            }.listStyle(.sidebar)
        }
    }

    @ViewBuilder private var details: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let order = model.selectedOrder {
                orderHeader(order)
                if let shipment = model.shipment {
                    itemsCard(model.displayedItems)
                    orderNotesBanner
                    primaryActionBar
                    savedShipmentCard(shipment)
                } else if let draft = model.draft {
                    draftSection(draft).id(order.id)
                } else {
                    itemsCard(model.displayedItems)
                    orderNotesBanner
                    if let reason = model.options?.unavailableReason {
                        Text(reason).font(.callout).foregroundStyle(.secondary)
                    }
                    primaryActionBar
                }
                if !model.savedShipments.isEmpty {
                    savedShipmentsBar
                }
            } else {
                ContentUnavailableView("Choose an order", systemImage: "shippingbox",
                                       description: Text("Pick an order on the left to see its items, warehouse locations and shipping label."))
                    .padding(.vertical, 24)
            }
            if !model.unfinished.isEmpty {
                unfinishedSection
            }
            recentPrintsSection
        }
    }

    private func orderHeader(_ order: ReadyOrder) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(order.orderNumber).font(.title2.bold())
            Text(order.customerName).font(.headline).foregroundStyle(.secondary).lineLimit(1)
            if let shipment = model.shipment {
                statusBadge(shipment.status)
            }
            if model.testMode {
                Text("Test mode").font(.caption2.weight(.semibold))
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Color.orange.opacity(0.16), in: Capsule())
                    .foregroundStyle(.orange)
            }
            Spacer(minLength: 8)
            if let company = model.company {
                Link("Open in ReAI", destination: AppEnvironment.origin.appending(path: "order/\(order.id)")
                    .appending(queryItems: [URLQueryItem(name: "tenantId", value: String(company.id))]))
                    .font(.caption)
            }
        }
    }

    private func statusBadge(_ status: String) -> some View {
        let color: Color = switch status {
        case "booked", "prepared": .teal
        case "failed", "outcome_unknown": .orange
        default: .secondary
        }
        return Text(statusTitle(status))
            .font(.caption.weight(.medium))
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background(color.opacity(0.14), in: Capsule())
            .foregroundStyle(color)
    }

    private var footerCaption: String {
        switch model.section {
        case .locations: "One copy · Actual label size"
        case .pickup: "One copy · 100 × 150 mm Click & Collect label"
        case .shipping: "One copy · Carrier PDF size"
        }
    }

    private func itemsCard(_ items: [OrderItem]) -> some View {
        OrderItemsCardView(items: items, loading: model.busy)
    }

    @ViewBuilder private var orderNotesBanner: some View {
        if let notes = model.orderNotes {
            HStack(alignment: .top, spacing: 6) {
                Image(systemName: "note.text").foregroundStyle(.secondary)
                Text(notes).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
            }
            .padding(.horizontal, 10).padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 6))
        }
    }

    private func locationBadges(_ locations: [OrderItemLocation]) -> some View {
        LocationBadgesView(locations: locations)
    }

    @ViewBuilder private var primaryActionBar: some View {
        if model.shipment?.status == "booked", model.shipment?.labelAvailable == true {
            VStack(alignment: .leading, spacing: 4) {
                Button { requestPrint() } label: {
                    Label("Print label", systemImage: "printer.fill").frame(maxWidth: .infinity)
                }.buttonStyle(.borderedProminent).controlSize(.large).disabled(!model.canPrint)
                Text(model.printerId.isEmpty ? "Choose a printer below to print." : "Sends one label to your printer.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        } else if !model.showingHistory && (model.draft != nil || model.shipment?.actions.contains("book") == true) {
            VStack(alignment: .leading, spacing: 4) {
                Button { Task { await model.shipAndPrint() } } label: {
                    Label("Ship & print" + (model.quote.map { " · " + $0.display } ?? ""), systemImage: "printer.fill").frame(maxWidth: .infinity)
                }.buttonStyle(.borderedProminent).controlSize(.large).disabled(!model.canShip)
                Text(model.printerId.isEmpty ? "Choose a printer below to ship and print." : "Books this parcel, updates ReAI and sends one label to your printer.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func savedShipmentCard(_ shipment: Shipment) -> some View {
        let recipientSummary = [shipment.recipient.name, shipment.recipient.addressPart1,
                                [shipment.recipient.postalCode, shipment.recipient.city].compactMap { $0 }.joined(separator: " ")]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: "person").font(.caption).foregroundStyle(.secondary)
                Text(recipientSummary).font(.callout).textSelection(.enabled)
                Spacer(minLength: 4)
            }
            HStack(spacing: 8) {
                Image(systemName: "scalemass").font(.caption).foregroundStyle(.secondary)
                Text("\(shipment.parcel.weightGrams) g · \(shipment.parcel.lengthCm.formatted()) × \(shipment.parcel.widthCm.formatted()) × \(shipment.parcel.heightCm.formatted()) cm")
                    .font(.caption).foregroundStyle(.secondary)
                if let amount = shipment.customerCharge.amount, let currency = shipment.customerCharge.currencyCode {
                    Text("·").foregroundStyle(.secondary)
                    Text("\(amount.formatted()) \(currency)").font(.callout.weight(.semibold))
                }
                Spacer(minLength: 8)
                if shipment.customsInvoiceAvailable == true, let company = model.company {
                    Link("Customs invoice (A4)", destination: customsInvoiceURL(shipmentId: shipment.id, tenantId: company.id))
                        .font(.caption)
                }
                if !model.showingHistory && shipment.actions.contains("cancel") {
                    Button("Cancel preparation") { Task { await model.cancelPreparation() } }
                        .controlSize(.small).disabled(model.busy)
                }
            }
            if let error = shipment.error {
                Text(error).font(.caption).foregroundStyle(.orange)
            }
            if shipment.inventoryRecordingPending || shipment.customerCharge.recordingPending {
                Text("Booked shipment has pending recording in ReAI. Check its status before further action.")
                    .font(.caption).foregroundStyle(.orange)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(Color.primary.opacity(0.025), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.primary.opacity(0.08)))
    }

    private func draftSection(_ draft: Draft) -> some View {
        let disabled = model.busy || model.unfinished.contains { $0.orderId == model.selectedOrder?.id }
        let recipientSummary = [draft.recipient.name, draft.recipient.addressPart1,
                                [draft.recipient.postalCode, draft.recipient.city].compactMap { $0 }.joined(separator: " ")]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
        let totalUnits = draft.lines.reduce(Decimal(0)) { $0 + $1.quantity }
        let quoted = model.rates.filter { $0.status == "quoted" && $0.bookingBlockedReason == nil }
        return VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Label("Items & locations", systemImage: "list.bullet.clipboard").font(.subheadline.weight(.semibold))
                    Spacer()
                    Text("\(formatQuantity(totalUnits)) \(totalUnits == 1 ? "pc" : "pcs") · \(draft.lines.count) \(draft.lines.count == 1 ? "line" : "lines")")
                        .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(Color.primary.opacity(0.03))
                Divider()
                ForEach(Array(draft.lines.enumerated()), id: \.offset) { index, line in
                    let info = model.draftLineInfo(for: line)
                    if index > 0 { Divider().padding(.leading, 12) }
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(alignment: .center, spacing: 8) {
                            TextField("Qty", value: lineQuantityBinding(for: line), format: .number)
                                .textFieldStyle(.roundedBorder).controlSize(.small)
                                .multilineTextAlignment(.trailing).frame(width: 52)
                            Text("×").font(.callout.weight(.semibold)).foregroundStyle(.secondary)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(info.title).font(.body.weight(.semibold)).textSelection(.enabled)
                                if let sku = info.sku, !sku.isEmpty {
                                    Text(sku).font(.caption.monospaced()).foregroundStyle(.secondary).textSelection(.enabled)
                                }
                            }
                            Spacer(minLength: 10)
                            if info.bundleComponents.isEmpty {
                                locationBadges(info.locations)
                            }
                        }
                        if !info.bundleComponents.isEmpty {
                            VStack(alignment: .leading, spacing: 4) {
                                ForEach(info.bundleComponents) { component in
                                    HStack(alignment: .top, spacing: 8) {
                                        Text("\(formatQuantity(component.quantity))×")
                                            .font(.caption.weight(.semibold).monospacedDigit())
                                            .foregroundStyle(.secondary)
                                            .frame(minWidth: 28, alignment: .trailing)
                                        VStack(alignment: .leading, spacing: 1) {
                                            Text(component.title).font(.callout)
                                            if let sku = component.sku, !sku.isEmpty {
                                                Text(sku).font(.caption2.monospaced()).foregroundStyle(.secondary)
                                            }
                                        }
                                        Spacer(minLength: 8)
                                        locationBadges(component.locations)
                                    }
                                }
                            }
                            .padding(.leading, 68)
                        }
                    }
                    .padding(.horizontal, 12).padding(.vertical, 8)
                }
            }
            .background(Color.primary.opacity(0.025), in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.primary.opacity(0.09)))

            orderNotesBanner

            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: "person").font(.caption).foregroundStyle(.secondary)
                    Text(recipientSummary.isEmpty ? "Incomplete recipient" : recipientSummary)
                        .font(.callout).foregroundStyle(recipientSummary.isEmpty ? .orange : .primary).lineLimit(1)
                    Spacer()
                    Button(editingRecipient ? "Done" : "Edit recipient") { editingRecipient.toggle() }
                        .controlSize(.small)
                }
                if editingRecipient {
                    VStack(spacing: 6) {
                        HStack(spacing: 6) {
                            recipientField("Name", \.name, fallback: draft.recipient.name)
                            recipientField("Email", \.email, fallback: draft.recipient.email)
                            recipientField("Phone", \.phone, fallback: draft.recipient.phone)
                        }
                        HStack(spacing: 6) {
                            recipientField("Address", \.addressPart1, fallback: draft.recipient.addressPart1)
                            recipientField("Address 2", \.addressPart2, fallback: draft.recipient.addressPart2)
                        }
                        HStack(spacing: 6) {
                            recipientField("Postal code", \.postalCode, fallback: draft.recipient.postalCode)
                            recipientField("City", \.city, fallback: draft.recipient.city)
                            recipientField("Country", \.countryCode, fallback: draft.recipient.countryCode).frame(maxWidth: 80)
                        }
                    }.controlSize(.small)
                }
                Divider()
                HStack(spacing: 8) {
                    compactNumber("Weight (g)", value: parcelIntBinding(\.weightGrams, fallback: draft.parcel.weightGrams))
                    compactDecimal("Length (cm)", value: parcelDecimalBinding(\.lengthCm, fallback: draft.parcel.lengthCm))
                    compactDecimal("Width (cm)", value: parcelDecimalBinding(\.widthCm, fallback: draft.parcel.widthCm))
                    compactDecimal("Height (cm)", value: parcelDecimalBinding(\.heightCm, fallback: draft.parcel.heightCm))
                }.textFieldStyle(.roundedBorder).controlSize(.small)
                if model.options?.weightEstimated == true {
                    Label("Estimated weight. Weigh the actual parcel before shipping.", systemImage: "scalemass")
                        .font(.caption).foregroundStyle(.orange)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            .background(Color.primary.opacity(0.025), in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.primary.opacity(0.08)))

            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Shipping service").font(.subheadline.weight(.semibold))
                    Spacer()
                    Button("Refresh rates") { Task { await model.refreshRates() } }.controlSize(.small)
                }
                ForEach(Array(quoted.enumerated()), id: \.offset) { _, rate in
                    Button { Task { await model.chooseRate(rate.id) } } label: {
                        HStack(spacing: 6) {
                            Image(systemName: model.selectedRate == rate.id ? "largecircle.fill.circle" : "circle")
                                .foregroundStyle(model.selectedRate == rate.id ? .teal : .secondary)
                            Text(model.options?.services.first(where: { $0.id == rate.service }).map { $0.carrierName + " · " + (rate.name ?? $0.name) } ?? rate.name ?? rate.service)
                                .font(.callout)
                            Spacer()
                            Text(rate.quote?.display ?? "").font(.callout.weight(.medium).monospacedDigit())
                        }.padding(.vertical, 2).contentShape(Rectangle())
                    }.buttonStyle(.plain)
                }
                if !model.pickups.isEmpty {
                    Picker("Pickup place", selection: Binding(
                        get: { model.draft?.pickupProviderId ?? draft.pickupProviderId ?? "" },
                        set: { id in Task { await model.choosePickup(id) } }
                    )) {
                        Text("Choose pickup place").tag("")
                        ForEach(model.pickups) { Text($0.displayName).tag($0.id) }
                    }.controlSize(.small)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            .background(Color.primary.opacity(0.025), in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.primary.opacity(0.08)))

            primaryActionBar
        }
        .disabled(disabled)
    }

    private func lineQuantityBinding(for line: ShipmentLine) -> Binding<Decimal> {
        let lineId = line.orderLineId
        let fallback = line.quantity
        return Binding(
            get: { model.draft?.lines.first(where: { $0.orderLineId == lineId })?.quantity ?? fallback },
            set: { model.updateDraftLineQuantity(orderLineId: lineId, quantity: $0) }
        )
    }

    private func recipientField(_ title: String, _ keyPath: WritableKeyPath<Recipient, String?>, fallback: String?) -> some View {
        TextField(title, text: Binding(
            get: { (model.draft?.recipient[keyPath: keyPath] ?? fallback) ?? "" },
            set: { newValue in
                let value = newValue.isEmpty ? nil : newValue
                model.updateDraftRecipient { $0[keyPath: keyPath] = value }
            }
        )).textFieldStyle(.roundedBorder)
    }

    private func parcelIntBinding(_ keyPath: WritableKeyPath<Parcel, Int>, fallback: Int) -> Binding<Int> {
        Binding(
            get: { model.draft?.parcel[keyPath: keyPath] ?? fallback },
            set: { newValue in model.updateDraftParcel { $0[keyPath: keyPath] = newValue } }
        )
    }

    private func parcelDecimalBinding(_ keyPath: WritableKeyPath<Parcel, Decimal>, fallback: Decimal) -> Binding<Decimal> {
        Binding(
            get: { model.draft?.parcel[keyPath: keyPath] ?? fallback },
            set: { newValue in model.updateDraftParcel { $0[keyPath: keyPath] = newValue } }
        )
    }

    private var savedShipmentsBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Text("Saved shipments").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                ForEach(model.savedShipments) { s in
                    Button { Task { await model.chooseShipment(s.id) } } label: {
                        HStack(spacing: 4) {
                            Image(systemName: model.shipment?.id == s.id ? "largecircle.fill.circle" : "circle").font(.caption2)
                            Text("#\(s.id) · " + statusTitle(s.status)).font(.caption)
                        }
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background(model.shipment?.id == s.id ? Color.accentColor.opacity(0.14) : Color.primary.opacity(0.04), in: Capsule())
                    }.buttonStyle(.plain).disabled(model.busy)
                }
                if model.shipmentBeforeId != nil {
                    Button("More…") { Task { await model.loadMoreShipments() } }.controlSize(.mini).disabled(model.busy)
                }
            }
        }
    }

    private var unfinishedSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Divider()
            Text("Shipping requests to check").font(.subheadline.weight(.semibold))
            ForEach(model.unfinished) { op in
                HStack {
                    Text("Order #\(op.orderId)").font(.callout)
                    Spacer()
                    if ["rejected", "failed"].contains(op.state) {
                        Button("Review parcel again") { Task { await model.review(op) } }.controlSize(.small).disabled(model.busy)
                    } else {
                        Button("Resume safely") { Task { await model.resume(op) } }.controlSize(.small).disabled(!model.canPrint)
                    }
                }
            }
            Text("Resume checks the saved request and shipment before continuing. It never creates a replacement after an uncertain response.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private var recentPrintsSection: some View {
        let companyRecords = model.records.filter { $0.request.tenantId == model.company?.id }
        return DisclosureGroup(isExpanded: $showingRecentPrints) {
            VStack(alignment: .leading, spacing: 6) {
                if companyRecords.isEmpty {
                    Text("Printed documents will appear here.").font(.caption).foregroundStyle(.secondary)
                } else {
                    ForEach(companyRecords.prefix(10)) { record in
                        HStack(spacing: 8) {
                            Text("Shipment #\(record.request.shipmentId)").font(.callout)
                            Text("\(record.copies ?? 1) × " + record.request.document.title).font(.caption).foregroundStyle(.secondary)
                            if let printer = record.printerId {
                                Text(printer.replacingOccurrences(of: "_", with: " ")).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                            Text(record.state == "queued" ? "In queue" : "Check queue").font(.caption).foregroundStyle(.secondary)
                            Spacer()
                            if record.request.document == .label {
                                Button("Reprint") { reprint = record }.controlSize(.small).disabled(!model.canPrint)
                            } else {
                                Link("Open in ReAI", destination: customsInvoiceURL(shipmentId: record.request.shipmentId, tenantId: record.request.tenantId))
                                    .font(.caption)
                            }
                        }
                    }
                }
            }.padding(.top, 6)
        } label: {
            HStack(spacing: 6) {
                Text("Recent prints").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                if !companyRecords.isEmpty {
                    Text("(\(min(companyRecords.count, 10)))").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    private func compactNumber(_ title: String, value: Binding<Int>) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption2).foregroundStyle(.secondary)
            TextField(title, value: value, format: .number)
        }
    }

    private func compactDecimal(_ title: String, value: Binding<Decimal>) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption2).foregroundStyle(.secondary)
            TextField(title, value: value, format: .number)
        }
    }

    private func formatQuantity(_ value: Decimal) -> String {
        NSDecimalNumber(decimal: value).stringValue
    }

    private func requestPrint() {
        guard let record = model.selectedPrintRecord else { return }
        if model.records.contains(where: { $0.id == record.id }) { reprint = record }
        else { Task { await model.reprint(record) } }
    }

    private func customsInvoiceURL(shipmentId: Int, tenantId: Int) -> URL {
        AppEnvironment.origin.appending(path: "shipments/\(shipmentId)/customs-invoice/preview")
            .appending(queryItems: [URLQueryItem(name: "tenantId", value: String(tenantId))])
    }
}

struct OrderItemsCardView: View {
    let items: [OrderItem]
    let loading: Bool

    var body: some View {
        let totalUnits = items.reduce(Decimal(0)) { $0 + $1.quantity }
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Label("Items & locations", systemImage: "list.bullet.clipboard").font(.subheadline.weight(.semibold))
                Spacer()
                if !items.isEmpty {
                    Text("\(NSDecimalNumber(decimal: totalUnits).stringValue) \(totalUnits == 1 ? "pc" : "pcs") · \(items.count) \(items.count == 1 ? "line" : "lines")")
                        .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(Color.primary.opacity(0.03))
            Divider()
            if items.isEmpty {
                Text(loading ? "Loading items and locations…" : "No items listed for this order.")
                    .font(.callout).foregroundStyle(.secondary)
                    .padding(.horizontal, 12).padding(.vertical, 10)
            } else {
                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                    if index > 0 { Divider().padding(.leading, 12) }
                    HStack(alignment: .top, spacing: 10) {
                        Text("\(NSDecimalNumber(decimal: item.quantity).stringValue)×")
                            .font(.headline.monospacedDigit())
                            .frame(minWidth: 36, alignment: .trailing)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.title).font(.body.weight(.semibold)).textSelection(.enabled)
                            HStack(spacing: 8) {
                                if let sku = item.sku, !sku.isEmpty {
                                    Text(sku).font(.caption.monospaced()).foregroundStyle(.secondary).textSelection(.enabled)
                                }
                                if let bundle = item.bundleTitle, !bundle.isEmpty {
                                    Text("Bundle: \(bundle)").font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                        Spacer(minLength: 10)
                        LocationBadgesView(locations: item.locations)
                    }
                    .padding(.horizontal, 12).padding(.vertical, 8)
                }
            }
        }
        .background(Color.primary.opacity(0.025), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.primary.opacity(0.09)))
    }
}

struct LocationBadgesView: View {
    let locations: [OrderItemLocation]

    var body: some View {
        VStack(alignment: .trailing, spacing: 3) {
            if locations.isEmpty {
                Text("No location").font(.caption).foregroundStyle(.secondary)
            } else {
                ForEach(Array(locations.enumerated()), id: \.offset) { _, location in
                    if location.isPrimary {
                        HStack(spacing: 4) {
                            Image(systemName: "mappin.and.ellipse").font(.caption).foregroundStyle(.teal)
                            Text(location.label).font(.callout.weight(.semibold))
                            if let stock = location.stockText {
                                Text("(\(stock))").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                            }
                        }
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Color.teal.opacity(0.13), in: RoundedRectangle(cornerRadius: 6))
                        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.teal.opacity(0.32)))
                    } else {
                        HStack(spacing: 4) {
                            Text(location.label).font(.caption.weight(.medium)).foregroundStyle(.secondary)
                            if let stock = location.stockText {
                                Text("(\(stock))").font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        }
    }
}
