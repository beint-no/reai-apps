import AppKit
import ImageCaptureCore
import PDFKit
import SwiftUI
import UniformTypeIdentifiers

struct Unchecked<Value>: @unchecked Sendable { let value: Value }

enum PDFBuilder {
    /// Combines scanned pages (images or PDFs) into one PDF, in order.
    static func combine(_ pages: [URL]) throws -> Data {
        let document = PDFDocument()
        for url in pages {
            if url.pathExtension.lowercased() == "pdf", let pdf = PDFDocument(url: url) {
                for index in 0..<pdf.pageCount {
                    if let page = pdf.page(at: index)?.copy() as? PDFPage { document.insert(page, at: document.pageCount) }
                }
            } else if let image = NSImage(contentsOf: url),
                      let page = PDFPage(image: image, options: [.compressionQuality: 0.75]) {
                document.insert(page, at: document.pageCount)
            } else {
                throw appError("\(url.lastPathComponent) could not be added to the PDF.")
            }
        }
        guard document.pageCount > 0, let data = document.dataRepresentation() else {
            throw appError("The scan could not be saved as a PDF.")
        }
        guard data.count <= ScannerStorage.maximumSize else {
            throw appError("The combined PDF is larger than 20 MB. Scan fewer pages or a lower resolution.")
        }
        return data
    }
}

// MARK: Continuity Camera

/// A button that offers Continuity Camera (Take Photo, Scan Documents) from a nearby iPhone or iPad.
struct DeviceImportButton: NSViewRepresentable {
    var title = "Import from iPhone…"
    let onImport: @MainActor (Data, String) -> Void

    func makeNSView(context: Context) -> DeviceImportControl {
        let control = DeviceImportControl(title: title, target: nil, action: nil)
        control.bezelStyle = .rounded
        control.onImport = onImport
        return control
    }

    func updateNSView(_ control: DeviceImportControl, context: Context) {
        control.title = title
        control.onImport = onImport
    }
}

final class DeviceImportControl: NSButton, @preconcurrency NSServicesMenuRequestor {
    var onImport: @MainActor (Data, String) -> Void = { _, _ in }
    private static let jpeg = NSPasteboard.PasteboardType(UTType.jpeg.identifier)
    private static let heic = NSPasteboard.PasteboardType(UTType.heic.identifier)
    static let returnTypes: [NSPasteboard.PasteboardType] = [.pdf, jpeg, heic, .tiff, .png]

    override init(frame: NSRect) {
        super.init(frame: frame)
        target = self
        action = #selector(showMenu)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var acceptsFirstResponder: Bool { true }

    @objc private func showMenu() {
        window?.makeFirstResponder(self)
        let menu = NSMenu()
        let item = NSMenuItem(title: "Import from iPhone or iPad", action: nil, keyEquivalent: "")
        item.identifier = NSMenuItem.importFromDeviceIdentifier
        menu.addItem(item)
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: bounds.height + 4), in: self)
    }

    override func validRequestor(forSendType sendType: NSPasteboard.PasteboardType?, returnType: NSPasteboard.PasteboardType?) -> Any? {
        if sendType == nil, let returnType, Self.returnTypes.contains(returnType) { return self }
        return super.validRequestor(forSendType: sendType, returnType: returnType)
    }

    func readSelection(from pasteboard: NSPasteboard) -> Bool {
        let stamp = FileStamp.now
        if let pdf = pasteboard.data(forType: .pdf) {
            onImport(pdf, "iPhone scan \(stamp).pdf")
        } else if let jpeg = pasteboard.data(forType: Self.jpeg) {
            onImport(jpeg, "iPhone photo \(stamp).jpg")
        } else if let heic = pasteboard.data(forType: Self.heic) {
            onImport(heic, "iPhone photo \(stamp).heic")
        } else if let image = NSImage(pasteboard: pasteboard), let tiff = image.tiffRepresentation,
                  let jpeg = NSBitmapImageRep(data: tiff)?.representation(using: .jpeg, properties: [.compressionFactor: 0.85]) {
            onImport(jpeg, "iPhone photo \(stamp).jpg")
        } else {
            return false
        }
        return true
    }
}

// MARK: Scanners

/// Finds document scanners with Image Capture and collects scanned pages until they are combined into one PDF.
@MainActor @Observable
final class ScannerSession: NSObject {
    enum Source: String, CaseIterable, Identifiable {
        case flatbed = "Flatbed"
        case feeder = "Document feeder"
        var id: String { rawValue }
        var type: ICScannerFunctionalUnitType { self == .flatbed ? .flatbed : .documentFeeder }
    }

