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

@MainActor @Observable
final class ShippingModel {
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
    var documentPrinterId: String {
        didSet { UserDefaults.standard.set(documentPrinterId, forKey: "shipping.documentPrinter") }
    }
    var customsCopies = 1
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
    func selectedPrintRecord(document: ShippingDocument) -> PrintRecord? {
        guard let company, let shipment else { return nil }
        return PrintRecord(request: PrintRequest(tenantId: company.id, shipmentId: shipment.id, document: document),
                           state: "saved", copies: document == .label ? 1 : customsCopies)
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
    var operations: [ShippingOperation] = []
    private var bookingJournal: URL { journal.deletingLastPathComponent().appending(path: "shipping-operations.json") }
    var unfinished: [ShippingOperation] { operations.filter { $0.tenantId == company?.id && $0.state != "done" } }
    var testMode: Bool {
        let carrier = shipment?.carrierCode ?? draft?.carrierCode
        return options?.services.first(where: { $0.carrierCode == carrier })?.testMode ?? false
    }
    func canPrint(_ document: ShippingDocument) -> Bool {
        historyReadable && !busy && (document == .customsInvoice ? !documentPrinterId.isEmpty : (!printerId.isEmpty || !documentPrinterId.isEmpty))
    }
    var canShip: Bool {
        !showingHistory && canPrint(.label) && !unfinished.contains { $0.orderId == selectedOrder?.id } &&
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
        printerId = UserDefaults.standard.string(forKey: "shipping.printer") ?? ""
        documentPrinterId = UserDefaults.standard.string(forKey: "shipping.documentPrinter") ?? ""
        journal = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appending(path: "ReAI Shipping/print-history.json")
        do {
            if FileManager.default.fileExists(atPath: journal.path) {
                records = try JSONDecoder().decode([PrintRecord].self, from: Data(contentsOf: journal))
                if records.contains(where: { $0.state == "submitting" }) {
                    notice = t("A previous print was interrupted. Check the printer queue before reprinting.")
                }
            }
            if FileManager.default.fileExists(atPath: bookingJournal.path) {
                operations = try JSONDecoder().decode([ShippingOperation].self, from: Data(contentsOf: bookingJournal))
            }
        } catch { historyReadable = false; self.error = t("Shipping history could not be read. Shipping and printing are paused to prevent duplicates.") }
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
                notice = t("Connected. Choose an order to ship.")
                await refreshOrders()
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
            savedShipments = []; historyBeforeId = nil; shipmentBeforeId = nil
            orders = []; selectedOrder = nil; options = nil; draft = nil; shipment = nil; quote = nil
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
        await refreshOrders()
    }

    func changeOrderAge(includeOlder: Bool) async {
        guard !busy, !loadingOrders else { return }
        includeOlderOrders = includeOlder
        await changeOrderView(history: false)
    }

    static func readyOrderStart(includeOlder: Bool, now: Date = .now, calendar: Calendar = .current) -> String {
        if includeOlder { return "1900-01-01" }
        let cutoff = calendar.date(byAdding: .day, value: -14, to: now)!
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: cutoff)
    }

    func refreshOrders(more: Bool = false) async {
        guard !loadingOrders, let token, let company else { return }
        loadingOrders = true
        defer { loadingOrders = false }
        do {
            if showingHistory {
                let result = try await api.history(token: token, company: company.id, search: search, beforeId: more ? historyBeforeId : nil)
                guard self.company?.id == company.id else { return }
                if more {
                    let known = Set(orders.map(\.id))
                    orders += result.items.filter { !known.contains($0.id) }
                } else { orders = result.items }
                historyBeforeId = result.nextBeforeId
                totalOrders = orders.count
                return
            }
            if !more { readyFromDate = Self.readyOrderStart(includeOlder: includeOlderOrders) }
            let result = try await api.orders(token: token, company: company.id, search: search,
                                              page: more ? page + 1 : 0, from: readyFromDate)
            guard self.company?.id == company.id else { return }
            if more {
                let known = Set(orders.map(\.id))
                orders += result.items.filter { !known.contains($0.id) }
            } else { orders = result.items }
            page = result.page; totalPages = result.totalPages; totalOrders = result.totalItems
        } catch { self.error = error.localizedDescription }
    }

