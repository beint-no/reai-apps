import AppKit
import CoreImage.CIFilterBuiltins
import PDFKit
import SwiftUI

struct LocationPrintRecord: Codable {
    let tenantId: Int
    let locationId: Int
    let name: String
    var state: String
    let printerId: String
    let size: String
    var queueResult: String?
}

enum LocationLabelSize: String, CaseIterable, Identifiable {
    case small = "60 × 40 mm", medium = "80 × 50 mm", large = "100 × 50 mm"
    var id: String { rawValue }
    var millimetres: CGSize {
        switch self {
        case .small: CGSize(width: 60, height: 40)
        case .medium: CGSize(width: 80, height: 50)
        case .large: CGSize(width: 100, height: 50)
        }
    }
}

enum LocationLabel {
    static func pdf(location: WarehouseLocation, warehouse: String, zone: String?, size: LocationLabelSize) throws -> Data {
        guard let code = location.scanCode, code.hasPrefix("reai:location:"),
              UUID(uuidString: String(code.dropFirst("reai:location:".count))) != nil else {
            throw appError("This location has no QR code. Refresh locations or update ReAI.")
        }
        let mm = 72.0 / 25.4
        var bounds = CGRect(origin: .zero, size: CGSize(width: size.millimetres.width * mm, height: size.millimetres.height * mm))
        let data = NSMutableData()
        guard let consumer = CGDataConsumer(data: data), let context = CGContext(consumer: consumer, mediaBox: &bounds, nil) else {
            throw appError("The location label could not be prepared.")
        }
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(code.utf8); filter.correctionLevel = "M"
        guard let image = filter.outputImage else {
            throw appError("The location label could not be prepared.")
        }
        context.beginPDFPage(nil)
        context.setFillColor(NSColor.white.cgColor); context.fill(bounds)
        let side = min(34.0, size.millimetres.height - 6) * mm
        // CI's QR has no quiet zone: reserve four modules on every side.
        let module = side / (image.extent.width + 8)
        let columns = Int(image.extent.width), rows = Int(image.extent.height)
        var pixels = [UInt8](repeating: 255, count: columns * rows * 4)
        pixels.withUnsafeMutableBytes { bytes in
            CIContext().render(image, toBitmap: bytes.baseAddress!, rowBytes: columns * 4,
                               bounds: image.extent, format: .RGBA8, colorSpace: CGColorSpaceCreateDeviceRGB())
        }
        context.setFillColor(NSColor.black.cgColor)
        context.setShouldAntialias(false)
        for y in 0..<rows { for x in 0..<columns where pixels[(y * columns + x) * 4] < 128 {
            context.fill(CGRect(x: 2 * mm + CGFloat(x + 4) * module,
                y: (bounds.height - side) / 2 + CGFloat(y + 4) * module, width: module, height: module))
        } }
        context.setShouldAntialias(true)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
        defer { NSGraphicsContext.restoreGraphicsState() }
        let x = side + 4 * mm
        let width = bounds.width - x - 2 * mm
        try draw(location.name, in: CGRect(x: x, y: bounds.height * 0.43, width: width, height: bounds.height * 0.49), maxSize: 14, bold: true)
        try draw([warehouse, zone].compactMap { $0 }.joined(separator: "\n"),
                 in: CGRect(x: x, y: 2 * mm, width: width, height: bounds.height * 0.37), maxSize: 8, bold: false)
        context.endPDFPage(); context.closePDF()
        return data as Data
    }

    private static func draw(_ text: String, in box: CGRect, maxSize: CGFloat, bold: Bool) throws {
        let paragraph = NSMutableParagraphStyle(); paragraph.lineBreakMode = .byWordWrapping
        var fontSize = maxSize
        while fontSize >= 5 {
            let font = bold ? NSFont.boldSystemFont(ofSize: fontSize) : NSFont.systemFont(ofSize: fontSize)
            let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor.black, .paragraphStyle: paragraph]
            let measured = (text as NSString).boundingRect(with: CGSize(width: box.width, height: .greatestFiniteMagnitude),
                options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: attributes)
            if measured.height <= box.height && measured.width <= box.width + 0.5 {
                (text as NSString).draw(in: box, withAttributes: attributes)
                return
            }
            fontSize -= 0.5
        }
        throw appError("The location name is too long for this label. Choose a larger label size.")
    }
}

