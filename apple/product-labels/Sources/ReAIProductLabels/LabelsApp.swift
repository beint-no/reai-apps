import AppKit
import PDFKit
import SwiftUI

@main
struct LabelsApp: App {
    @State private var model = LabelsModel()
    @StateObject private var updater = LabelsUpdater()
    @Environment(\.openWindow) private var openWindow
    var body: some Scene {
        Window("ReAI Product Labels", id: "labels") {
            LabelsView(model: model).disabled(updater.inProgress).frame(minWidth: 1040, minHeight: 730)
                .task { await model.start() }
        }.defaultSize(width: 1200, height: 860)
        .commands {
            CommandGroup(after: .appInfo) {
                Button(t("Check for Updates…")) { updater.check() }.disabled(model.busy || model.connecting || !updater.canCheck)
            }
        }
        MenuBarExtra("ReAI Product Labels", systemImage: "tag") {
            Button(t("Open ReAI Product Labels")) { openWindow(id: "labels"); NSApp.activate() }
            Button(t("Check for Updates…")) { updater.check() }.disabled(model.busy || model.connecting || !updater.canCheck)
            Divider()
            Button(t("Quit")) { NSApp.terminate(nil) }.disabled(model.busy)
        }
    }
}

struct LabelsView: View {
    @Bindable var model: LabelsModel
    @State private var tab = 0
    @State private var printMode: Bool?
    @State private var disconnect = false
    @State private var clear = false
    @State private var bulkCopies = 1
    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            HSplitView {
                VStack(alignment: .leading, spacing: 16) {
                    Picker(t("Label source"), selection: $tab) {
                        Text(t("Manual label")).tag(0); Text(t("ReAI products")).tag(1)
                    }.pickerStyle(.segmented)
                    if tab == 0 { manual } else { products }
                }.padding(20).frame(minWidth: 300, idealWidth: 350, maxWidth: 450, maxHeight: .infinity, alignment: .top)
                VStack(spacing: 16) {
                    settings
                    preview
                    batch
                }.padding(20).frame(minWidth: 650, maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
            Divider()
            footer
        }
        .disabled(model.busy || model.storageFailed)
        .onChange(of: model.saved.settings) { model.persist() }
        .onChange(of: model.saved.settings.locale) { old, _ in model.reformatNumbers(from: old) }
        .onChange(of: model.saved.draft) { model.persist() }
        .onChange(of: model.saved.batch) { model.persist() }
        .confirmationDialog(t("Confirm printing"), isPresented: Binding(get: { printMode != nil }, set: { if !$0 { printMode = nil } })) {
            Button(printMode == true ? t("Print one test label") : t("Print batch") + " (\(model.total))") {
                let test = printMode == true; printMode = nil; Task { await model.printBatch(test: test) }
            }
        } message: {
            Text(t("Check the loaded stock and printer queue. This sends a new print job; previous jobs are never retried automatically.") + "\n\(model.saved.settings.printer) · \(model.saved.settings.width.formatted()) × \(model.saved.settings.height.formatted()) mm")
        }
        .confirmationDialog(t("Disconnect and clear product labels?"), isPresented: $disconnect) {
            Button(t("Disconnect"), role: .destructive) { Task { await model.disconnect() } }
        } message: { Text(t("This removes the connection and clears the draft and batch from this Mac.")) }
        .confirmationDialog(t("Clear the batch?"), isPresented: $clear) {
            Button(t("Clear batch"), role: .destructive) { model.saved.batch = []; model.previewId = nil }
        }
    }
    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: "tag.fill").font(.title).foregroundStyle(.green)
            VStack(alignment: .leading, spacing: 4) {
                Text("ReAI Product Labels").font(.title2.bold())
                Text(model.company?.companyName ?? t("Price tags, product details and barcodes. Made for your Mac.")).font(.callout).foregroundStyle(.secondary)
            }
            Spacer()
            if model.busy || model.connecting { ProgressView().controlSize(.small) }
            if model.connecting {
                Text(model.code).monospaced(); Button(t("Cancel")) { model.cancelConnection() }
            } else if model.company != nil {
                Button(t("Disconnect")) { disconnect = true }
            } else {
                Button(t("Connect to ReAI")) { model.connect() }.disabled(model.storageFailed)
            }
        }.padding(20)
    }
    private var manual: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(t("Create a label")).font(.headline)
            Text(t("Works without connecting to ReAI.")).font(.caption).foregroundStyle(.secondary)
            Form {
                TextField(t("Product title"), text: $model.saved.draft.title)
                if model.saved.settings.design == .price {
                    TextField(t("Customer price"), text: $model.saved.draft.price)
                } else {
                    TextField("SKU", text: $model.saved.draft.sku)
                    TextField(t("Barcode value"), text: $model.saved.draft.barcode)
                    if model.saved.settings.design == .product {
                        TextField(t("Country of origin"), text: $model.saved.draft.origin)
                        TextField(t("Details / material / size"), text: $model.saved.draft.details, axis: .vertical).lineLimit(2...4)
                    }
                }
                LabeledContent(t("Copies")) { HStack { TextField(t("Copies"), value: $model.saved.draft.copies, format: .number).labelsHidden().frame(width: 70); Stepper(t("Copies"), value: $model.saved.draft.copies, in: 1...1000).labelsHidden() } }
            }.textFieldStyle(.roundedBorder)
            if model.saved.settings.design == .price {
                Text(t("Enter the final customer price. No tax or currency conversion is applied.")).font(.caption).foregroundStyle(.secondary)
            } else {
                Text(t("Barcodes use Code 128. Leave the value empty for a text-only product label.")).font(.caption).foregroundStyle(.secondary)
            }
            Button(t("Add to batch"), systemImage: "plus") { model.addDraft() }.buttonStyle(.borderedProminent)
            Button(t("Preview draft")) { model.previewId = nil }
            Spacer()
        }
    }
    private var products: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(t("Choose products")).font(.headline); Spacer()
                Button { Task { await model.refresh() } } label: { Image(systemName: "arrow.clockwise") }
                    .disabled(model.company == nil).help(t("Refresh products"))
            }
            if model.company != nil {
                Menu {
                    ForEach(model.priceSources) { source in
                        Button { Task { await model.choosePriceSource(source) } } label: {
                            if model.chosenSources.contains(source.id) { Label(source.currency + " · " + source.name, systemImage: "checkmark") }
                            else { Text(source.currency + " · " + source.name) }
                        }
                    }
                } label: { Text(t("Label currencies") + ": " + model.selectedCurrencies) }
                Text(t("Choose stored price lists. One per currency; changing the selection updates catalog labels already in the batch.")).font(.caption).foregroundStyle(.secondary)
                Picker(t("Catalog VAT"), selection: Binding(get: { model.saved.vatMode ?? "product" }, set: { model.saved.vatMode = $0; model.persist() })) {
                    Text(t("Include product VAT")).tag("product")
                    Text(t("Stored net price")).tag("net")
                    Text(t("Custom VAT rate")).tag("custom")
                }
                if model.saved.vatMode == "custom" {
                    TextField(t("VAT percent"), value: Binding(get: { model.saved.customVat ?? 0 }, set: { model.saved.customVat = $0; model.persist() }), format: .number).textFieldStyle(.roundedBorder)
                }
                Button(t("Update catalog prices in batch")) { Task { await model.updateCatalogPrices() } }.disabled(model.saved.batch.isEmpty)
                Text(t("Product VAT is the domestic rate from ReAI. Choose a custom rate for other markets. Tax changes apply to new items; update the batch to replace existing prices.")).font(.caption).foregroundStyle(.secondary)
            }
            TextField(t("Search title, SKU or barcode"), text: $model.search).textFieldStyle(.roundedBorder)
            if model.company == nil {
                ContentUnavailableView(t("Connect to ReAI"), systemImage: "link", description: Text(t("Approve your company in the browser to load its products.")))
            } else {
                List(model.results, selection: $model.selected) { item in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(item.title).lineLimit(2)
                        Text(item.sku + (item.details.isEmpty ? "" : " · " + item.details)).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    }.tag(item.id).padding(.vertical, 3)
                }.listStyle(.bordered)
                Text(t("Use ⌘-click or ⇧-click to select several variants.")).font(.caption).foregroundStyle(.secondary)
                HStack {
                    Button(t("Add selected") + " (\(model.selected.count))") { Task { await model.addProducts() } }.disabled(model.selected.isEmpty)
                    Button(t("Add all results") + " (\(model.results.count))") { Task { await model.addProducts(allResults: true) } }.disabled(model.results.isEmpty)
                }
                Text(t("Prices use the selected price lists and VAT choice. Review customer prices before printing.")).font(.caption).foregroundStyle(.secondary)
            }
        }
    }
    private var settings: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Picker(t("Design"), selection: $model.saved.settings.design) {
                    ForEach(LabelDesign.allCases) { Text(t($0.title)).tag($0) }
                }.frame(width: 220)
                Picker(t("Stock"), selection: Binding(get: {
                    LabelSettings.dimensions.firstIndex { $0.0 == model.saved.settings.width && $0.1 == model.saved.settings.height } ?? -1
                }, set: { value in if value >= 0 { let size = LabelSettings.dimensions[value]; model.saved.settings.width = size.0; model.saved.settings.height = size.1 } })) {
                    ForEach(Array(LabelSettings.sizes.enumerated()), id: \.offset) { index, text in Text(text).tag(index) }
                    Text(t("Custom size")).tag(-1)
                }.frame(width: 210)
                Spacer()
            }
            HStack {
                Text(t("Width")); TextField("mm", value: $model.saved.settings.width, format: .number).frame(width: 55)
                Text("×"); TextField("mm", value: $model.saved.settings.height, format: .number).frame(width: 55); Text("mm")
                if model.saved.settings.design == .price {
                    Picker(t("Currency"), selection: $model.saved.settings.currency) {
                        ForEach(["NOK", "EUR", "USD", "SEK", "DKK", "GBP", "None"], id: \.self) { Text($0 == "None" ? t("None") : $0).tag($0) }
                    }.frame(width: 150).help(t("Currency applies to manual labels. Catalog labels keep their selected currencies."))
                    Picker(t("Price input"), selection: $model.saved.settings.locale) {
                        Text("1234.50").tag("en_US"); Text("1234,50").tag("nb_NO")
                        if !["en_US", "nb_NO"].contains(model.saved.settings.locale) { Text(Locale(identifier: model.saved.settings.locale).localizedString(forIdentifier: model.saved.settings.locale) ?? model.saved.settings.locale).tag(model.saved.settings.locale) }
                    }.frame(width: 170)
                }
                Spacer()
            }.textFieldStyle(.roundedBorder)
        }
        .onChange(of: model.saved.settings.design) { _, design in
            if design == .price {
                model.saved.settings.width = 50; model.saved.settings.height = 30
            }
            else { model.saved.settings.width = 60; model.saved.settings.height = 40 }
        }
    }
    private var previewError: String? {
        do { try LabelRenderer.validate(model.preview, settings: model.saved.settings); return nil }
        catch { return error.localizedDescription }
    }
    private var preview: some View {
        HStack(spacing: 24) {
            LabelPreview(item: model.preview, settings: model.saved.settings).frame(width: 330, height: 185)
                .padding(12).background(.white).clipShape(RoundedRectangle(cornerRadius: 6)).shadow(color: .black.opacity(0.08), radius: 6, y: 2)
            VStack(alignment: .leading, spacing: 8) {
                Text(t("Print preview")).font(.headline)
                Text("\(model.saved.settings.width.formatted()) × \(model.saved.settings.height.formatted()) mm").monospacedDigit()
                Text(t("One label per page · Actual size")).font(.caption).foregroundStyle(.secondary)
                if model.saved.settings.design == .price {
                    Text(t("Whole prices · No thousands separators")).font(.caption).foregroundStyle(.secondary)
                }
                Text(model.previewId == nil ? t("Manual draft") : t("Selected batch item")).font(.caption).foregroundStyle(.secondary)
                if let error = previewError { Text(error).font(.caption).foregroundStyle(.orange) }
            }
            Spacer(minLength: 0)
        }
    }
    private var batch: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(t("Print batch")).font(.headline)
                Text("\(model.saved.batch.count) " + t("items") + " · \(model.total) " + t("labels")).foregroundStyle(.secondary)
                Spacer()
                Button(t("Clear batch")) { clear = true }.disabled(model.saved.batch.isEmpty)
            }
            if !model.saved.batch.isEmpty {
                HStack {
                    Text(t("Copies per item"))
                    TextField(t("Copies"), value: $bulkCopies, format: .number).frame(width: 60).textFieldStyle(.roundedBorder)
                    Button(t("Apply to all")) { for index in model.saved.batch.indices { model.saved.batch[index].copies = bulkCopies } }
                        .disabled(!(1...1000).contains(bulkCopies) || bulkCopies * model.saved.batch.count > 1000)
                    Spacer()
                }
            }
            if model.saved.batch.isEmpty {
                ContentUnavailableView(t("Your batch is empty"), systemImage: "tag", description: Text(t("Add a manual label or select ReAI products. Set copies per item, then print the whole batch."))).frame(maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach($model.saved.batch) { $item in
                            BatchRow(item: $item, settings: model.saved.settings, previewed: model.previewId == item.id,
                                     preview: { model.previewId = item.id }, remove: { model.saved.batch.removeAll { $0.id == item.id } })
                        }
                    }
                }
            }
        }.frame(maxHeight: .infinity)
    }
    private var footer: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let error = model.error { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.orange).textSelection(.enabled) }
            if let status = model.saved.printStatus { Text(status).font(.caption).textSelection(.enabled).foregroundStyle(.secondary) }
            HStack {
                Image(systemName: "printer")
                Picker(t("Printer"), selection: $model.saved.settings.printer) {
                    Text(t("Choose printer")).tag("")
                    ForEach(model.printers) { Text($0.name).tag($0.id) }
                    if !model.saved.settings.printer.isEmpty && !model.printers.contains(where: { $0.id == model.saved.settings.printer }) { Text(model.saved.settings.printer + " · " + t("Unavailable")).tag(model.saved.settings.printer) }
                }.labelsHidden().frame(maxWidth: 230)
                Button { Task { await model.refreshPrinters() } } label: { Image(systemName: "arrow.clockwise") }.help(t("Refresh printers"))
                if model.printers.isEmpty { Button(t("Add printer")) { NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.Print-Scan-Settings.extension")!) } }
                Spacer()
                Button(t("Export PDF")) { model.exportPDF() }.disabled(model.saved.batch.isEmpty)
                Button(t("Print one test label")) { printMode = true }.disabled(model.saved.settings.printer.isEmpty)
                Button(t("Print batch") + " (\(model.total))") { printMode = false }.buttonStyle(.borderedProminent)
                    .disabled(model.saved.batch.isEmpty || model.saved.settings.printer.isEmpty || model.total > 1000)
            }
            Text(t("Load matching label stock. Print one test first. Queue acceptance does not confirm physical printing.")).font(.caption).foregroundStyle(.secondary)
        }.padding(16)
    }
}
struct LabelPreview: NSViewRepresentable {
    let item: LabelItem
    let settings: LabelSettings
    func makeNSView(context: Context) -> PDFView {
        let view = PDFView(); view.autoScales = true; view.displayMode = .singlePage; view.backgroundColor = .white
        return view
    }
    func updateNSView(_ view: PDFView, context: Context) {
        var sample = item; sample.copies = 1
        view.document = (try? LabelRenderer.pdf([sample], settings: settings)).flatMap(PDFDocument.init(data:))
        do { try LabelRenderer.validate(sample, settings: settings) } catch { view.toolTip = error.localizedDescription }
    }
}

