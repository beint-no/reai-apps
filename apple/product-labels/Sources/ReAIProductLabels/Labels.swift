import AppKit
import CoreImage.CIFilterBuiltins

struct LabelPrice: Codable, Identifiable, Equatable, Sendable {
    var id = UUID()
    var currency: String
    var amount: String
}
struct LabelItem: Codable, Identifiable, Equatable, Sendable {
    var id = UUID()
    var title = ""
    var price = ""
    var sku = ""
    var barcode = ""
    var origin = ""
    var details = ""
    var copies = 1
    var currencyCode: String?
    var extraPrices: [LabelPrice]?
    var variantUUID: UUID?
    var note: String?
}
enum LineRole: String, Codable, CaseIterable, Identifiable, Sendable {
    case title, note, price, metadata, barcodeText
    var id: String { rawValue }
    var title: String { switch self { case .title: "Product title"; case .note: "Extra text"; case .price: "Customer price"; case .metadata: "Product details"; case .barcodeText: "Barcode value" } }
}
enum LineAlignment: String, Codable, CaseIterable, Identifiable, Sendable {
    case left, center, right
    var id: String { rawValue }
    var text: NSTextAlignment { switch self { case .left: .left; case .center: .center; case .right: .right } }
    var symbol: String { "text.align" + (self == .center ? "center" : rawValue) }
}
struct LineStyle: Codable, Equatable, Sendable {
    var size: Double?
    var bold: Bool?
    var alignment: LineAlignment?
    var offset: Double?
}
enum LabelDesign: String, CaseIterable, Codable, Identifiable {
    case price, product, barcode
    var id: String { rawValue }
    var title: String { switch self { case .price: "Price label"; case .product: "Product label"; case .barcode: "Barcode label" } }
}
struct LabelSettings: Codable, Equatable {
    var design = LabelDesign.price
    var width = 50.0
    var height = 30.0
    var currency = "NOK"
    var printer = ""
    var locale = ["nb", "nn", "no"].contains(Locale.current.language.languageCode?.identifier ?? "") ? "nb_NO" : "en_US"
    var styles: [String: LineStyle]?
    var skuPrefix: String?
    var originPrefix: String?
    var currencyTexts: [String: String]?
    var customized: Bool { !(styles ?? [:]).isEmpty || skuPrefix != nil || originPrefix != nil || !(currencyTexts ?? [:]).isEmpty }
    func style(_ role: LineRole) -> LineStyle { styles?[design.rawValue + "." + role.rawValue] ?? LineStyle() }
    mutating func setStyle(_ style: LineStyle, for role: LineRole) {
        var all = styles ?? [:]; all[design.rawValue + "." + role.rawValue] = style == LineStyle() ? nil : style
        styles = all.isEmpty ? nil : all
    }
    var resolvedSkuPrefix: String { skuPrefix ?? "SKU:" }
    var resolvedOriginPrefix: String { originPrefix ?? t("Country of origin") + ":" }
    var size: CGSize { CGSize(width: width * 72 / 25.4, height: height * 72 / 25.4) }
    static let sizes = ["50 × 30 mm", "60 × 40 mm", "70 × 50 mm", "100 × 50 mm", "38 × 25 mm", "62 × 29 mm", "89 × 36 mm"]
    static let dimensions: [(Double, Double)] = [(50,30), (60,40), (70,50), (100,50), (38,25), (62,29), (89,36)]
}