    var scanners: [ICScannerDevice] = []
    var selectedName: String?
    var sources: [Source] = []
    var source = Source.flatbed
    var resolution = 300
    var pages: [URL] = []
    var status = "Looking for scanners…"
    var ready = false
    var scanning = false
    private let browser = ICDeviceBrowser()
    private var current: ICScannerDevice?
    private let folder = FileManager.default.temporaryDirectory.appendingPathComponent("ReAI scans " + UUID().uuidString, isDirectory: true)

    func start() {
        browser.delegate = self
        let local = ICDeviceLocationTypeMask.local.rawValue | ICDeviceLocationTypeMask.shared.rawValue | ICDeviceLocationTypeMask.bonjour.rawValue
        if let mask = ICDeviceTypeMask(rawValue: ICDeviceTypeMask.scanner.rawValue | local) { browser.browsedDeviceTypeMask = mask }
        browser.start()
    }

    func stop() {
        browser.stop()
        current?.requestCloseSession()
        current = nil
        try? FileManager.default.removeItem(at: folder)
    }

    func select(_ name: String?) {
        current?.requestCloseSession()
        current = nil
        ready = false
        sources = []
        selectedName = name
        guard let scanner = scanners.first(where: { $0.name == name }) else { return }
        current = scanner
        scanner.delegate = self
        status = "Connecting to \(scanner.name ?? "the scanner")…"
        scanner.requestOpenSession()
    }

    func chooseSource(_ source: Source) {
        self.source = source
        guard let current else { return }
        ready = false
        current.requestSelect(source.type)
    }

    func scan() {
        guard let scanner = current, ready, !scanning else { return }
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        } catch { status = error.localizedDescription; return }
        let unit = scanner.selectedFunctionalUnit
        let supported = unit.supportedResolutions
        unit.resolution = supported.contains(resolution) ? resolution
            : supported.min(by: { abs($0 - resolution) < abs($1 - resolution) }) ?? unit.preferredResolutions.first ?? unit.resolution
        unit.pixelDataType = .RGB
        unit.bitDepth = .depth8Bits
        unit.scanArea = NSRect(origin: .zero, size: unit.physicalSize)
        if let feeder = unit as? ICScannerFunctionalUnitDocumentFeeder {
            feeder.documentType = Locale.current.region == .unitedStates ? .typeUSLetter : .typeA4
        }
        scanner.transferMode = .fileBased
        scanner.downloadsDirectory = folder
        scanner.documentName = "Page"
        scanner.documentUTI = UTType.jpeg.identifier
        scanning = true
        status = "Scanning…"
        scanner.requestScan()
    }

    func removeLastPage() {
        guard let last = pages.popLast() else { return }
        try? FileManager.default.removeItem(at: last)
    }

    func combined() throws -> Data { try PDFBuilder.combine(pages) }

    func reset() {
        for page in pages { try? FileManager.default.removeItem(at: page) }
        pages = []
    }

    fileprivate func added(_ device: ICDevice) {
        guard let scanner = device as? ICScannerDevice, !scanners.contains(where: { $0 === scanner }) else { return }
        scanners.append(scanner)
        if selectedName == nil { select(scanner.name) }
    }

    fileprivate func removed(_ device: ICDevice) {
        scanners.removeAll { $0 === device }
        if current === device { current = nil; ready = false; selectedName = nil; status = "The scanner was disconnected." }
        if scanners.isEmpty, current == nil { status = "No scanner found. Connect a scanner or add it in System Settings → Printers & Scanners." }
    }

    fileprivate func opened(_ device: ICDevice, error: (any Error)?) {
        guard let scanner = device as? ICScannerDevice, scanner === current else { return }
        if let error { status = "Could not connect: \(error.localizedDescription)"; return }
        let types = scanner.availableFunctionalUnitTypes.compactMap { ICScannerFunctionalUnitType(rawValue: $0.uintValue) }
        sources = Source.allCases.filter { types.contains($0.type) }
        if !sources.contains(source), let first = sources.first { source = first }
        status = "Preparing \(source.rawValue.lowercased())…"
        scanner.requestSelect(source.type)
    }

    fileprivate func selected(_ scanner: ICScannerDevice, error: (any Error)?) {
        guard scanner === current else { return }
        if let error { status = "Could not use the \(source.rawValue.lowercased()): \(error.localizedDescription)"; return }
        ready = true
        status = "Ready to scan with \(scanner.name ?? "the scanner")."
    }

    fileprivate func scanned(_ url: URL) {
        pages.append(url)
    }

    fileprivate func completed(error: (any Error)?) {
        scanning = false
        status = error.map { "Scan failed: \($0.localizedDescription)" } ?? "\(pages.count) \(pages.count == 1 ? "page" : "pages") scanned."
    }
}

