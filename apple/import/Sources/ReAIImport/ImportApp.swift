import SwiftUI

@main
struct ImportApp: App {
    @State private var model = ImportModel()
    var body: some Scene {
        Window("ReAI Import", id: "import") {
            ImportView(model: model).frame(minWidth: 980, minHeight: 720).task { await model.start() }
        }
        .defaultSize(width: 1160, height: 800)
    }
}
struct ImportView: View {
    @Bindable var model: ImportModel
    @State private var targeted = false
    @State private var confirmImport = false
    @State private var confirmNew = false
    @State private var selection: Int?
    @State private var filter = "All rows"
    var body: some View {
        HStack(spacing: 0) {
            sidebar.frame(width: 210)
            Divider()
            VStack(alignment: .leading, spacing: 18) {
                header
                if let error = model.error {
                    HStack(alignment: .top) {
                        Image(systemName: "exclamationmark.circle").foregroundStyle(.orange)
                        Text(error).font(.callout).textSelection(.enabled)
                        Spacer()
                        Button { model.error = nil } label: { Image(systemName: "xmark") }.buttonStyle(.plain).accessibilityLabel("Dismiss error")
                    }.padding(12).background(.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                }
                if model.connecting {
                    HStack {
                        ProgressView().controlSize(.small)
                        VStack(alignment: .leading) {
                            Text("Choose a company in your browser")
                            Text(model.connectionCode).font(.title2.monospaced().bold()).textSelection(.enabled)
                            Text("Only approve if this code matches ReAI.").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer(); Button("Cancel", action: model.cancelConnection)
                    }
                }
                if model.batch != nil { reviewView }
                else if model.sheets.isEmpty { dropZone }
                else { mappingView }
                if model.busy { HStack { ProgressView().controlSize(.small); Text(model.progress).foregroundStyle(.secondary) } }
            }.padding(28).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .tint(.teal)
        .alert("Import \(model.readyCount) \(model.readyCount == 1 ? model.kind.singular : model.kind.rawValue)?", isPresented: $confirmImport) {
            Button("Cancel", role: .cancel) {}
            Button("Create in ReAI", action: model.runImport)
        } message: {
            Text("Create new records in \(model.company?.companyName ?? "ReAI"). Skipped and invalid rows are excluded. Existing records will not be updated. Completed imports are not automatically undone.")
        }
        .alert("Start a new import?", isPresented: $confirmNew) {
            Button("Cancel", role: .cancel) {}
            Button("New import") { selection = nil; model.newImport() }
        } message: { Text("This replaces the local report. Export it first if you need a copy. Check any uncertain rows in ReAI before including them in another file.") }
    }
    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 24) {
            Label("ReAI Import", systemImage: "square.and.arrow.down.on.square").font(.headline).foregroundStyle(.teal)
            VStack(alignment: .leading, spacing: 6) {
                Text("IMPORT").font(.caption.weight(.semibold)).foregroundStyle(.secondary).padding(.bottom, 4)
                ForEach(ImportKind.allCases) { kind in
                    Button {
                        model.kind = kind; model.remap()
                    } label: {
                        Label(kind.title, systemImage: kind.symbol).font(.body.weight(.medium))
                            .frame(maxWidth: .infinity, alignment: .leading).padding(11)
                            .background(model.kind == kind ? Color.teal.opacity(0.12) : .clear, in: RoundedRectangle(cornerRadius: 8))
                    }.buttonStyle(.plain).disabled(model.busy || model.importing || model.batch != nil)
                }
            }
            Spacer()
            VStack(alignment: .leading, spacing: 10) {
                Label("Read locally", systemImage: "lock.shield").font(.callout.weight(.medium))
                Text("Files and column matching stay on your Mac. Only confirmed records are sent to ReAI.").font(.caption).foregroundStyle(.secondary)
                Link("Manage app access ↗", destination: AppEnvironment.profile).font(.caption)
            }
        }.padding(20).frame(maxHeight: .infinity).background(.quaternary.opacity(0.35))
    }
    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Import \(model.kind.rawValue)").font(.largeTitle.bold())
                Text(model.batch != nil ? "3  Review & import" : model.sheets.isEmpty ? "1  Choose a file" : "2  Match columns").font(.callout).foregroundStyle(.secondary)
            }
            Spacer()
            if let company = model.company {
                VStack(alignment: .trailing, spacing: 5) {
                    Label(company.companyName, systemImage: "checkmark.shield.fill").font(.callout.weight(.medium))
                    Text(model.email).font(.caption).foregroundStyle(.secondary)
                    Button("Disconnect", action: model.disconnect).buttonStyle(.link).disabled(model.busy || model.importing)
                }
            } else { Button("Connect to ReAI", action: model.connectInBrowser).buttonStyle(.borderedProminent).disabled(model.connecting || model.busy) }
        }
    }
    private var dropZone: some View {
        VStack(spacing: 20) {
            Spacer()
            Image(systemName: "tablecells.badge.ellipsis").font(.system(size: 58, weight: .light)).foregroundStyle(.teal)
            Text("Drop a spreadsheet here").font(.title2.bold())
            Text("Excel .xlsx, CSV or TSV\nUp to 10,000 rows · 10 MB").multilineTextAlignment(.center).foregroundStyle(.secondary)
            Button("Choose file…", action: model.chooseFile).buttonStyle(.borderedProminent).controlSize(.large).disabled(model.busy)
            Button("Download \(model.kind.rawValue) template", action: model.saveTemplate).buttonStyle(.link)
            Spacer()
            Text("Review the column matches and row preview before creating anything.").font(.callout).foregroundStyle(.secondary)
        }.padding(32).frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(.teal.opacity(targeted ? 0.12 : 0.035), in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(.teal.opacity(0.25), style: StrokeStyle(lineWidth: 1.5, dash: [6])))
            .dropDestination(for: URL.self) { urls, _ in
                guard urls.count == 1, let url = urls.first, !model.busy else { return false }
                model.load(url); return true
            } isTargeted: { targeted = $0 }
    }
    private var mappingView: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Label(model.filename, systemImage: "doc.text").lineLimit(1)
                Spacer(); Button("Choose another file…", action: model.chooseFile)
            }
            HStack {
                Picker("Sheet", selection: $model.sheetIndex) {
                    ForEach(model.sheets.indices, id: \.self) { Text(model.sheets[$0].name).tag($0) }
                }.frame(maxWidth: 330).onChange(of: model.sheetIndex) { model.headerRow = 0; model.remap() }
                Stepper("Header row: \(model.headerRow + 1)", value: $model.headerRow, in: 0...max(0, min(model.rows.count - 1, 99)))
                    .onChange(of: model.headerRow) { model.remap() }
            }
            Text("Column names are matched locally in English and Norwegian. Check each match; unassigned columns are ignored.").font(.callout).foregroundStyle(.secondary)
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(model.headers.indices, id: \.self) { column in
                        HStack(spacing: 14) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(model.headers[column].isEmpty ? "Column \(column + 1)" : model.headers[column]).fontWeight(.medium).lineLimit(1)
                                Text(sample(column)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }.frame(maxWidth: .infinity, alignment: .leading)
                            Image(systemName: "arrow.right").foregroundStyle(.tertiary)
                            Picker("Map column \(column + 1)", selection: Binding(get: { model.mapping.indices.contains(column) ? model.mapping[column] : "" }, set: { model.mapping[column] = $0 })) {
                                Text("Do not import").tag("")
                                ForEach(Fields.forKind(model.kind)) { field in Text(field.title + (field.required ? " *" : "")).tag(field.id) }
                            }.labelsHidden().frame(width: 280)
                        }.padding(.vertical, 12)
                        Divider()
                    }
                }.padding(.horizontal, 16)
            }.background(.background, in: RoundedRectangle(cornerRadius: 10))
            HStack(spacing: 20) {
                if model.kind == .products {
                    Picker("Decimal separator", selection: $model.decimalComma) { Text("Dot · 1,234.56").tag(false); Text("Comma · 1.234,56").tag(true) }.frame(width: 290)
                } else {
                    Picker("Default contact type", selection: $model.privatePeople) { Text("Company").tag(false); Text("Private person").tag(true) }.frame(width: 300)
                }
                Spacer()
                Text("Source rows: \(max(0, model.rows.count - model.headerRow - 1))").foregroundStyle(.secondary)
            }
            Text(model.kind == .products ? "One product / variant per row. Prices exclude VAT. Stock item defaults to Yes; omitted VAT/account fields use ReAI defaults. Excel numeric cells use a dot." : "Country defaults to NO. Norwegian companies need an organization number. Mapped contact type overrides the default. Registry lookup is skipped to preserve your file values.")
                .font(.caption).foregroundStyle(.secondary)
            HStack { Spacer(); Button("Review import", action: model.review).buttonStyle(.borderedProminent).controlSize(.large) }
        }.disabled(model.busy || model.connecting)
    }
    private func sample(_ column: Int) -> String {
        model.rows.dropFirst(model.headerRow + 1).prefix(3).compactMap { $0.indices.contains(column) && !$0[column].isEmpty ? $0[column] : nil }.joined(separator: " · ")
    }
    private var reviewView: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let batch = model.batch {
                Text("\(batch.filename) → \(batch.company.companyName)").font(.headline)
                HStack(spacing: 24) {
                    countLabel("Ready", count: model.readyCount, color: .teal)
                    countLabel("Created", count: model.createdCount, color: .green)
                    countLabel("Needs correction", count: batch.rows.filter { [.invalid, .rejected, .uncertain].contains($0.state) }.count, color: .orange)
                    countLabel("Skipped", count: batch.rows.filter { $0.state == .skipped }.count, color: .secondary)
                    Spacer()
                }
                Picker("Show", selection: $filter) { Text("All rows").tag("All rows"); Text("Needs attention").tag("Needs attention"); Text("Ready").tag("Ready") }.pickerStyle(.segmented).frame(maxWidth: 420)
                Table(visibleRows, selection: $selection) {
                    TableColumn("Row") { Text(String($0.line)).monospacedDigit() }.width(42)
                    TableColumn("Name", value: \.name).width(min: 120, ideal: 190)
                    TableColumn("Status") { Text($0.state.rawValue).foregroundStyle($0.state == .created ? .green : $0.state == .invalid || $0.state == .uncertain || $0.state == .rejected ? .orange : .primary) }.width(110)
                    TableColumn("Details", value: \.detail)
                }.frame(minHeight: 180)
                if let row = batch.rows.first(where: { $0.id == selection }) {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("Row \(row.line): \(row.detail)").font(.callout).textSelection(.enabled)
                            Spacer()
                            if row.state == .ready { Button("Exclude row") { model.skip(row.id) }.disabled(model.importing || model.busy) }
                        }
                        ScrollView {
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 160), alignment: .leading)], alignment: .leading, spacing: 12) {
                                ForEach(row.preview(kind: batch.kind)) { value in
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(value.title).font(.caption).foregroundStyle(.secondary)
                                        Text(value.value).font(.callout).textSelection(.enabled)
                                    }
                                }
                            }
                        }.frame(maxHeight: 100)
                    }.padding(12).background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 8))
                }
                Text("Existing matches are skipped; no records are overwritten. Select a row to inspect its exact values. Correct invalid rows in your source file, then start a new import.").font(.caption).foregroundStyle(.secondary)
                if model.importing {
                    ProgressView(model.progress, value: Double(batch.rows.filter { $0.state != .ready && $0.state != .sending }.count), total: Double(max(1, batch.rows.count)))
                }
                HStack {
                    Button("New import") { confirmNew = true }.disabled(model.importing || model.busy)
                    if !model.sheets.isEmpty && batch.rows.allSatisfy({ [.ready, .invalid, .skipped].contains($0.state) }) {
                        Button("Edit mapping", action: model.editMapping).disabled(model.importing || model.busy)
                    }
                    Button("Export report…", action: model.exportReport)
                    Spacer()
                    if model.importing { Button(model.stopRequested ? "Stopping after this row…" : "Pause after this row") { model.stopRequested = true }.disabled(model.stopRequested) }
                    else { Button("Import \(model.readyCount) \(model.readyCount == 1 ? "row" : "rows")") { confirmImport = true }.buttonStyle(.borderedProminent).controlSize(.large).disabled(!model.canImport) }
                }
                if batch.company.id != model.company?.id || batch.email != model.email {
                    Text("Connect with \(batch.email) to \(batch.company.companyName) to continue this import.").font(.callout).foregroundStyle(.orange)
                }
            }
        }
    }
    private var visibleRows: [ImportRow] {
        (model.batch?.rows ?? []).filter { filter == "All rows" || (filter == "Ready" ? $0.state == .ready : [.invalid, .rejected, .uncertain].contains($0.state)) }
    }
    private func countLabel(_ title: String, count: Int, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) { Text(String(count)).font(.title2.bold()).foregroundStyle(color); Text(title).font(.caption).foregroundStyle(.secondary) }
    }
}