@MainActor
enum LabelRenderer {
    private static let imageContext = CIContext()
    static func currencyText(_ currency: String, settings: LabelSettings, multiple: Bool) -> String {
        if let custom = settings.currencyTexts?[currency] { return custom }
        if currency == "None" { return "" }
        return currency == "NOK" && !multiple ? "kr" : currency
    }
    static func price(_ value: String, settings: LabelSettings, multiple: Bool = false) throws -> String {
        let raw = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let locale = Locale(identifier: settings.locale)
        let separator = locale.decimalSeparator ?? "."
        let pattern = "^[0-9]{1,9}(" + NSRegularExpression.escapedPattern(for: separator) + "[0-9]{1,2})?$"
        guard raw.range(of: pattern, options: .regularExpression) != nil,
              let number = Decimal(string: raw.replacingOccurrences(of: separator, with: "."), locale: Locale(identifier: "en_US_POSIX")) else {
            throw appError("Enter a whole price, or up to two decimals in your selected number format, without thousands separators.")
        }
        let f = NumberFormatter(); f.locale = locale; f.numberStyle = .decimal
        f.usesGroupingSeparator = false; f.minimumFractionDigits = 0; f.maximumFractionDigits = 0; f.roundingMode = .halfUp
        let text = f.string(from: number as NSDecimalNumber) ?? raw
        let suffix = currencyText(settings.currency, settings: settings, multiple: multiple)
        return suffix.isEmpty ? text : text + " " + suffix
    }
    static func displayedPrices(_ item: LabelItem, settings: LabelSettings) throws -> [String] {
        let values = [LabelPrice(currency: item.currencyCode ?? settings.currency, amount: item.price)] + (item.extraPrices ?? [])
        guard values.count <= 4, Set(values.map(\.currency)).count == values.count else {
            throw appError("Choose up to four different currencies per label.")
        }
        return try values.map { value in
            var format = settings; format.currency = value.currency
            return try price(value.amount, settings: format, multiple: values.count > 1)
        }
    }
    static func validate(_ item: LabelItem, settings: LabelSettings) throws {
        guard settings.width.isFinite, settings.height.isFinite, (25...110).contains(settings.width), (20...150).contains(settings.height) else {
            throw appError("Choose a width of 25–110 mm and a height of 20–150 mm.")
        }
        guard (1...1000).contains(item.copies), item.title.count <= 160, (item.note ?? "").count <= 120, item.details.count <= 200,
              item.sku.count <= 60, item.origin.count <= 80, item.barcode.count <= 80 else { throw appError("Shorten the label text or choose 1–1000 copies.") }
        if settings.design == .price { _ = try displayedPrices(item, settings: settings) }
        if settings.design != .price && item.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            throw appError("Enter a product title.")
        }
        if settings.design == .barcode && item.barcode.isEmpty { throw appError("Enter a barcode value.") }
        if settings.design != .price && !item.barcode.isEmpty { _ = try barcodeImage(item.barcode, width: settings.size.width - 16) }
        // Reject overflowing text instead of quietly removing product information.
        _ = try layout(item, settings: settings)
    }
    static func barcodeImage(_ value: String, width: CGFloat) throws -> CGImage {
        guard value.utf8.allSatisfy({ (32...126).contains($0) }), !value.isEmpty else { throw appError("Code 128 barcodes support printable ASCII characters only.") }
        let filter = CIFilter.code128BarcodeGenerator()
        filter.message = Data(value.utf8); filter.quietSpace = 10
        guard let output = filter.outputImage, width / output.extent.width >= 0.72,
              let image = imageContext.createCGImage(output, from: output.extent) else {
            throw appError("The barcode is too long for this label. Choose a wider label or a shorter code.")
        }
        return image
    }
    struct TextLine { let text: String; let rect: CGRect; let font: NSFont; let alignment: NSTextAlignment; let role: LineRole; let index: Int }
    static func layout(_ item: LabelItem, settings: LabelSettings) throws -> [TextLine] {
        let w = settings.size.width - 16, h = settings.size.height - 16
        var lines: [TextLine] = []
        func add(_ role: LineRole, _ text: String, index: Int = 0, y: CGFloat, height: CGFloat, maxSize: CGFloat, minSize: CGFloat, bold: Bool, centered: Bool = false) throws {
            guard !text.isEmpty else { return }
            let style = settings.style(role), fixed = style.size.map { CGFloat($0) }
            let top = y + 8 + CGFloat(style.offset ?? 0) * 72 / 25.4
            var size = fixed ?? maxSize
            while size >= (fixed ?? minSize) {
                let font = NSFont.systemFont(ofSize: size, weight: style.bold ?? bold ? .bold : .regular)
                let bounds = (text as NSString).boundingRect(with: CGSize(width: w, height: 10000), options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: font])
                // A chosen size may take more room than the automatic slot, as long as it stays on the label.
                let needed = ceil(bounds.height) + 4, lineHeight = fixed == nil ? height : max(height, needed)
                if needed <= lineHeight && bounds.width <= w + 0.1 {
                    guard top >= 0, top + lineHeight <= settings.size.height else { throw appError("A text line extends past the label edge. Make it smaller or move it.") }
                    lines.append(TextLine(text: text, rect: CGRect(x: 8, y: top, width: w, height: lineHeight), font: font,
                                          alignment: (style.alignment ?? (centered ? .center : .left)).text, role: role, index: index)); return
                }
                size -= 0.5
            }
            throw appError("The text does not fit this label. Shorten it or choose a larger size.")
        }
        let note = item.note?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if settings.design == .price {
            let prices = try displayedPrices(item, settings: settings)
            let titleHeight = note.isEmpty ? h * 0.28 : h * 0.24, priceTop = note.isEmpty ? h * 0.32 : h * 0.42
            try add(.title, item.title, y: 0, height: titleHeight, maxSize: 12, minSize: 6, bold: false, centered: true)
            try add(.note, note, y: h * 0.24, height: h * 0.16, maxSize: 9, minSize: 5.5, bold: false, centered: true)
            let rowHeight = (h - priceTop) / CGFloat(prices.count)
            for (index, value) in prices.enumerated() {
                try add(.price, value, index: index, y: priceTop + CGFloat(index) * rowHeight, height: rowHeight,
                        maxSize: min(24, rowHeight * 0.78), minSize: 7, bold: true, centered: true)
            }
        } else {
            let hasBarcode = !item.barcode.isEmpty
            let textHeight = hasBarcode ? h * 0.56 : h
            func prefixed(_ prefix: String, _ value: String) -> String { value.isEmpty ? "" : prefix.isEmpty ? value : prefix + " " + value }
            let metadata = [prefixed(settings.resolvedSkuPrefix, item.sku),
                            settings.design == .product ? item.details : "",
                            settings.design == .product ? prefixed(settings.resolvedOriginPrefix, item.origin) : ""].filter { !$0.isEmpty }.joined(separator: "\n")
            let titleHeight = note.isEmpty ? textHeight * 0.45 : textHeight * 0.32
            try add(.title, item.title, y: 0, height: titleHeight, maxSize: 12, minSize: 6, bold: true)
            try add(.note, note, y: titleHeight, height: textHeight * 0.18, maxSize: 8, minSize: 5.5, bold: false)
            try add(.metadata, metadata, y: textHeight * 0.45 + (note.isEmpty ? 0 : textHeight * 0.05), height: textHeight * (note.isEmpty ? 0.55 : 0.5), maxSize: 8, minSize: 5.5, bold: false)
            if hasBarcode { try add(.barcodeText, item.barcode, y: h * 0.86, height: h * 0.14, maxSize: 8, minSize: 5.5, bold: false, centered: true) }
        }
        return lines
    }
    static func draw(_ item: LabelItem, settings: LabelSettings, context: CGContext) throws {
        let lines = try layout(item, settings: settings)
        context.saveGState(); defer { context.restoreGState() }
        context.setFillColor(CGColor(gray: 1, alpha: 1)); context.fill(CGRect(origin: .zero, size: settings.size))
        context.translateBy(x: 0, y: settings.size.height); context.scaleBy(x: 1, y: -1)
        let graphics = NSGraphicsContext(cgContext: context, flipped: true)
        NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = graphics
        defer { NSGraphicsContext.restoreGraphicsState() }
        for line in lines {
            let style = NSMutableParagraphStyle(); style.alignment = line.alignment
            (line.text as NSString).draw(with: line.rect, options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: line.font, .foregroundColor: NSColor.black, .paragraphStyle: style])
        }
        if settings.design != .price && !item.barcode.isEmpty {
            let h = settings.size.height - 16, w = settings.size.width - 16
            let image = try barcodeImage(item.barcode, width: w)
            context.interpolationQuality = .none
            context.draw(image, in: CGRect(x: 8, y: 8 + h * 0.59, width: w, height: h * 0.25))
        }
    }
    static func image(_ item: LabelItem, settings: LabelSettings, scale: CGFloat = 4) -> CGImage? {
        let width = Int(settings.size.width * scale), height = Int(settings.size.height * scale)
        guard width > 0, height > 0, let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                                             space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
        context.scaleBy(x: scale, y: scale)
        return (try? draw(item, settings: settings, context: context)).flatMap { context.makeImage() }
    }
    static func pdf(_ items: [LabelItem], settings: LabelSettings) throws -> Data {
        guard !items.isEmpty, items.count <= 1000 else { throw appError("A batch must contain 1–1000 labels.") }
        for item in items { try validate(item, settings: settings) }
        guard items.reduce(0, { $0 + $1.copies }) <= 1000 else { throw appError("A batch must contain 1–1000 labels.") }
        let data = NSMutableData()
        var box = CGRect(origin: .zero, size: settings.size)
        guard let consumer = CGDataConsumer(data: data), let context = CGContext(consumer: consumer, mediaBox: &box, nil) else { throw appError("Could not create the label PDF.") }
        for item in items {
            for _ in 0..<item.copies { context.beginPDFPage(nil); try draw(item, settings: settings, context: context); context.endPDFPage() }
        }
        context.closePDF(); return data as Data
    }
}