extension ScannerSession: ICDeviceBrowserDelegate, ICScannerDeviceDelegate {
    nonisolated func deviceBrowser(_ browser: ICDeviceBrowser, didAdd device: ICDevice, moreComing: Bool) {
        let box = Unchecked(value: device)
        Task { @MainActor in self.added(box.value) }
    }

    nonisolated func deviceBrowser(_ browser: ICDeviceBrowser, didRemove device: ICDevice, moreGoing: Bool) {
        let box = Unchecked(value: device)
        Task { @MainActor in self.removed(box.value) }
    }

    nonisolated func didRemove(_ device: ICDevice) {
        let box = Unchecked(value: device)
        Task { @MainActor in self.removed(box.value) }
    }

    nonisolated func device(_ device: ICDevice, didOpenSessionWithError error: (any Error)?) {
        let box = Unchecked(value: device)
        Task { @MainActor in self.opened(box.value, error: error) }
    }

    nonisolated func device(_ device: ICDevice, didCloseSessionWithError error: (any Error)?) {}

    nonisolated func scannerDevice(_ scanner: ICScannerDevice, didSelect functionalUnit: ICScannerFunctionalUnit, error: (any Error)?) {
        let box = Unchecked(value: scanner)
        Task { @MainActor in self.selected(box.value, error: error) }
    }

    nonisolated func scannerDevice(_ scanner: ICScannerDevice, didScanTo url: URL) {
        Task { @MainActor in self.scanned(url) }
    }

    nonisolated func scannerDevice(_ scanner: ICScannerDevice, didCompleteScanWithError error: (any Error)?) {
        Task { @MainActor in self.completed(error: error) }
    }
}

struct ScannerSheet: View {
    @Bindable var model: ScannerModel
    @State private var session = ScannerSession()
    @State private var destination: Destination
    @State private var problem: String?
    @Environment(\.dismiss) private var dismiss

    init(model: ScannerModel) {
        self.model = model
        _destination = State(initialValue: model.destination)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Scan with a scanner").font(.title2.bold())
            Picker("Scanner", selection: Binding(get: { session.selectedName }, set: { session.select($0) })) {
                if session.scanners.isEmpty { Text("None found").tag(String?.none) }
                ForEach(session.scanners, id: \.self) { scanner in Text(scanner.name ?? "Scanner").tag(scanner.name) }
            }
            if session.sources.count > 1 {
                Picker("Source", selection: Binding(get: { session.source }, set: { session.chooseSource($0) })) {
                    ForEach(session.sources) { Text($0.rawValue).tag($0) }
                }.pickerStyle(.segmented)
            }
            Picker("Resolution", selection: $session.resolution) {
                Text("150 dpi").tag(150)
                Text("300 dpi").tag(300)
            }.pickerStyle(.segmented)
            Picker("Upload to", selection: $destination) {
                ForEach(Destination.allCases) { Text($0.rawValue).tag($0) }
            }
            Text(session.status).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack {
                Button(session.pages.isEmpty ? "Scan" : "Scan another page", systemImage: "scanner") { session.scan() }
                    .disabled(!session.ready || session.scanning)
                if session.scanning { ProgressView().controlSize(.small) }
                Spacer()
                Button("Remove last page") { session.removeLastPage() }.disabled(session.pages.isEmpty || session.scanning)
            }
            Text("Pages are combined into one PDF, in the order scanned. A document feeder scans all loaded pages at once.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if let problem { Text(problem).font(.caption).foregroundStyle(.red).textSelection(.enabled) }
            HStack {
                Button("Cancel", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                Spacer()
                Button(session.pages.count > 1 ? "Upload \(session.pages.count) pages as one PDF" : "Upload PDF") {
                    do {
                        let data = try session.combined()
                        let destination = destination
                        Task { await model.addScan(data, filename: "Scan \(FileStamp.now).pdf", destination: destination) }
                        dismiss()
                    } catch { problem = error.localizedDescription }
                }
                .buttonStyle(.borderedProminent).tint(.teal)
                .disabled(session.pages.isEmpty || session.scanning || model.company == nil)
            }
        }
        .padding(24).frame(width: 460)
        .onAppear { session.start() }
        .onDisappear { session.stop() }
    }
}
