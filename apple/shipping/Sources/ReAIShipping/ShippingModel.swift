import AppKit
import Foundation
import Observation

struct PrintRecord: Codable, Identifiable {
    var id: String { request.key }
    let request: PrintRequest
    var state: String
    var queueResult: String?
    var printerId: String?
    var copies: Int?
}

struct ShippingOperation: Codable, Identifiable {
    let id: UUID
    let tenantId: Int
    let orderId: Int
    var draft: Draft?
    var shipmentId: Int?
    var state: String
}

struct OrderItemLocation: Equatable, Hashable, Sendable {
    let label: String
    let stockText: String?
    let isPrimary: Bool
}

struct OrderItem: Identifiable, Equatable, Sendable {
    let id: String
    let orderLineId: Int?
    let title: String
    let sku: String?
    let bundleTitle: String?
    let quantity: Decimal
    let locations: [OrderItemLocation]
}

struct DraftLineInfo: Sendable {
    let title: String
    let sku: String?
    let locations: [OrderItemLocation]
    let bundleComponents: [OrderItem]
}

private struct OrderItemContext: Sendable {
    let picking: CommercePickingDetail?
    let order: OrderDetail?
    let stockByVariant: [Int: [ItemLocation]]
}

enum AppSection: Hashable, Sendable {
    case shipping
    case pickup
    case locations
}

@MainActor @Observable
final class ShippingModel {
    var section: AppSection = .shipping
    var showingLocations: Bool { section == .locations }
    var pickupCount = 0
    var loadingPickups = false
    var pickupOrders: [CommercePickingOrder] = []
    var pickupSearch = ""
    var pickupPage = 0
    var pickupTotalPages = 0
    var pickupTotalOrders = 0
    var canLoadMorePickups: Bool { pickupPage + 1 < pickupTotalPages }
    var selectedPickupOrder: CommercePickingOrder?
    var selectedPickupDetail: CommercePickingDetail?
    var pickupRecords: [PickupPrintRecord] = []
    private var pickupJournal: URL { journal.deletingLastPathComponent().appending(path: "pickup-print-history.json") }
    var warehouses: [Warehouse] = []
    var warehouseId = 0
    var locationZoneId = 0
    var locationSearch = ""
    var locations: [WarehouseLocation] = []
    var locationZones: [WarehouseZone] = []
    var loadingLocations = false
    var locationRecords: [LocationPrintRecord] = []
    var labelSize: LocationLabelSize = .small {
        didSet { UserDefaults.standard.set(labelSize.rawValue, forKey: "shipping.locationLabelSize") }
    }
    private var locationJournal: URL { journal.deletingLastPathComponent().appending(path: "location-print-history.json") }
    var company: Company?
    var connecting = false
    var busy = false
    var code = ""
    var error: String?
    var notice: String?
    var printers: [Printer] = []
    var printerId: String {
        didSet { UserDefaults.standard.set(printerId, forKey: "shipping.printer") }
    }
    var records: [PrintRecord] = []
    var loadingOrders = false
    var orders: [ReadyOrder] = []
    var search = ""
    var showingHistory = false
    var includeOlderOrders = false
    private var readyFromDate = ""
    var historyBeforeId: Int?
    var savedShipments: [ShipmentSummary] = []
    var shipmentBeforeId: Int?
    var canLoadMore: Bool { showingHistory ? historyBeforeId != nil : page + 1 < totalPages }
    var selectedPrintRecord: PrintRecord? {
        guard let company, let shipment else { return nil }
        return PrintRecord(request: PrintRequest(tenantId: company.id, shipmentId: shipment.id),
                           state: "saved", copies: 1)
    }
    var page = 0
    var totalPages = 0
    var totalOrders = 0
    var selectedOrder: ReadyOrder?
    var options: ShippingOptions?
    var draft: Draft?
    var rates: [Rate] = []
    var selectedRate = ""
    var pickups: [Pickup] = []
    var quote: Quote?
    var shipment: Shipment?
    var pickingDetail: CommercePickingDetail?
    var orderDetail: OrderDetail?
    var stockByVariant: [Int: [ItemLocation]] = [:]
    var operations: [ShippingOperation] = []
    private var bookingJournal: URL { journal.deletingLastPathComponent().appending(path: "shipping-operations.json") }
    var unfinished: [ShippingOperation] { operations.filter { $0.tenantId == company?.id && $0.state != "done" } }
    var testMode: Bool {
        let carrier = shipment?.carrierCode ?? draft?.carrierCode
        return options?.services.first(where: { $0.carrierCode == carrier })?.testMode ?? false
    }
    var canPrint: Bool { historyReadable && !busy && !printerId.isEmpty }
    var canShip: Bool {
        !showingHistory && canPrint && !unfinished.contains { $0.orderId == selectedOrder?.id } &&
            (shipment?.actions.contains("book") == true || (shipment?.status == "booked" && shipment?.labelAvailable == true) || quote != nil)
    }

    private let api = ReAIAPI()
    private let credentials = Credentials()
    private let printer = LabelPrinter()
    private var token: String?
    private var initialized = false
    private var historyReadable = true
    private var initialization: Task<Void, Never>?
    private var connectionTask: Task<Void, Never>?
    private let journal: URL

