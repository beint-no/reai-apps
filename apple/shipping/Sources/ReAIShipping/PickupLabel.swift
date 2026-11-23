import AppKit
import Foundation

struct PickupPrintRecord: Codable, Identifiable {
    var id: String { "\(tenantId):\(orderId)" }
    let tenantId: Int
    let orderId: Int
    let orderNumber: String
    var state: String
    let printerId: String
    var queueResult: String?
}

enum PickupLabel {
    static let widthMm = 100.0
    static let heightMm = 150.0

    static func pdf(
        orderNumber: String,
        customerName: String,
        phone: String?,
        email: String?,
        items: [OrderItem],
        pickupInstructions: String?,
        notes: String?,
        companyName: String,
        date: String
    ) throws -> Data {
        let mm = 72.0 / 25.4
        var bounds = CGRect(origin: .zero, size: CGSize(width: widthMm * mm, height: heightMm * mm))
        let data = NSMutableData()
        guard let consumer = CGDataConsumer(data: data),
              let context = CGContext(consumer: consumer, mediaBox: &bounds, nil) else {
            throw appError("The Click & Collect label could not be prepared.")
        }
        context.beginPDFPage(nil)
        context.setFillColor(NSColor.white.cgColor)
        context.fill(bounds)

        NSGraphicsContext.saveGraphicsState()
        // Use flipped (top-left origin) coordinates for clean top-down layout.
        context.translateBy(x: 0, y: bounds.height)
        context.scaleBy(x: 1, y: -1)
        NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: true)
        defer { NSGraphicsContext.restoreGraphicsState() }

        let margin = 5.0 * mm
        let contentWidth = bounds.width - margin * 2
        var y = margin

        // 1. High-contrast black banner
        let bannerHeight = 20.0 * mm
        let bannerRect = CGRect(x: margin, y: y, width: contentWidth, height: bannerHeight)
        NSColor.black.setFill()
        NSBezierPath(roundedRect: bannerRect, xRadius: 2.5 * mm, yRadius: 2.5 * mm).fill()

        drawFitted(
            "WILL BE COLLECTED",
            in: CGRect(x: margin + 3 * mm, y: y + 2.5 * mm, width: contentWidth - 6 * mm, height: 9.5 * mm),
            maxSize: 20, minSize: 12, bold: true, color: .white, alignment: .center
        )
        drawFitted(
            "CLICK & COLLECT  ·  DO NOT SHIP",
            in: CGRect(x: margin + 3 * mm, y: y + 12.2 * mm, width: contentWidth - 6 * mm, height: 6.0 * mm),
            maxSize: 10.5, minSize: 7.5, bold: true, color: .white, alignment: .center
        )
        y += bannerHeight + 4.0 * mm

        // 2. Giant Order Number
        drawText("ORDER NUMBER", in: CGRect(x: margin, y: y, width: contentWidth, height: 4.2 * mm),
                 size: 8.5, bold: true, color: .black, alignment: .center)
        y += 4.2 * mm
        drawFitted(
            orderNumber,
            in: CGRect(x: margin, y: y, width: contentWidth, height: 15.5 * mm),
            maxSize: 36, minSize: 18, bold: true, color: .black, alignment: .center
        )
        y += 16.5 * mm
        drawRule(y: y, x: margin, width: contentWidth, thickness: 1.2)
        y += 3.5 * mm

        // 3. Customer Info
        drawText("CUSTOMER", in: CGRect(x: margin, y: y, width: contentWidth, height: 4.0 * mm),
                 size: 8.5, bold: true, color: .black)
        y += 4.2 * mm
        let customerTitle = customerName.trimmingCharacters(in: .whitespacesAndNewlines)
        drawFitted(
            customerTitle.isEmpty ? "Store pickup customer" : customerTitle,
            in: CGRect(x: margin, y: y, width: contentWidth, height: 8.0 * mm),
            maxSize: 16, minSize: 10, bold: true, color: .black
        )
        y += 8.2 * mm
        let contactParts = [phone, email]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        if !contactParts.isEmpty {
            let contactText = contactParts.joined(separator: "  ·  ")
            let contactHeight = drawWrapped(contactText, in: CGRect(x: margin, y: y, width: contentWidth, height: 10.0 * mm),
                                            size: 9.5, bold: false, color: .black)
            y += contactHeight + 2.5 * mm
        } else {
            y += 1.5 * mm
        }
        drawRule(y: y, x: margin, width: contentWidth, thickness: 0.75)
        y += 3.5 * mm

        // Reserve space at bottom for staff callout + footer
        let footerHeight = 5.5 * mm
        let staffBoxHeight = 32.0 * mm
        let staffBoxTop = bounds.height - margin - footerHeight - 2.5 * mm - staffBoxHeight

        // 4. Items ordered
        let totalUnits = items.reduce(Decimal(0)) { $0 + $1.quantity }
        let unitLabel = totalUnits == 1 ? "pc" : "pcs"
        let qtySummary = items.isEmpty ? "ITEMS" : "ITEMS  (\(NSDecimalNumber(decimal: totalUnits).stringValue) \(unitLabel))"
        drawText(qtySummary, in: CGRect(x: margin, y: y, width: contentWidth, height: 4.2 * mm),
                 size: 8.5, bold: true, color: .black)
        y += 4.8 * mm

