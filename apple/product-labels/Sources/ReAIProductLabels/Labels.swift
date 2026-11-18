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
}
enum LabelDesign: String, CaseIterable, Codable, Identifiable {
    case price, product, barcode, barsOnly
    var id: String { rawValue }
    var title: String { switch self { case .price: "Price label"; case .product: "Product label"; case .barcode: "Barcode label"; case .barsOnly: "Barcode only" } }
}
struct LabelSettings: Codable, Equatable {
    var design = LabelDesign.price
    var width = 50.0
    var height = 30.0
    var currency = "NOK"
    var printer = ""
    var textScale: Double?
    var barcodeHeight: Double?
    var barcodeFraction: Double { barcodeHeight ?? 0.40 }
    var locale = ["nb", "nn", "no"].contains(Locale.current.language.languageCode?.identifier ?? "") ? "nb_NO" : "en_US"
    var size: CGSize { CGSize(width: width * 72 / 25.4, height: height * 72 / 25.4) }
    static let sizes = ["40 × 27 mm", "50 × 30 mm", "60 × 40 mm", "70 × 50 mm", "100 × 50 mm", "38 × 25 mm", "62 × 29 mm", "89 × 36 mm"]
    static let dimensions: [(Double, Double)] = [(40,27), (50,30), (60,40), (70,50), (100,50), (38,25), (62,29), (89,36)]
}