    init() {
        labelSize = LocationLabelSize(rawValue: UserDefaults.standard.string(forKey: "shipping.locationLabelSize") ?? "") ?? .small
        printerId = ["shipping.printer", "shipping.documentPrinter"].compactMap { UserDefaults.standard.string(forKey: $0) }.first { !$0.isEmpty } ?? ""
        journal = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appending(path: "ReAI Shipping/print-history.json")
        do {
            if FileManager.default.fileExists(atPath: journal.path) {
                records = try JSONDecoder().decode([PrintRecord].self, from: Data(contentsOf: journal))
                if records.contains(where: { $0.state == "submitting" }) {
                    notice = "A previous print was interrupted. Check the printer queue before reprinting."
                }
            }
            if FileManager.default.fileExists(atPath: locationJournal.path) {
                locationRecords = try JSONDecoder().decode([LocationPrintRecord].self, from: Data(contentsOf: locationJournal))
                if locationRecords.contains(where: { $0.state == "submitting" }) {
                    notice = "A previous print was interrupted. Check the printer queue before reprinting."
                }
            }
            if FileManager.default.fileExists(atPath: pickupJournal.path) {
                pickupRecords = try JSONDecoder().decode([PickupPrintRecord].self, from: Data(contentsOf: pickupJournal))
                if pickupRecords.contains(where: { $0.state == "submitting" }) {
                    notice = "A previous print was interrupted. Check the printer queue before reprinting."
                }
            }
            if FileManager.default.fileExists(atPath: bookingJournal.path) {
                operations = try JSONDecoder().decode([ShippingOperation].self, from: Data(contentsOf: bookingJournal))
            }
        } catch {
            Diagnostics.recordError(operation: "read-journals", error: error)
            historyReadable = false
            self.error = "Shipping history could not be read. Shipping and printing are paused to prevent duplicates."
        }
    }

    func start() async {
        if let initialization { await initialization.value; return }
        guard !initialized else { return }
        let task = Task { await restore() }
        initialization = task
        await task.value
        initialized = true
        initialization = nil
    }

    private func restore() async {
        do {
            await refreshPrinters()
            if let saved = try await credentials.load() {
                company = try await api.account(token: saved)
                token = saved
                await refreshOrders()
                await refreshPickupSummary()
            }
        } catch { self.error = error.localizedDescription }
    }

    func connect() {
        guard !connecting, !busy else { return }
        connecting = true
        error = nil
        connectionTask = Task { [self] in
            defer { connecting = false; code = ""; connectionTask = nil }
            do {
                let key = try await Connection().authorize { [weak self] code in
                    await MainActor.run { self?.code = code }
                }
                let approved = try await api.account(token: key)
                try Task.checkCancellation()
                try await credentials.save(key)
                try Task.checkCancellation()
                token = key
                company = approved
                notice = "Connected. Choose an order to ship."
                await refreshOrders()
                await refreshPickupSummary()
            } catch is CancellationError {
            } catch { self.error = error.localizedDescription }
        }
    }

    func disconnect() async {
        guard !busy else { return }
        connectionTask?.cancel()
        do {
            try await credentials.delete()
            token = nil
            company = nil
            section = .shipping
            pickupCount = 0; pickupOrders = []; pickupSearch = ""; pickupPage = 0; pickupTotalPages = 0; pickupTotalOrders = 0
            selectedPickupOrder = nil; selectedPickupDetail = nil
            warehouses = []; warehouseId = 0; locations = []; locationZones = []; locationZoneId = 0; locationSearch = ""
            savedShipments = []; historyBeforeId = nil; shipmentBeforeId = nil
            orders = []; selectedOrder = nil; options = nil; draft = nil; shipment = nil; quote = nil
            pickingDetail = nil; orderDetail = nil; stockByVariant = [:]
            notice = nil
        } catch { self.error = error.localizedDescription }
    }

    func refreshPrinters() async {
        do {
            printers = try await printer.printers()
            if printerId.isEmpty {
                let zebras = printers.filter(\.isZebra)
                if zebras.count == 1 { printerId = zebras[0].id }
            }
        } catch { self.error = error.localizedDescription }
    }

    func changeOrderView(history: Bool) async {
        guard !busy, !loadingOrders else { return }
        showingHistory = history
        historyBeforeId = nil; shipmentBeforeId = nil; error = nil; notice = nil
        orders = []; selectedOrder = nil; options = nil; draft = nil; shipment = nil; savedShipments = []; quote = nil
        pickingDetail = nil; orderDetail = nil; stockByVariant = [:]
        await refreshOrders()
    }

    func changeOrderAge(includeOlder: Bool) async {
        guard !busy, !loadingOrders else { return }
        includeOlderOrders = includeOlder
        await changeOrderView(history: false)
    }