        let maxItemsY = staffBoxTop - 3.5 * mm
        var renderedItems = 0
        for item in items {
            let remainingSpace = maxItemsY - y
            if remainingSpace < 5.2 * mm { break }
            let qty = NSDecimalNumber(decimal: item.quantity).stringValue
            let lineText = "\(qty)×  \(item.title)"
            let used = drawWrapped(lineText, in: CGRect(x: margin, y: y, width: contentWidth, height: min(10.0 * mm, remainingSpace)),
                                   size: 10.0, bold: false, color: .black)
            y += used + 1.4 * mm
            renderedItems += 1
        }
        let omitted = items.count - renderedItems
        if omitted > 0, maxItemsY - y >= 4.0 * mm {
            drawText("+ \(omitted) more \(omitted == 1 ? "item" : "items") (see order in ReAI)",
                     in: CGRect(x: margin, y: y, width: contentWidth, height: 4.5 * mm),
                     size: 9.0, bold: true, color: .black)
        }

        // 5. Staff message box
        let staffRect = CGRect(x: margin, y: staffBoxTop, width: contentWidth, height: staffBoxHeight)
        NSColor.black.setStroke()
        let border = NSBezierPath(roundedRect: staffRect, xRadius: 2.0 * mm, yRadius: 2.0 * mm)
        border.lineWidth = 1.5
        border.stroke()

        var sy = staffBoxTop + 2.5 * mm
        let innerX = margin + 3.0 * mm
        let innerW = contentWidth - 6.0 * mm
        drawText("STAFF NOTE  ·  HOLD AT STORE PICKUP",
                 in: CGRect(x: innerX, y: sy, width: innerW, height: 4.5 * mm),
                 size: 9.0, bold: true, color: .black)
        sy += 5.0 * mm

        let pickupSummary = pickupInstructions?
            .split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .first
        let cleanNotes = notes?.trimmingCharacters(in: .whitespacesAndNewlines)

        var staffLines = ["Do not hand to carrier. Keep in store pickup area and confirm order number with customer on collection."]
        if let pickupSummary, !pickupSummary.isEmpty {
            staffLines.append("Pickup: \(pickupSummary)")
        }
        if let cleanNotes, !cleanNotes.isEmpty {
            staffLines.append("Note: \(cleanNotes)")
        }
        _ = drawWrapped(staffLines.joined(separator: "\n"),
                        in: CGRect(x: innerX, y: sy, width: innerW, height: staffBoxTop + staffBoxHeight - sy - 2.0 * mm),
                        size: 9.0, bold: false, color: .black)

        // 6. Footer
        let footerY = bounds.height - margin - footerHeight
        drawText(companyName, in: CGRect(x: margin, y: footerY, width: contentWidth * 0.65, height: footerHeight),
                 size: 8.0, bold: true, color: .black, alignment: .left)
        drawText(date, in: CGRect(x: margin + contentWidth * 0.65, y: footerY, width: contentWidth * 0.35, height: footerHeight),
                 size: 8.0, bold: false, color: .black, alignment: .right)

        context.endPDFPage()
        context.closePDF()
        return data as Data
    }

    private static func drawRule(y: CGFloat, x: CGFloat, width: CGFloat, thickness: CGFloat) {
        NSColor.black.setStroke()
        let path = NSBezierPath()
        path.lineWidth = thickness
        path.move(to: CGPoint(x: x, y: y))
        path.line(to: CGPoint(x: x + width, y: y))
        path.stroke()
    }

    private static func drawText(
        _ text: String,
        in rect: CGRect,
        size: CGFloat,
        bold: Bool,
        color: NSColor,
        alignment: NSTextAlignment = .left
    ) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = alignment
        paragraph.lineBreakMode = .byTruncatingTail
        let font = bold ? NSFont.boldSystemFont(ofSize: size) : NSFont.systemFont(ofSize: size)
        (text as NSString).draw(in: rect, withAttributes: [
            .font: font, .foregroundColor: color, .paragraphStyle: paragraph
        ])
    }

    private static func drawFitted(
        _ text: String,
        in rect: CGRect,
        maxSize: CGFloat,
        minSize: CGFloat,
        bold: Bool,
        color: NSColor,
        alignment: NSTextAlignment = .left
    ) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = alignment
        paragraph.lineBreakMode = .byTruncatingTail
        var size = maxSize
        while size > minSize {
            let font = bold ? NSFont.boldSystemFont(ofSize: size) : NSFont.systemFont(ofSize: size)
            let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color, .paragraphStyle: paragraph]
            let measured = (text as NSString).size(withAttributes: attrs)
            if measured.width <= rect.width && measured.height <= rect.height {
                let yOffset = max(0, (rect.height - measured.height) / 2)
                (text as NSString).draw(in: CGRect(x: rect.minX, y: rect.minY + yOffset, width: rect.width, height: measured.height), withAttributes: attrs)
                return
            }
            size -= 0.5
        }
        drawText(text, in: rect, size: minSize, bold: bold, color: color, alignment: alignment)
    }

    @discardableResult
    private static func drawWrapped(
        _ text: String,
        in rect: CGRect,
        size: CGFloat,
        bold: Bool,
        color: NSColor
    ) -> CGFloat {
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byWordWrapping
        let font = bold ? NSFont.boldSystemFont(ofSize: size) : NSFont.systemFont(ofSize: size)
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color, .paragraphStyle: paragraph]
        let measured = (text as NSString).boundingRect(
            with: CGSize(width: rect.width, height: rect.height),
            options: [.usesLineFragmentOrigin, .usesFontLeading, .truncatesLastVisibleLine],
            attributes: attrs
        )
        (text as NSString).draw(
            with: CGRect(x: rect.minX, y: rect.minY, width: rect.width, height: min(rect.height, ceil(measured.height) + 1)),
            options: [.usesLineFragmentOrigin, .usesFontLeading, .truncatesLastVisibleLine],
            attributes: attrs
        )
        return min(rect.height, ceil(measured.height))
    }
}