struct BatchRow: View {
    @Binding var item: LabelItem
    let settings: LabelSettings
    let previewed: Bool
    let preview: () -> Void
    let remove: () -> Void
    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Button(action: preview) { Image(systemName: previewed ? "eye.fill" : "eye") }.help(t("Preview label"))
            VStack(spacing: 6) {
                HStack {
                    TextField(t("Product title"), text: $item.title)
                    if settings.design == .price {
                        TextField(t("Customer price"), text: $item.price).frame(width: 85)
                        Text(item.currencyCode ?? settings.currency).font(.caption).frame(width: 35)
                    }
                }
                if settings.design == .price {
                    ForEach(Binding(get: { item.extraPrices ?? [] }, set: { item.extraPrices = $0 })) { $price in
                        HStack {
                            Spacer(); TextField(t("Customer price"), text: $price.amount).frame(width: 85)
                            Text(price.currency).font(.caption).frame(width: 35)
                        }
                    }
                } else {
                    HStack { TextField("SKU", text: $item.sku); TextField(t("Barcode value"), text: $item.barcode) }
                    if settings.design == .product {
                        HStack {
                            TextField(t("Country of origin"), text: $item.origin).frame(width: 110)
                            TextField(t("Details / material / size"), text: $item.details)
                        }
                    }
                }
            }.textFieldStyle(.roundedBorder)
            TextField(t("Copies"), value: $item.copies, format: .number).frame(width: 45).textFieldStyle(.roundedBorder)
            Stepper(t("Copies"), value: $item.copies, in: 1...1000).labelsHidden().frame(width: 18)
            Button(role: .destructive, action: remove) { Image(systemName: "trash") }.help(t("Remove label"))
        }.padding(9).background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 6))
    }
}