    static func readyOrderStart(includeOlder: Bool, now: Date = .now, calendar: Calendar = .current) -> String {
        if includeOlder { return "1900-01-01" }
        let cutoff = calendar.date(byAdding: .day, value: -14, to: now) ?? now
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: cutoff)
    }

    private static func uniqueOrders(_ items: [ReadyOrder], existing: [ReadyOrder] = []) -> [ReadyOrder] {
        var seen = Set(existing.map(\.id))
        return existing + items.filter { seen.insert($0.id).inserted }
    }

    func refreshOrders(more: Bool = false) async {
        guard !loadingOrders, let token, let company else { return }
        loadingOrders = true
        defer { loadingOrders = false }
        do {
            if showingHistory {
                let result = try await api.history(token: token, company: company.id, search: search, beforeId: more ? historyBeforeId : nil)
                guard self.company?.id == company.id else { return }
                orders = Self.uniqueOrders(result.items, existing: more ? orders : [])
                historyBeforeId = result.nextBeforeId
                totalOrders = orders.count
                return
            }
            if !more { readyFromDate = Self.readyOrderStart(includeOlder: includeOlderOrders) }
            let result = try await api.orders(token: token, company: company.id, search: search,
                                              page: more ? page + 1 : 0, from: readyFromDate)
            guard self.company?.id == company.id else { return }
            orders = Self.uniqueOrders(result.items, existing: more ? orders : [])
            page = result.page - 1; totalPages = result.totalPages; totalOrders = result.totalItems
        } catch {
            Diagnostics.recordError(operation: "refresh-orders", error: error)
            self.error = error.localizedDescription
        }
    }

    func select(_ order: ReadyOrder) async {
        guard !busy, let token, let company else { return }
        busy = true
        defer { busy = false }
        savedShipments = []; shipmentBeforeId = nil
        selectedOrder = order; options = nil; draft = nil; rates = []; pickups = []; quote = nil; shipment = nil
        pickingDetail = nil; orderDetail = nil; stockByVariant = [:]
        error = nil; notice = nil
        let isHistory = showingHistory
        let api = self.api
        async let itemContext = Self.loadOrderItems(api: api, orderId: order.id, isHistory: isHistory, token: token, company: company.id)
        do {
            let history = try await api.shipments(order: order.id, token: token, company: company.id)
            savedShipments = history.items; shipmentBeforeId = history.nextBeforeId
            if showingHistory {
                if let id = savedShipments.first(where: { $0.status == "booked" })?.id ?? savedShipments.first?.id {
                    shipment = try await api.shipment(id, token: token, company: company.id)
                } else { notice = "No saved shipping labels for this order." }
            } else if let saved = unfinished.first(where: { $0.orderId == order.id }) {
                if let id = saved.shipmentId { shipment = try await api.shipment(id, token: token, company: company.id) }
                else { draft = saved.draft; notice = "A saved shipping request needs checking. Use Resume below." }
            } else if let id = order.preparedShipmentId {
                shipment = try await api.shipment(id, token: token, company: company.id)
            } else {
                let result = try await api.options(order: order.id, token: token, company: company.id)
                options = result
                if let id = result.existingShipments.items.first(where: { $0.status == "prepared" })?.id {
                    shipment = try await api.shipment(id, token: token, company: company.id)
                } else {
                    draft = result.defaults
                    if draft != nil { try await loadRates(token: token, company: company.id) }
                }
            }
        } catch {
            Diagnostics.recordError(operation: "select-order", error: error)
            self.error = error.localizedDescription
        }
        let context = await itemContext
        guard selectedOrder?.id == order.id else { return }
        pickingDetail = context.picking
        orderDetail = context.order
        stockByVariant = context.stockByVariant
        await ensureFallbackOrderItemsIfNeeded(orderId: order.id, token: token, company: company.id)
    }

    func loadMoreShipments() async {
        guard !busy, let token, let company, let order = selectedOrder, let beforeId = shipmentBeforeId else { return }
        busy = true; defer { busy = false }
        do {
            let result = try await api.shipments(order: order.id, beforeId: beforeId, token: token, company: company.id)
            let known = Set(savedShipments.map(\.id))
            savedShipments += result.items.filter { !known.contains($0.id) }
            shipmentBeforeId = result.nextBeforeId
        } catch { self.error = error.localizedDescription }
    }

    func chooseShipment(_ id: Int) async {
        guard !busy, let token, let company else { return }
        busy = true; defer { busy = false }
        error = nil; notice = nil
        do {
            shipment = try await api.shipment(id, token: token, company: company.id); draft = nil; quote = nil
            if let orderId = selectedOrder?.id {
                await ensureFallbackOrderItemsIfNeeded(orderId: orderId, token: token, company: company.id)
            }
        } catch { self.error = error.localizedDescription }
    }

    private func ensureFallbackOrderItemsIfNeeded(orderId: Int, token: String, company: Int) async {
        guard orderDetail == nil, let picking = pickingDetail else { return }
        let pickedLineIds = Set(picking.lines.map(\.orderLineId))
        let referencedIds: [Int] = if let shipment {
            shipment.lines.compactMap(\.orderLineId)
        } else if let draft {
            draft.lines.map(\.orderLineId)
        } else { [] }
        guard referencedIds.contains(where: { !pickedLineIds.contains($0) }) else { return }
        let fallback = await Self.loadFallbackOrderItems(api: api, orderId: orderId, token: token, company: company)
        guard selectedOrder?.id == orderId else { return }
        orderDetail = fallback.order
        stockByVariant = fallback.stockByVariant
    }

    private nonisolated static func loadOrderItems(api: ReAIAPI, orderId: Int, isHistory: Bool, token: String, company: Int) async -> OrderItemContext {
        if !isHistory, let picking = try? await api.pickingDetail(order: orderId, token: token, company: company) {
            return OrderItemContext(picking: picking, order: nil, stockByVariant: [:])
        }
        return await loadFallbackOrderItems(api: api, orderId: orderId, token: token, company: company)
    }

    private nonisolated static func loadFallbackOrderItems(api: ReAIAPI, orderId: Int, token: String, company: Int) async -> OrderItemContext {
        guard let order = try? await api.orderDetail(order: orderId, token: token, company: company) else {
            return OrderItemContext(picking: nil, order: nil, stockByVariant: [:])
        }
        let variantIds = order.lines.compactMap(\.variantId)
        let items = (try? await api.warehouseItems(variantIds: variantIds, token: token, company: company)) ?? []
        let byVariant = Dictionary(items.map { ($0.variantId, $0.locations) }, uniquingKeysWith: { first, _ in first })
        return OrderItemContext(picking: nil, order: order, stockByVariant: byVariant)
    }

    var orderNotes: String? {
        if let notes = pickingDetail?.notes?.trimmingCharacters(in: .whitespacesAndNewlines), !notes.isEmpty {
            return notes
        }
        let parts = [orderDetail?.comment, orderDetail?.internalComment]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        var seen = Set<String>()
        let unique = parts.filter { seen.insert($0).inserted }
        return unique.isEmpty ? nil : unique.joined(separator: " · ")
    }

    var displayedItems: [OrderItem] {
        if let shipment, !shipment.lines.isEmpty {
            var rows: [OrderItem] = []
            for (index, line) in shipment.lines.enumerated() {
                if let orderLineId = line.orderLineId,
                   let pickingLines = pickingDetail?.lines.filter({ $0.orderLineId == orderLineId }),
                   !pickingLines.isEmpty {
                    if pickingLines.count == 1, pickingLines[0].bundleTitle == nil {
                        let pickLine = pickingLines[0]
                        rows.append(OrderItem(
                            id: "\(orderLineId)-\(pickLine.variantId)-\(index)",
                            orderLineId: orderLineId,
                            title: pickLine.title,
                            sku: pickLine.sku,
                            bundleTitle: nil,
                            quantity: line.quantity,
                            locations: Self.formatLocations(pick: pickLine.pick, raw: pickLine.locations)
                        ))
                    } else {
                        for (componentIndex, pickLine) in pickingLines.enumerated() {
                            rows.append(OrderItem(
                                id: "\(orderLineId)-\(pickLine.variantId)-\(index)-\(componentIndex)",
                                orderLineId: orderLineId,
                                title: pickLine.title,
                                sku: pickLine.sku,
                                bundleTitle: pickLine.bundleTitle,
                                quantity: pickLine.quantity,
                                locations: Self.formatLocations(pick: pickLine.pick, raw: pickLine.locations)
                            ))
                        }
                    }
                } else {
                    let orderLine = line.orderLineId.flatMap { id in orderDetail?.lines.first(where: { $0.id == id }) }
                    let rawLocations = orderLine?.variantId.flatMap { stockByVariant[$0] } ?? []
                    rows.append(OrderItem(
                        id: "\(line.orderLineId ?? 0)-\(index)",
                        orderLineId: line.orderLineId,
                        title: line.name,
                        sku: orderLine?.sku,
                        bundleTitle: nil,
                        quantity: line.quantity,
                        locations: Self.formatLocations(pick: nil, raw: rawLocations)
                    ))
                }
            }
            return rows
        }
        if let picking = pickingDetail, !picking.lines.isEmpty {
            return picking.lines.enumerated().map { index, line in
                OrderItem(
                    id: "\(line.orderLineId)-\(line.variantId)-\(index)",
                    orderLineId: line.orderLineId,
                    title: line.title,
                    sku: line.sku,
                    bundleTitle: line.bundleTitle,
                    quantity: line.quantity,
                    locations: Self.formatLocations(pick: line.pick, raw: line.locations)
                )
            }
        }
        if let order = orderDetail {
            let positive = order.lines.filter { $0.quantity > 0 }
            let stockLines = positive.filter { $0.variantId != nil }
            let source = stockLines.isEmpty ? positive : stockLines
            return source.enumerated().map { index, line in
                let rawLocations = line.variantId.flatMap { stockByVariant[$0] } ?? []
                return OrderItem(
                    id: "\(line.id)-\(index)",
                    orderLineId: line.id,
                    title: line.itemName,
                    sku: line.sku,
                    bundleTitle: nil,
                    quantity: line.quantity,
                    locations: Self.formatLocations(pick: nil, raw: rawLocations)
                )
            }
        }
        return []
    }

    func draftLineInfo(for line: ShipmentLine) -> DraftLineInfo {
        let fallbackName = options?.availableLines.first(where: { $0.orderLineId == line.orderLineId })?.name
            ?? orderDetail?.lines.first(where: { $0.id == line.orderLineId })?.itemName
            ?? "#\(line.orderLineId)"
        if let pickingLines = pickingDetail?.lines.filter({ $0.orderLineId == line.orderLineId }), !pickingLines.isEmpty {
            if pickingLines.count == 1, pickingLines[0].bundleTitle == nil {
                let pickLine = pickingLines[0]
                return DraftLineInfo(
                    title: pickLine.title,
                    sku: pickLine.sku,
                    locations: Self.formatLocations(pick: pickLine.pick, raw: pickLine.locations),
                    bundleComponents: []
                )
            }
            let components = pickingLines.enumerated().map { index, pickLine in
                OrderItem(
                    id: "\(line.orderLineId)-\(pickLine.variantId)-\(index)",
                    orderLineId: line.orderLineId,
                    title: pickLine.title,
                    sku: pickLine.sku,
                    bundleTitle: pickLine.bundleTitle,
                    quantity: pickLine.quantity,
                    locations: Self.formatLocations(pick: pickLine.pick, raw: pickLine.locations)
                )
            }
            return DraftLineInfo(title: pickingLines[0].bundleTitle ?? fallbackName, sku: nil, locations: [], bundleComponents: components)
        }
        let orderLine = orderDetail?.lines.first(where: { $0.id == line.orderLineId })
        let rawLocations = orderLine?.variantId.flatMap { stockByVariant[$0] } ?? []
        return DraftLineInfo(
            title: fallbackName,
            sku: orderLine?.sku,
            locations: Self.formatLocations(pick: nil, raw: rawLocations),
            bundleComponents: []
        )
    }

    static func formatLocations(pick: PickLine?, raw: [ItemLocation]) -> [OrderItemLocation] {
        if let pick, !pick.options.isEmpty {
            let effectiveId = pick.selectedLocationId ?? pick.suggestedLocationId
            var formatted: [OrderItemLocation] = []
            if let effective = pick.options.first(where: { $0.locationId == effectiveId }) {
                formatted.append(OrderItemLocation(label: effective.label, stockText: effective.quantity.map(String.init), isPrimary: true))
                let others = pick.options.filter { $0.locationId != effective.locationId && ($0.quantity ?? 0) > 0 }.prefix(2)
                formatted += others.map { OrderItemLocation(label: $0.label, stockText: $0.quantity.map(String.init), isPrimary: false) }
            } else {
                let ordered = pick.options.sorted { ($0.quantity ?? 0) > ($1.quantity ?? 0) }.prefix(3)
                formatted = ordered.enumerated().map { idx, option in
                    OrderItemLocation(label: option.label, stockText: option.quantity.map(String.init), isPrimary: idx == 0)
                }
            }
            return formatted
        }
        guard !raw.isEmpty else { return [] }
        var seen = Set<String>()
        let unique = raw.filter { seen.insert("\($0.warehouseId)-\($0.zoneId ?? -1)-\($0.locationId ?? -1)").inserted }
        let hasNamed = unique.contains { !($0.locationName?.isEmpty ?? true) || !($0.zoneName?.isEmpty ?? true) }
        let filtered = hasNamed
            ? unique.filter { !($0.locationId == nil && $0.zoneId == nil && $0.quantityOnHand <= 0) }
            : unique
        let sorted = filtered.sorted { lhs, rhs in
            let lNamed = !((lhs.locationName ?? "").isEmpty)
            let rNamed = !((rhs.locationName ?? "").isEmpty)
            if lNamed != rNamed { return lNamed }
            let lStock = lhs.locationQuantity ?? lhs.quantityOnHand
            let rStock = rhs.locationQuantity ?? rhs.quantityOnHand
            if (lStock > 0) != (rStock > 0) { return lStock > 0 }
            if lStock != rStock { return lStock > rStock }
            return (lhs.warehouseName, lhs.zoneName ?? "", lhs.locationName ?? "") < (rhs.warehouseName, rhs.zoneName ?? "", rhs.locationName ?? "")
        }
        let distinctWarehouses = Set(sorted.map(\.warehouseId)).count
        return sorted.prefix(3).enumerated().map { index, loc in
            let cleanZone = loc.zoneName?.trimmingCharacters(in: .whitespacesAndNewlines)
            let cleanLoc = loc.locationName?.trimmingCharacters(in: .whitespacesAndNewlines)
            let parts: [String]
            if let cleanLoc, !cleanLoc.isEmpty {
                parts = [distinctWarehouses > 1 ? loc.warehouseName : nil, cleanZone?.isEmpty == false ? cleanZone : nil, cleanLoc].compactMap { $0 }
            } else if let cleanZone, !cleanZone.isEmpty {
                parts = [distinctWarehouses > 1 ? loc.warehouseName : nil, cleanZone].compactMap { $0 }
            } else {
                parts = [loc.warehouseName]
            }
            let stockText: String? = (loc.locationId != nil || loc.zoneId != nil)
                ? loc.locationQuantity.map(String.init)
                : "\(loc.quantityOnHand) in warehouse"
            let hasPlace = !(cleanLoc?.isEmpty ?? true) || !(cleanZone?.isEmpty ?? true)
            return OrderItemLocation(label: parts.joined(separator: " / "), stockText: stockText, isPrimary: index == 0 && hasPlace)
        }
    }

    func refreshRates() async {
        guard !busy, let token, let company else { return }
        busy = true; defer { busy = false }
        do { try await loadRates(token: token, company: company.id) }
        catch { self.error = error.localizedDescription }
    }

    static func defaultRate(from rates: [Rate], preferred: String?) -> Rate? {
        let cheapest = rates
            .compactMap { rate -> (Rate, Decimal)? in
                guard rate.status == "quoted", rate.bookingBlockedReason == nil, let amount = rate.quote?.customerPriceAmount else { return nil }
                return (rate, amount)
            }
            .sorted { $0.1 < $1.1 }
            .map(\.0)
        let preferredService = preferred.map { $0.split(separator: ":").prefix(2).joined(separator: ":") }
        return cheapest.first { $0.service == preferredService }
            ?? cheapest.first { !["pickup_point", "parcel_locker"].contains($0.deliveryMethod) }
            ?? cheapest.first
    }

    private func loadRates(token: String, company: Int) async throws {
        guard var value = draft, let order = selectedOrder else { return }
        quote = nil; pickups = []; value.acceptedQuote = nil; value.pickupProviderId = nil; value.productCode = nil; draft = value
        let fetched = try await api.rates(order: order.id, draft: value, token: token, company: company)
        rates = fetched.sorted { lhs, rhs in
            switch (lhs.quote?.customerPriceAmount, rhs.quote?.customerPriceAmount) {
            case let (l?, r?): l < r
            case (_?, nil): true
            default: false
            }
        }
        let preferred = UserDefaults.standard.string(forKey: "shipping.service")
        if let choice = Self.defaultRate(from: rates, preferred: preferred) {
            try await selectRate(choice.id, remember: false, token: token, company: company)
        } else {
            error = rates.compactMap { $0.bookingBlockedReason ?? $0.error }.first ?? "No shipping rate is available for this parcel."
        }
    }

    func chooseRate(_ id: String) async {
        guard !busy, let token, let company else { return }
        busy = true; defer { busy = false }
        do { try await selectRate(id, remember: true, token: token, company: company.id) }
        catch { self.error = error.localizedDescription }
    }
    private func selectRate(_ id: String, remember: Bool, token: String, company: Int) async throws {
        guard let rate = rates.first(where: { $0.id == id }), var value = draft else { return }
        selectedRate = id; quote = nil; pickups = []; error = nil
        value.carrierCode = rate.carrierCode; value.deliveryMethod = rate.deliveryMethod; value.productCode = rate.quote?.productCode
        value.pickupProviderId = nil; value.acceptedQuote = nil; draft = value
        if remember { UserDefaults.standard.set(rate.service, forKey: "shipping.service") }
        try await loadQuote(token: token, company: company)
    }
    func choosePickup(_ id: String) async {
        guard !busy, let token, let company else { return }
        busy = true; defer { busy = false }
        draft?.pickupProviderId = id.isEmpty ? nil : id
        do { try await loadQuote(token: token, company: company.id) }
        catch { self.error = error.localizedDescription }
    }
    private func loadQuote(token: String, company: Int) async throws {
        guard let value = draft, let order = selectedOrder else { return }
        quote = nil; error = nil
        let result = try await api.quote(order: order.id, draft: value, token: token, company: company)
        pickups = result.pickupPlaces
        if let blocked = result.bookingBlockedReason ?? result.error { error = blocked; return }
        if result.pickupRequired && result.selectedPickupProviderId == nil { return }
        quote = result.quote
    }
    func invalidateQuote() { quote = nil; rates = []; pickups = []; selectedRate = ""; draft?.acceptedQuote = nil }

    func updateDraftRecipient(_ update: (inout Recipient) -> Void) {
        guard var current = draft else { return }
        let previous = current.recipient
        update(&current.recipient)
        guard current.recipient != previous else { return }
        draft = current
        invalidateQuote()
    }

    func updateDraftParcel(_ update: (inout Parcel) -> Void) {
        guard var current = draft else { return }
        let previous = current.parcel
        update(&current.parcel)
        guard current.parcel != previous else { return }
        draft = current
        invalidateQuote()
    }

    func updateDraftLineQuantity(orderLineId: Int, quantity: Decimal) {
        guard var current = draft,
              let index = current.lines.firstIndex(where: { $0.orderLineId == orderLineId }),
              current.lines[index].quantity != quantity else { return }
        current.lines[index].quantity = quantity
        draft = current
        invalidateQuote()
    }

    func shipAndPrint() async {
        guard canShip, let company, let order = selectedOrder else { return }
        if let op = unfinished.first(where: { $0.orderId == order.id }) { await resume(op); return }
        var value = draft
        value?.acceptedQuote = quote
        let operation = ShippingOperation(id: UUID(), tenantId: company.id, orderId: order.id, draft: shipment == nil ? value : nil,
                                          shipmentId: shipment?.id, state: "saved")
        operations.append(operation)
        do { try saveOperations() } catch { self.error = error.localizedDescription; return }
        await resume(operation)
    }

    func resume(_ operation: ShippingOperation) async {
        guard canPrint, operation.tenantId == company?.id, let token, let company else { return }
        busy = true; error = nil; notice = "Preparing shipment…"
        defer { busy = false }
        do {
            try saveOperations()
            guard let index = operations.firstIndex(where: { $0.id == operation.id }) else { return }
            var current: Shipment
            if let id = operations[index].shipmentId { current = try await api.shipment(id, token: token, company: company.id) }
            else {
                guard let proposal = operations[index].draft else { throw appError("The saved shipping request is incomplete. Contact ReAI support.") }
                if let existing = try await api.find(requestId: proposal.requestId, token: token, company: company.id) { current = existing }
                else {
                    do { current = try await api.create(order: operation.orderId, draft: proposal, token: token, company: company.id) }
                    catch {
                        let code = (error as NSError).code
                        if (400..<500).contains(code) && code != 408 && code != 429 {
                            operations[index].state = "rejected"
                            try saveOperations()
                        }
                        throw error
                    }
                }
                operations[index].shipmentId = current.id
                operations[index].draft = nil
                operations[index].state = "prepared"
                try saveOperations()
            }
            if ["prepared", "failed", "capture_pending"].contains(current.status) && current.actions.contains("book") {
                operations[index].state = "booking"
                try saveOperations()
                current = try await api.shipment(current.id, token: token, company: company.id, book: true)
            }
            let deadline = ContinuousClock.now.advanced(by: .seconds(120))
            while current.pending && ContinuousClock.now < deadline {
                notice = "Waiting for payment and carrier confirmation…"
                try await Task.sleep(for: .seconds(2))
                current = try await api.shipment(current.id, token: token, company: company.id)
            }
            shipment = current
            guard current.status == "booked" else {
                if current.status == "failed" && !current.checkoutManaged && !current.actions.contains("book") {
                    operations[index].state = "failed"
                    try saveOperations()
                }
                throw appError(current.error ?? (current.pending ? "Still processing. Resume checks this same shipment; it will not create another." : "This shipment needs review in ReAI. A replacement will not be booked automatically."))
            }
            operations[index].state = "booked"; try saveOperations()
            let request = PrintRequest(tenantId: company.id, shipmentId: current.id)
            if records.contains(where: { $0.id == request.key }) {
                notice = "This label already has a print receipt. Check the queue and use Reprint if needed."
            } else { await printLabel(request, token: token) }
            operations[index].state = "done"; try saveOperations()
            await refreshOrders()
        } catch {
            Diagnostics.recordError(operation: "resume-shipment", error: error)
            self.error = error.localizedDescription
            notice = nil
        }
    }

    func review(_ operation: ShippingOperation) async {
        guard !busy, ["rejected", "failed"].contains(operation.state), let token, let company, operation.tenantId == company.id else { return }
        busy = true; error = nil
        do {
            let existing: Shipment?
            if let id = operation.shipmentId { existing = try await api.shipment(id, token: token, company: company.id) }
            else if let proposal = operation.draft { existing = try await api.find(requestId: proposal.requestId, token: token, company: company.id) }
            else { throw appError("The saved shipping request is incomplete. Contact ReAI support.") }
            if let existing, existing.status != "failed" && existing.status != "cancelled" {
                if let index = operations.firstIndex(where: { $0.id == operation.id }) {
                    operations[index].shipmentId = existing.id; operations[index].draft = nil; operations[index].state = "saved"
                    try saveOperations()
                }
                shipment = existing
                notice = "The original shipment exists. Resume it instead of creating another."
            } else {
                try removeOperation(operation.id)
                busy = false
                if let order = orders.first(where: { $0.id == operation.orderId }) { await select(order) }
            }
        } catch { self.error = error.localizedDescription }
        busy = false
    }

    func cancelPreparation() async {
        guard !busy, let current = shipment, current.actions.contains("cancel"), let token, let company else { return }
        busy = true; error = nil
        do {
            let result = try await api.cancel(current.id, token: token, company: company.id)
            guard result.status == "cancelled" else { throw appError("This shipment needs review in ReAI. A replacement will not be booked automatically.") }
            if let op = unfinished.first(where: { $0.shipmentId == current.id }) { try removeOperation(op.id) }
            shipment = result
            busy = false
            if let order = selectedOrder { await select(order) }
        } catch { self.error = error.localizedDescription }
        busy = false
    }

    private func removeOperation(_ id: UUID) throws {
        let previous = operations
        operations.removeAll { $0.id == id }
        do { try saveOperations() } catch { operations = previous; throw error }
    }

    private func saveOperations() throws {
        try FileManager.default.createDirectory(at: bookingJournal.deletingLastPathComponent(), withIntermediateDirectories: true,
                                               attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(operations).write(to: bookingJournal, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: bookingJournal.path)
    }

    func reprint(_ record: PrintRecord) async {
        guard canPrint, record.request.document == .label, let token, company?.id == record.request.tenantId else { return }
        busy = true
        await printLabel(record.request, token: token)
        busy = false
    }

    private func printLabel(_ request: PrintRequest, token: String) async {
        error = nil
        notice = "Preparing document…"
        do {
            let data = try await api.label(request, token: token)
            _ = try LabelPrinter.layout(for: data)
            let selectedPrinter = printerId
            records.removeAll { $0.id == request.key }
            records.insert(PrintRecord(request: request, state: "submitting", printerId: selectedPrinter, copies: 1), at: 0)
            // Persist before handing off: a crash must never cause an automatic second print.
            try save()
            let result = try await printer.submit(data, printer: selectedPrinter, request: request)
            if let index = records.firstIndex(where: { $0.id == request.key }) {
                records[index].state = "queued"
                records[index].queueResult = result
            }
            try save()
            notice = "Sent to the printer queue."
        } catch {
            Diagnostics.recordError(operation: "print-label", error: error)
            if let index = records.firstIndex(where: { $0.id == request.key }) {
                records[index].state = "check_queue"
            } else {
                records.insert(PrintRecord(request: request, state: "failed"), at: 0)
            }
            try? save()
            self.error = error.localizedDescription
            notice = nil
        }
    }

    func refreshLocations() async {
        guard !busy, !loadingLocations, let token, let company else { return }
        loadingLocations = true; error = nil
        defer { loadingLocations = false }
        do {
            let values = try await api.warehouses(token: token, company: company.id)
            guard self.company?.id == company.id else { return }
            warehouses = values
            if !values.contains(where: { $0.id == warehouseId }) { warehouseId = values.first?.id ?? 0 }
            guard warehouseId > 0 else { locations = []; locationZones = []; return }
            let selected = warehouseId
            locations = []; locationZones = []
            async let rows = api.locations(warehouse: selected, token: token, company: company.id)
            async let zones = api.zones(warehouse: selected, token: token, company: company.id)
            let result = try await (rows, zones)
            guard self.company?.id == company.id, warehouseId == selected else { return }
            locations = result.0; locationZones = result.1
            if !locationZones.contains(where: { $0.id == locationZoneId }) { locationZoneId = 0 }
        } catch { self.error = error.localizedDescription }
    }

    func locationRecord(_ id: Int) -> LocationPrintRecord? {
        locationRecords.first { $0.tenantId == company?.id && $0.locationId == id }
    }

    func locationPDF(_ location: WarehouseLocation) throws -> Data {
        guard location.warehouseId == warehouseId, let current = locations.first(where: { $0.id == location.id }),
              let warehouse = warehouses.first(where: { $0.id == warehouseId }) else {
            throw appError("Refresh locations before printing.")
        }
        return try LocationLabel.pdf(location: current, warehouse: warehouse.name,
            zone: locationZones.first(where: { $0.id == current.zoneId })?.name, size: labelSize)
    }

    func printLocation(_ location: WarehouseLocation, confirmed: Bool = false) async {
        guard canPrint, !loadingLocations, let company, locationRecord(location.id) == nil || confirmed else { return }
        busy = true; error = nil; notice = nil
        defer { busy = false }
        var recorded = false
        do {
            let data = try locationPDF(location)
            let selectedPrinter = printerId
            locationRecords.removeAll { $0.tenantId == company.id && $0.locationId == location.id }
            locationRecords.insert(LocationPrintRecord(tenantId: company.id, locationId: location.id,
                name: location.name, state: "submitting", printerId: selectedPrinter, size: labelSize.rawValue), at: 0)
            do { try saveLocationPrints() } catch { historyReadable = false; throw error }; recorded = true
            let result = try await printer.submitLocation(data, printer: selectedPrinter, title: "ReAI · " + location.name)
            if let index = locationRecords.firstIndex(where: { $0.tenantId == company.id && $0.locationId == location.id }) {
                locationRecords[index].state = "queued"
                locationRecords[index].queueResult = result
            }
            try saveLocationPrints()
            notice = "Sent to the printer queue."
        } catch {
            Diagnostics.recordError(operation: "print-location", error: error)
            if recorded, let index = locationRecords.firstIndex(where: { $0.tenantId == company.id && $0.locationId == location.id }) {
                locationRecords[index].state = "check_queue"
                try? saveLocationPrints()
            }
            self.error = error.localizedDescription
        }
    }

    private func saveLocationPrints() throws {
        try FileManager.default.createDirectory(at: locationJournal.deletingLastPathComponent(), withIntermediateDirectories: true,
                                               attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(locationRecords).write(to: locationJournal, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: locationJournal.path)
    }

    func refreshPickupSummary() async {
        guard let token, let company else { return }
        if let summary = try? await api.pickingSummary(token: token, company: company.id), self.company?.id == company.id {
            pickupCount = summary.pickup
        }
    }

    func refreshPickups(more: Bool = false) async {
        guard !loadingPickups, let token, let company else { return }
        loadingPickups = true
        defer { loadingPickups = false }
        do {
            let result = try await api.pickupOrders(token: token, company: company.id, search: pickupSearch, page: more ? pickupPage + 1 : 0)
            guard self.company?.id == company.id else { return }
            if more {
                var seen = Set(pickupOrders.map(\.id))
                pickupOrders += result.items.filter { seen.insert($0.id).inserted }
            } else {
                var seen = Set<Int>()
                pickupOrders = result.items.filter { seen.insert($0.id).inserted }
            }
            pickupPage = result.page - 1
            pickupTotalPages = result.totalPages
            pickupTotalOrders = result.totalItems
            if pickupSearch.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                pickupCount = result.totalItems
            }
        } catch {
            Diagnostics.recordError(operation: "refresh-pickups", error: error)
            self.error = error.localizedDescription
        }
    }

    func selectPickup(_ order: CommercePickingOrder) async {
        guard !busy, let token, let company else { return }
        busy = true
        defer { busy = false }
        selectedPickupOrder = order
        selectedPickupDetail = nil
        error = nil
        notice = nil
        do {
            let detail = try await api.pickingDetail(order: order.id, token: token, company: company.id)
            guard selectedPickupOrder?.id == order.id else { return }
            if let detail {
                selectedPickupDetail = detail
                if let updated = detail.order, let index = pickupOrders.firstIndex(where: { $0.id == updated.id }) {
                    pickupOrders[index] = updated
                    selectedPickupOrder = updated
                }
            } else {
                notice = "This Click & Collect order is no longer pending."
            }
        } catch {
            Diagnostics.recordError(operation: "select-pickup", error: error)
            self.error = error.localizedDescription
        }
    }

    var pickupDisplayedItems: [OrderItem] {
        guard let detail = selectedPickupDetail else { return [] }
        return detail.lines.enumerated().map { index, line in
            OrderItem(
                id: "\(line.orderLineId)-\(line.variantId)-\(index)",
                orderLineId: line.orderLineId,
                title: line.title,
                sku: line.sku,
                bundleTitle: line.bundleTitle,
                quantity: line.quantity,
                locations: Self.formatLocations(pick: line.pick, raw: line.locations)
            )
        }
    }

    var pickupReadiness: StorePickupReadiness? {
        selectedPickupDetail?.pickupReadiness ?? selectedPickupOrder?.pickupReadiness
    }

    func pickupRecord(_ orderId: Int) -> PickupPrintRecord? {
        pickupRecords.first { $0.tenantId == company?.id && $0.orderId == orderId }
    }

    func pickupLabelPDF() throws -> Data {
        guard let company, let order = selectedPickupOrder else {
            throw appError("Choose a Click & Collect order before printing.")
        }
        let detail = selectedPickupDetail
        return try PickupLabel.pdf(
            orderNumber: detail?.order?.number ?? order.number,
            customerName: detail?.order?.customerName ?? order.customerName,
            phone: detail?.phone,
            email: detail?.email,
            items: pickupDisplayedItems,
            pickupInstructions: detail?.pickupInstructions,
            notes: detail?.notes,
            companyName: company.companyName,
            date: detail?.order?.date ?? order.date
        )
    }

    func printPickupLabel(markReady: Bool, confirmedReprint: Bool = false) async {
        guard canPrint, !loadingPickups, let token, let company, let order = selectedPickupOrder else { return }
        guard pickupRecord(order.id) == nil || confirmedReprint else { return }
        busy = true
        error = nil
        notice = nil
        defer { busy = false }
        var markedReady = false
        if markReady, let readiness = pickupReadiness, !readiness.ready, readiness.allowsNotification {
            do {
                let updated = try await api.markPickupReady(order: order.id, expectedRevision: readiness.revision, token: token, company: company.id)
                applyPickupDetail(updated, orderId: order.id)
                markedReady = true
            } catch {
                Diagnostics.recordError(operation: "pickup-mark-ready", error: error)
                self.error = error.localizedDescription
                return
            }
        }
        var recorded = false
        do {
            let data = try pickupLabelPDF()
            let selectedPrinter = printerId
            pickupRecords.removeAll { $0.tenantId == company.id && $0.orderId == order.id }
            pickupRecords.insert(PickupPrintRecord(
                tenantId: company.id, orderId: order.id, orderNumber: order.number,
                state: "submitting", printerId: selectedPrinter
            ), at: 0)
            do { try savePickupPrints() } catch { historyReadable = false; throw error }
            recorded = true
            let result = try await printer.submitLocation(data, printer: selectedPrinter, title: "ReAI Pickup · " + order.number)
            if let index = pickupRecords.firstIndex(where: { $0.tenantId == company.id && $0.orderId == order.id }) {
                pickupRecords[index].state = "queued"
                pickupRecords[index].queueResult = result
            }
            try savePickupPrints()
            notice = markedReady
                ? "Marked ready, customer notified, and Click & Collect label sent to printer."
                : "Click & Collect label sent to the printer queue."
        } catch {
            Diagnostics.recordError(operation: "print-pickup-label", error: error)
            if recorded, let index = pickupRecords.firstIndex(where: { $0.tenantId == company.id && $0.orderId == order.id }) {
                pickupRecords[index].state = "check_queue"
                try? savePickupPrints()
            }
            self.error = markedReady
                ? "Order was marked ready and customer notified, but printing failed: \(error.localizedDescription)"
                : error.localizedDescription
        }
    }

    func notifyPickupReady() async {
        guard !busy, let token, let company, let order = selectedPickupOrder,
              let readiness = pickupReadiness, readiness.allowsNotification else { return }
        busy = true
        error = nil
        notice = nil
        defer { busy = false }
        do {
            let updated = try await api.markPickupReady(order: order.id, expectedRevision: readiness.revision, token: token, company: company.id)
            applyPickupDetail(updated, orderId: order.id)
            notice = readiness.ready ? "Pickup ready email queued again." : "Order marked ready and pickup email queued."
        } catch {
            Diagnostics.recordError(operation: "pickup-notify-ready", error: error)
            self.error = error.localizedDescription
        }
    }

    func fulfillSelectedPickup() async {
        guard !busy, let token, let company, let order = selectedPickupOrder,
              selectedPickupDetail?.canFulfillPickup == true else { return }
        busy = true
        error = nil
        notice = nil
        defer { busy = false }
        do {
            let summary = try await api.fulfillPickup(order: order.id, token: token, company: company.id)
            pickupCount = summary.pickup
            pickupOrders.removeAll { $0.id == order.id }
            pickupTotalOrders = max(0, pickupTotalOrders - 1)
            selectedPickupOrder = nil
            selectedPickupDetail = nil
            notice = "Order \(order.number) marked handed over."
        } catch {
            Diagnostics.recordError(operation: "fulfill-pickup", error: error)
            self.error = error.localizedDescription
        }
    }

    private func applyPickupDetail(_ detail: CommercePickingDetail, orderId: Int) {
        selectedPickupDetail = detail
        if let updatedOrder = detail.order {
            selectedPickupOrder = updatedOrder
            if let index = pickupOrders.firstIndex(where: { $0.id == orderId }) {
                pickupOrders[index] = updatedOrder
            }
        }
    }

    private func savePickupPrints() throws {
        try FileManager.default.createDirectory(at: pickupJournal.deletingLastPathComponent(), withIntermediateDirectories: true,
                                               attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(pickupRecords).write(to: pickupJournal, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: pickupJournal.path)
    }

    private func save() throws {
        try FileManager.default.createDirectory(at: journal.deletingLastPathComponent(), withIntermediateDirectories: true,
                                               attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(records).write(to: journal, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: journal.path)
    }
}