struct LocationLabelsView: View {
    @Bindable var model: ShippingModel
    @State private var selected: WarehouseLocation?
    @State private var reprint: WarehouseLocation?
    private var visible: [WarehouseLocation] {
        model.locations.filter {
            (model.locationZoneId == 0 || $0.zoneId == model.locationZoneId) &&
            (model.locationSearch.isEmpty || ($0.name + " " + ($0.description ?? "")).localizedCaseInsensitiveContains(model.locationSearch))
        }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Picker(t("Warehouse"), selection: $model.warehouseId) {
                    Text(t("Choose a warehouse")).tag(0)
                    ForEach(model.warehouses) { Text($0.name).tag($0.id) }
                }.frame(maxWidth: 280).onChange(of: model.warehouseId) { Task { await model.refreshLocations() }; selected = nil }
                Picker(t("Zone"), selection: $model.locationZoneId) {
                    Text(t("All zones")).tag(0)
                    ForEach(model.locationZones) { Text($0.name).tag($0.id) }
                }.frame(maxWidth: 240)
                Spacer()
                Button(t("Refresh")) { Task { await model.refreshLocations() } }
            }.disabled(model.busy || model.loadingLocations)
            HStack {
                TextField(t("Find a location"), text: $model.locationSearch)
                Picker(t("Label size"), selection: $model.labelSize) {
                    ForEach(LocationLabelSize.allCases) { Text($0.rawValue).tag($0) }
                }.frame(width: 235)
            }.disabled(model.busy)
            Text(t("Match the label size to the roll loaded in your printer. One location per label, at actual size."))
                .font(.caption).foregroundStyle(.secondary)
            if model.loadingLocations { ProgressView().controlSize(.small) }
            HSplitView {
                List(visible) { location in
                    HStack(alignment: .top) {
                        Button { selected = location } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(location.name).fontWeight(.semibold)
                                if let description = location.description { Text(description).font(.caption).foregroundStyle(.secondary) }
                                if let record = model.locationRecord(location.id) {
                                    Text(t(record.state == "queued" ? "In printer queue" : "Check before reprinting") + " · " + record.printerId).font(.caption).foregroundStyle(.secondary)
                                    if let result = record.queueResult { Text(result).font(.caption).textSelection(.enabled) }
                                }
                            }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                        }.buttonStyle(.plain)
                        Button(t(model.locationRecord(location.id) == nil ? "Print label" : "Print again")) {
                            selected = location
                            if model.locationRecord(location.id) != nil { reprint = location }
                            else { Task { await model.printLocation(location) } }
                        }.disabled(!model.canPrint || model.loadingLocations)
                    }.padding(.vertical, 6)
                }.frame(minWidth: 340)
                VStack(alignment: .leading, spacing: 12) {
                    Text(t("Preview")).font(.headline)
                    if let location = selected, model.locations.contains(where: { $0.id == location.id }) {
                        if let data = try? model.locationPDF(location), let pdf = PDFDocument(data: data), let page = pdf.page(at: 0) {
                            Image(nsImage: page.thumbnail(of: CGSize(width: 600, height: 400), for: .mediaBox))
                                .resizable().aspectRatio(contentMode: .fit).frame(maxWidth: 380, maxHeight: 300)
                        } else { Text(t("The location name is too long for this label. Choose a larger label size.")).foregroundStyle(.orange) }
                    } else { Text(t("Choose a location to preview its QR label.")).foregroundStyle(.secondary) }
                    Spacer()
                }.padding(16).frame(minWidth: 260)
            }
            if visible.isEmpty && !model.loadingLocations {
                Text(t("No locations found. Create locations in ReAI, then refresh here.")).foregroundStyle(.secondary)
            }
        }.padding(20).task { await model.refreshLocations() }
        .confirmationDialog(t("Print again? Check the printer queue first."), isPresented: Binding(get: { reprint != nil }, set: { if !$0 { reprint = nil } })) {
            if let location = reprint { Button(t("Print again")) { Task { await model.printLocation(location, confirmed: true) }; reprint = nil } }
        } message: {
            if let location = reprint { Text(location.name + " · " + model.labelSize.rawValue) }
        }
    }
}