@MainActor
enum LabelRenderer {
    private static let imageContext = CIContext()
    static func price(_ value: String, settings: LabelSettings) throws -> String {
        let raw = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let locale = Locale(identifier: settings.locale)
        let separator = locale.decimalSeparator ?? "."
        let pattern = "^[0-9]{1,9}(" + NSRegularExpression.escapedPattern(for: separator) + "[0-9]{1,2})?$"
        guard raw.range(of: pattern, options: .regularExpression) != nil,
              let number = Decimal(string: raw.replacingOccurrences(of: separator, with: "."), locale: Locale(identifier: "en_US_POSIX")) else {
            throw appError("Enter a price with up to two decimals using your selected number format, without thousands separators.")
        }
        let f = NumberFormatter(); f.locale = locale; f.numberStyle = .decimal
        f.usesGroupingSeparator = false; f.minimumFractionDigits = 0; f.maximumFractionDigits = 0; f.roundingMode = .halfUp
        let text = f.string(from: number as NSDecimalNumber) ?? raw
        return text + (settings.currency == "None" ? "" : " " + (settings.currency == "NOK" ? "kr" : settings.currency))
    }
    static func displayedPrices(_ item: LabelItem, settings: LabelSettings) throws -> [String] {
        let values = [LabelPrice(currency: item.currencyCode ?? settings.currency, amount: item.price)] + (item.extraPrices ?? [])
        guard values.count <= 4, Set(values.map(\.currency)).count == values.count else {
            throw appError("Choose up to four different currencies per label.")
        }
        return try values.map { value in
            var format = settings; format.currency = value.currency
            let result = try price(value.amount, settings: format)
            return values.count > 1 && value.currency == "NOK" ? result.replacingOccurrences(of: " kr", with: " NOK") : result
        }
    }
    static func validate(_ item: LabelItem, settings: LabelSettings) throws {
        guard settings.width.isFinite, settings.height.isFinite, (25...110).contains(settings.width), (20...150).contains(settings.height) else {
            throw appError("Choose a width of 25–110 mm and a height of 20–150 mm.")
        }
        guard settings.barcodeFraction.isFinite, (0.25...0.50).contains(settings.barcodeFraction) else {
            throw appError("Choose a barcode height of 25–50%.")
        }
        guard [0.75, 1.0, 1.25].contains(settings.textScale ?? 1) else { throw appError("Choose a text size from the menu.") }
        guard (1...1000).contains(item.copies) else { throw appError("Choose 1–1000 copies.") }
        if settings.design != .barsOnly && item.title.count > 160 { throw appError("Shorten the product title.") }
        if settings.design != .price && item.barcode.count > 80 { throw appError("Shorten the barcode value.") }
        if [.product, .barcode].contains(settings.design) && item.sku.count > 60 { throw appError("Shorten the SKU.") }
        if settings.design == .product && (item.details.count > 200 || item.origin.count > 80) {
            throw appError("Shorten the product details or country of origin.")
        }
        if settings.design == .price { _ = try displayedPrices(item, settings: settings) }
        if [.product, .barcode].contains(settings.design) && item.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            throw appError("Enter a product title.")
        }
        if [.barcode, .barsOnly].contains(settings.design) && item.barcode.isEmpty { throw appError("Enter a barcode value.") }
        if settings.design != .price && !item.barcode.isEmpty { _ = try barcodeImage(item.barcode, width: settings.size.width - 8) }
        // Reject overflowing text instead of quietly removing product information.
        _ = try layout(item, settings: settings)
    }
    static func barcodeImage(_ value: String, width: CGFloat) throws -> CGImage {
        guard value.utf8.allSatisfy({ (32...126).contains($0) }), !value.isEmpty else { throw appError("Code 128 barcodes support printable ASCII characters only.") }
        if let retail = try RetailBarcode.image(for: value, width: width) { return retail }
        let filter = CIFilter.code128BarcodeGenerator()
        filter.message = Data(value.utf8); filter.quietSpace = 10
        guard let output = filter.outputImage, width / output.extent.width >= 0.72 else {
            throw appError("The barcode is too long for this label. Choose a wider label or a shorter code.")
        }
        // Every row through the bars is identical. Keep the horizontal quiet zones and let the layout set bar height.
        let stripe = CGRect(x: output.extent.minX, y: floor(output.extent.midY), width: output.extent.width, height: 1)
        guard let image = imageContext.createCGImage(output, from: stripe) else { throw appError("Could not render the barcode.") }
        return image
    }
    struct TextLine { let text: String; let rect: CGRect; let font: NSFont; let centered: Bool }
    static func layout(_ item: LabelItem, settings: LabelSettings) throws -> [TextLine] {
        if settings.design == .barsOnly { return [] }
        let inset: CGFloat = 4
        let w = settings.size.width - 2 * inset, h = settings.size.height - 2 * inset
        var lines: [TextLine] = []
        func add(_ text: String, y: CGFloat, height: CGFloat, maxSize: CGFloat, minSize: CGFloat, bold: Bool, centered: Bool = false) throws {
            guard !text.isEmpty else { return }
            var size = max(minSize, maxSize * (settings.textScale ?? 1))
            while size >= minSize {
                let font = NSFont.systemFont(ofSize: size, weight: bold ? .bold : .regular)
                let bounds = (text as NSString).boundingRect(with: CGSize(width: w, height: 10000), options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: font])
                if ceil(bounds.height) + 1 <= height && bounds.width <= w + 0.1 {
                    lines.append(TextLine(text: text, rect: CGRect(x: inset, y: y + inset, width: w, height: height), font: font, centered: centered)); return
                }
                if size == minSize { break }
                size = max(minSize, size - 0.5)
            }
            throw appError("The text does not fit this label. Shorten it or choose a larger size.")
        }
        if settings.design == .price {
            let prices = try displayedPrices(item, settings: settings)
            let gap: CGFloat = 1
            var priceStart: CGFloat = 0
            if !item.title.isEmpty {
                // Reserve one legible line for each price, then wrap the title at its largest fitting size.
                let available = h - CGFloat(prices.count) * 12 - gap - 2
                try add(item.title, y: 0, height: available, maxSize: 12, minSize: 6, bold: false, centered: true)
                if let title = lines.last {
                    let bounds = (title.text as NSString).boundingRect(with: title.rect.size, options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: title.font])
                    priceStart = ceil(bounds.height) + gap + 2
                }
            }
            let rowHeight = (h - priceStart) / CGFloat(prices.count)
            for (index, value) in prices.enumerated() {
                try add(value, y: priceStart + CGFloat(index) * rowHeight, height: rowHeight,
                        maxSize: min(36, rowHeight * 0.78), minSize: 7, bold: true, centered: true)
            }
        } else {
            let hasBarcode = !item.barcode.isEmpty
            let textHeight = hasBarcode ? h * (0.77 - settings.barcodeFraction) : h
            let metadata = [item.sku.isEmpty ? "" : "SKU: " + item.sku,
                            settings.design == .product ? item.details : "",
                            settings.design == .product && !item.origin.isEmpty ? "Country of origin" + ": " + item.origin : ""].filter { !$0.isEmpty }.joined(separator: "\n")
            try add(item.title, y: 0, height: textHeight * 0.45, maxSize: 12, minSize: 6, bold: true)
            try add(metadata, y: textHeight * 0.45, height: textHeight * 0.55, maxSize: 8, minSize: 5.5, bold: false)
            if hasBarcode { try add(item.barcode, y: h * 0.82, height: h * 0.18, maxSize: 8, minSize: 5.5, bold: false, centered: true) }
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
            let style = NSMutableParagraphStyle(); style.alignment = line.centered ? .center : .left
            (line.text as NSString).draw(with: line.rect, options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: line.font, .foregroundColor: NSColor.black, .paragraphStyle: style])
        }
        if settings.design != .price && !item.barcode.isEmpty {
            let h = settings.size.height - 8, w = settings.size.width - 8
            let image = try barcodeImage(item.barcode, width: w)
            context.interpolationQuality = .none
            let barsOnly = settings.design == .barsOnly
            let top = barsOnly ? 0 : h * (0.80 - settings.barcodeFraction)
            let height = barsOnly ? h : h * settings.barcodeFraction
            context.draw(image, in: CGRect(x: 4, y: 4 + top, width: w, height: height))
        }
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