    func select(_ order: ReadyOrder) async {
        guard !busy, let token, let company else { return }
        busy = true
        defer { busy = false }
        savedShipments = []; shipmentBeforeId = nil
        selectedOrder = order; options = nil; draft = nil; rates = []; pickups = []; quote = nil; shipment = nil
        error = nil; notice = nil
        do {
            let history = try await api.shipments(order: order.id, token: token, company: company.id)
            savedShipments = history.items; shipmentBeforeId = history.nextBeforeId
            if showingHistory {
                if let id = savedShipments.first(where: { $0.status == "booked" })?.id ?? savedShipments.first?.id {
                    shipment = try await api.shipment(id, token: token, company: company.id)
                } else { notice = t("No saved shipping labels for this order.") }
                return
            }
            if let saved = unfinished.first(where: { $0.orderId == order.id }) {
                if let id = saved.shipmentId { shipment = try await api.shipment(id, token: token, company: company.id) }
                else { draft = saved.draft; notice = t("A saved shipping request needs checking. Use Resume below.") }
            } else if let id = order.preparedShipmentId {
                shipment = try await api.shipment(id, token: token, company: company.id)
            } else {
                let result = try await api.options(order: order.id, token: token, company: company.id)
                options = result
                if let id = result.existingShipments.items.first(where: { $0.status == "prepared" })?.id {
                    shipment = try await api.shipment(id, token: token, company: company.id)
                    return
                }
                draft = result.defaults
                if draft != nil { try await loadRates(token: token, company: company.id) }
            }
        } catch { self.error = error.localizedDescription }
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
        do { shipment = try await api.shipment(id, token: token, company: company.id); draft = nil; quote = nil }
        catch { self.error = error.localizedDescription }
    }

    func refreshRates() async {
        guard !busy, let token, let company else { return }
        busy = true; defer { busy = false }
        do { try await loadRates(token: token, company: company.id) }
        catch { self.error = error.localizedDescription }
    }

    private func loadRates(token: String, company: Int) async throws {
        guard var value = draft, let order = selectedOrder else { return }
        quote = nil; pickups = []; value.acceptedQuote = nil; value.pickupProviderId = nil; draft = value
        rates = try await api.rates(order: order.id, draft: value, token: token, company: company)
        let available = rates.filter { $0.status == "quoted" && $0.bookingBlockedReason == nil && $0.quote != nil }
        let preferred = UserDefaults.standard.string(forKey: "shipping.service")
        let choice = available.first { $0.id == preferred } ?? available.first { !["pickup_point", "parcel_locker"].contains($0.deliveryMethod) } ?? available.first
        if let choice { try await selectRate(choice.id, token: token, company: company) }
        else { error = rates.compactMap { $0.bookingBlockedReason ?? $0.error }.first ?? t("No shipping rate is available for this parcel.") }
    }

    func chooseRate(_ id: String) async {
        guard !busy, let token, let company else { return }
        busy = true; defer { busy = false }
        do { try await selectRate(id, token: token, company: company.id) }
        catch { self.error = error.localizedDescription }
    }
    private func selectRate(_ id: String, token: String, company: Int) async throws {
        guard let rate = rates.first(where: { $0.id == id }), var value = draft else { return }
        selectedRate = id; quote = nil; pickups = []; error = nil
        value.carrierCode = rate.carrierCode; value.deliveryMethod = rate.deliveryMethod
        value.pickupProviderId = nil; value.acceptedQuote = nil; draft = value
        UserDefaults.standard.set(id, forKey: "shipping.service")
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
        guard canPrint(.label), operation.tenantId == company?.id, let token, let company else { return }
        busy = true; error = nil; notice = t("Preparing shipment…")
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
                notice = t("Waiting for payment and carrier confirmation…")
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
                notice = t("This label already has a print receipt. Check the queue and use Reprint if needed.")
            } else { await printDocument(request, token: token, copies: 1) }
            operations[index].state = "done"; try saveOperations()
            await refreshOrders()
        } catch { self.error = error.localizedDescription; notice = nil }
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
                notice = t("The original shipment exists. Resume it instead of creating another.")
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
        guard canPrint(record.request.document), let token, company?.id == record.request.tenantId else { return }
        busy = true
        await printDocument(record.request, token: token, copies: record.copies ?? 1)
        busy = false
    }

    private func printDocument(_ request: PrintRequest, token: String, copies: Int) async {
        error = nil
        notice = t("Preparing document…")
        do {
            let data = try await api.document(request, token: token)
            let layout = try LabelPrinter.layout(for: data, document: request.document)
            let selectedPrinter = layout.fullPage ? documentPrinterId : printerId
            guard !selectedPrinter.isEmpty else {
                throw appError(layout.fullPage ? "Choose an A4 / Letter document printer for this PDF." : "Choose a label printer for this PDF.")
            }
            records.removeAll { $0.id == request.key }
            records.insert(PrintRecord(request: request, state: "submitting", printerId: selectedPrinter, copies: copies), at: 0)
            // Persist before handing off: a crash must never cause an automatic second print.
            try save()
            let result = try await printer.submit(data, printer: selectedPrinter, request: request, copies: copies)
            records[0].state = "queued"
            records[0].queueResult = result
            try save()
            notice = t("Sent to the printer queue.")
        } catch {
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

    private func save() throws {
        try FileManager.default.createDirectory(at: journal.deletingLastPathComponent(), withIntermediateDirectories: true,
                                               attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(records).write(to: journal, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: journal.path)
    }
}
