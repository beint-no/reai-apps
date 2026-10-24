import AppKit
import Observation
import UniformTypeIdentifiers

struct SavedLabels: Codable {
    var settings = LabelSettings()
    var draft = LabelItem()
    var batch: [LabelItem] = []
    var companyId: Int?
    var printStatus: String?
    var selectedPriceSources: [String]?
    var vatMode: String?
    var customVat: Decimal?
}
@MainActor @Observable
final class LabelsModel {
    var saved = SavedLabels()
    var catalog: [CatalogItem] = []
    var priceLists: [PriceList] = []
    private var vatRates: [String: Decimal] = [:]
    private var defaultVatRate: Decimal = 0
    private var listPrices: [String: [UUID: Decimal]] = [:]
    var selected = Set<Int>()
    var search = ""
    var company: Company?
    var printers: [Printer] = []
    var busy = false
    var connecting = false
    var code = ""
    var error: String?
    var notice: String?
    var storageFailed = false
    var previewId: UUID?
    private var token: String?
    private var started = false
    private var authorization: Task<Void, Never>?
    private let api = ReAIAPI(), credentials = Credentials(), printer = LabelPrinter()
    private let file = URL.applicationSupportDirectory.appending(path: "ReAI Product Labels/state.json")
    var priceSources: [PriceSource] {
        guard let company else { return [] }
        return [PriceSource(id: "base", name: t("Standard product price"), currency: company.currencyCode)] +
            priceLists.map { PriceSource(id: $0.id.uuidString, name: $0.name, currency: $0.currency) }
    }
    var chosenSources: [String] { saved.selectedPriceSources.flatMap { $0.isEmpty ? nil : $0 } ?? ["base"] }
    var selectedCurrencies: String { priceSources.filter { chosenSources.contains($0.id) }.map(\.currency).joined(separator: " + ") }
    var results: [CatalogItem] {
        let term = search.trimmingCharacters(in: .whitespacesAndNewlines)
        return catalog.filter { term.isEmpty || [$0.title, $0.sku, $0.barcode, $0.details].contains { $0.localizedStandardContains(term) } }
    }
    var total: Int { saved.batch.reduce(0) { min(1001, $0 + min(1001, max(0, $1.copies))) } }
    var preview: LabelItem {
        get { saved.batch.first { $0.id == previewId } ?? saved.draft }
        set { if let index = saved.batch.firstIndex(where: { $0.id == previewId }) { saved.batch[index] = newValue } else { saved.draft = newValue } }
    }
    func start() async {
        guard !started else { return }; started = true
        do {
            if FileManager.default.fileExists(atPath: file.path) { saved = try JSONDecoder().decode(SavedLabels.self, from: Data(contentsOf: file)) }
        } catch { storageFailed = true; self.error = t("Could not read saved labels. Your file has been preserved; fix it before printing."); return }
        await refreshPrinters()
        do {
            if let token = try await credentials.load() {
                busy = true; defer { busy = false }
                let company = try await api.account(token: token)
                guard saved.companyId == nil || saved.companyId == company.id else { throw appError("Disconnect and clear the batch before connecting another company.") }
                self.token = token; self.company = company; saved.companyId = company.id
                try await loadCatalog(token: token, company: company.id)
            }
        } catch { self.error = error.localizedDescription }
    }
    func persist() {
        guard !storageFailed else { return }
        do { try writeState() } catch { self.error = error.localizedDescription }
    }
    private func writeState() throws {
        guard !storageFailed else { throw appError("Could not read saved labels. Your file has been preserved; fix it before printing.") }
        let directory = file.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(saved).write(to: file, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }
    func connect() {
        connecting = true; error = nil
        authorization = Task { [self] in
            defer { connecting = false; code = ""; authorization = nil }
            do {
                let token = try await Connection().authorize { [weak self] code in await MainActor.run { self?.code = code } }
                let company = try await api.account(token: token)
                guard saved.companyId == nil || saved.companyId == company.id else { throw appError("Disconnect and clear the batch before connecting another company.") }
                try await credentials.save(token); self.token = token; self.company = company
                saved.companyId = company.id; persist()
                try await loadCatalog(token: token, company: company.id)
            } catch is CancellationError {} catch { self.error = error.localizedDescription }
        }
    }
    func cancelConnection() { authorization?.cancel() }
    func disconnect() async {
        do { try await credentials.delete(); token = nil; company = nil; catalog = []; selected = []; saved.batch = []; saved.draft = LabelItem(); saved.companyId = nil; saved.selectedPriceSources = nil; priceLists = []; listPrices = [:]; previewId = nil; persist() }
        catch { self.error = error.localizedDescription }
    }
    func refresh() async {
        guard let token, let company else { return }
        busy = true; error = nil; defer { busy = false }
        do { try await loadCatalog(token: token, company: company.id); selected = selected.intersection(catalog.map(\.id)) }
        catch { self.error = error.localizedDescription }
    }
    func refreshPrinters() async {
        do {
            printers = try await printer.printers()
        } catch { self.error = error.localizedDescription }
    }
    private func loadCatalog(token: String, company: Int) async throws {
        async let products = api.products(token: token, company: company)
        async let lists = api.priceLists(token: token, company: company)
        async let allVat = api.vatCodes(token: token, company: company)
        async let salesVat = api.vatCodes(token: token, company: company, salesOnly: true)
        let loaded = try await (products, lists, allVat, salesVat)
        vatRates = Dictionary(loaded.2.map { ($0.code, $0.rate) }, uniquingKeysWith: { a, _ in a })
        defaultVatRate = loaded.3.first { $0.code == "3" }?.rate ?? 0
        catalog = loaded.0; priceLists = loaded.1; listPrices = [:]
        let valid = chosenSources.filter { id in priceSources.contains { $0.id == id } }
        saved.selectedPriceSources = valid.isEmpty ? ["base"] : valid
        if saved.batch.isEmpty { saved.settings.currency = self.company?.currencyCode ?? "NOK" }
        persist()
    }
    private func loadChosenPrices(_ sources: [String]) async throws {
        guard let token, let company else { throw appError("Connect to ReAI to choose catalog currencies.") }
        for source in sources where source != "base" && listPrices[source] == nil {
            guard let id = UUID(uuidString: source) else { throw appError("Refresh the available price lists.") }
            let prices = try await api.prices(token: token, company: company.id, list: id)
            listPrices[source] = Dictionary(prices.map { ($0.productVariantId, $0.sellingPrice) }, uniquingKeysWith: { first, _ in first })
        }
    }
    private func prices(for item: CatalogItem, sources: [String]) throws -> [LabelPrice] {
        let f = NumberFormatter(); f.locale = Locale(identifier: saved.settings.locale); f.numberStyle = .decimal
        f.usesGroupingSeparator = false; f.maximumFractionDigits = 2; f.roundingMode = .halfUp
        return try sources.map { id in
            guard let source = priceSources.first(where: { $0.id == id }),
                  let amount = id == "base" ? item.price : listPrices[id]?[item.variantUUID] else {
                throw appError("A selected currency has no price for this variant. Nothing was changed.")
            }
            let rate: Decimal
            switch saved.vatMode ?? "product" {
            case "net": rate = 0
            case "custom":
                guard let custom = saved.customVat, custom >= 0, custom <= 100 else { throw appError("Enter a VAT rate between 0 and 100 percent.") }
                rate = custom
            default:
                if let code = item.vatCode, !code.isEmpty {
                    guard let configured = vatRates[code] else { throw appError("The product VAT code is unavailable. Refresh or choose a custom VAT rate.") }
                    rate = configured
                } else { rate = defaultVatRate }
            }
            var gross = amount * (1 + rate / 100), cents = gross, whole = gross
            NSDecimalRound(&cents, &gross, 2, .plain); NSDecimalRound(&whole, &cents, 0, .plain)
            f.minimumFractionDigits = cents == whole ? 0 : 2
            return LabelPrice(currency: source.currency, amount: f.string(from: cents as NSDecimalNumber) ?? "")
        }
    }
    func choosePriceSource(_ source: PriceSource) async {
        var chosen = chosenSources
        if chosen.contains(source.id) { if chosen.count > 1 { chosen.removeAll { $0 == source.id } } }
        else {
            chosen.removeAll { id in priceSources.contains { $0.id == id && $0.currency == source.currency } }
            chosen.append(source.id)
        }
        guard chosen.count <= 4 else { error = t("Choose up to four different currencies per label."); return }
        await applyPriceSources(chosen)
    }
    func updateCatalogPrices() async { await applyPriceSources(chosenSources) }
    private func applyPriceSources(_ chosen: [String]) async {
        busy = true; error = nil; defer { busy = false }
        do {
            try await loadChosenPrices(chosen)
            var updated = saved.batch
            for index in updated.indices {
                guard let id = updated[index].variantUUID else { continue }
                guard let item = catalog.first(where: { $0.variantUUID == id }) else { throw appError("Refresh the available price lists.") }
                let values = try prices(for: item, sources: chosen)
                updated[index].price = values[0].amount; updated[index].currencyCode = values[0].currency; updated[index].extraPrices = Array(values.dropFirst())
            }
            saved.batch = updated; saved.selectedPriceSources = chosen; persist()
        } catch { self.error = error.localizedDescription }
    }
    func addProducts(allResults: Bool = false) async {
        let items = allResults ? results : results.filter { selected.contains($0.id) }
        guard total + items.count <= 1000 else { error = t("A batch must contain 1–1000 labels."); return }
        busy = true; error = nil; defer { busy = false }
        do {
            if saved.settings.design == .price { try await loadChosenPrices(chosenSources) }
            let labels = try items.map { item in
                let values = saved.settings.design == .price ? try prices(for: item, sources: chosenSources) : []
                var label = LabelItem(title: item.title, price: values.first?.amount ?? "", sku: item.sku,
                                      barcode: item.barcode, origin: item.origin, details: item.details)
                label.currencyCode = values.first?.currency; label.extraPrices = Array(values.dropFirst()); label.variantUUID = item.variantUUID
                return label
            }
            saved.batch.append(contentsOf: labels); previewId = saved.batch.last?.id; selected = []; persist()
        } catch { self.error = error.localizedDescription }
    }
    func reformatNumbers(from oldLocale: String) {
        let old = Locale(identifier: oldLocale).decimalSeparator ?? "."
        let new = Locale(identifier: saved.settings.locale).decimalSeparator ?? "."
        guard old != new else { return }
        func convert(_ value: String) -> String {
            let pattern = "^[0-9]{1,9}(" + NSRegularExpression.escapedPattern(for: old) + "[0-9]{1,2})?$"
            return value.range(of: pattern, options: .regularExpression) == nil ? value : value.replacingOccurrences(of: old, with: new)
        }
        func convertItem(_ item: inout LabelItem) {
            item.price = convert(item.price)
            if var extras = item.extraPrices {
                for index in extras.indices { extras[index].amount = convert(extras[index].amount) }
                item.extraPrices = extras
            }
        }
        convertItem(&saved.draft)
        for index in saved.batch.indices { convertItem(&saved.batch[index]) }
        persist()
    }
    func addDraft() {
        do {
            try LabelRenderer.validate(saved.draft, settings: saved.settings)
            guard total + saved.draft.copies <= 1000 else { throw appError("A batch must contain 1–1000 labels.") }
            var item = saved.draft; item.id = UUID(); saved.batch.append(item); previewId = item.id; persist(); error = nil }
        catch { self.error = error.localizedDescription }
    }
    func exportPDF() {
        do {
            let data = try LabelRenderer.pdf(saved.batch, settings: saved.settings)
            let panel = NSSavePanel(); panel.allowedContentTypes = [.pdf]; panel.nameFieldStringValue = "ReAI-labels.pdf"
            if panel.runModal() == .OK, let url = panel.url { try data.write(to: url, options: .atomic) }
        } catch { self.error = error.localizedDescription }
    }
    func printBatch(test: Bool) async {
        busy = true; error = nil; notice = nil; defer { busy = false }
        do {
            let items: [LabelItem]
            if test { var sample = preview; sample.copies = 1; items = [sample] } else { items = saved.batch }
            let data = try LabelRenderer.pdf(items, settings: saved.settings)
            guard !saved.settings.printer.isEmpty else { throw appError("Choose an available printer in System Settings.") }
            saved.printStatus = t("Print submission started. Check the macOS printer queue before printing again.") + " · \(items.reduce(0) { $0 + $1.copies }) × · \(saved.settings.printer) · \(Date.now.formatted())"
            try writeState()
            let result = try await printer.submit(data, printer: saved.settings.printer, width: saved.settings.width, height: saved.settings.height)
            saved.printStatus = t("Sent to the printer queue") + ": " + result
            try writeState(); notice = saved.printStatus
        } catch { self.error = error.localizedDescription }
    }
}
