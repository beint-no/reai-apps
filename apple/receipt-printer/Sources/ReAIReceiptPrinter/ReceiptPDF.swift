import AppKit
import CoreText
import PDFKit

@MainActor
enum ReceiptPDF {
    static let maximumMessageLength = 500

    static func withStoreMessage(_ message: String, in document: PDFDocument) throws -> PDFDocument {
        guard !document.isLocked, document.pageCount > 0 else {
            throw appError("Open an unlocked receipt PDF.")
        }
        let message = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty else { return document }
        guard message.utf16.count <= maximumMessageLength else {
            throw appError("The store message can contain up to 500 characters.")
        }

        let index = document.pageCount - 1
        guard let source = document.page(at: index)?.pageRef else {
            throw appError("Could not read the final page of the receipt.")
        }
        let bounds = source.getBoxRect(.mediaBox)
        let rotated = source.rotationAngle % 180 != 0
        let width = rotated ? bounds.height : bounds.width
        let height = rotated ? bounds.width : bounds.height
        let margin: CGFloat = 12
        guard width.isFinite, height.isFinite, width > margin * 2, height > 0 else {
            throw appError("The receipt has an invalid paper size.")
        }

        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byWordWrapping
        let text = NSAttributedString(string: message, attributes: [
            .font: NSFont.systemFont(ofSize: 9),
            .foregroundColor: NSColor.black,
            .paragraphStyle: paragraph,
        ])
        let framesetter = CTFramesetterCreateWithAttributedString(text)
        let textWidth = width - margin * 2
        let measured = CTFramesetterSuggestFrameSizeWithConstraints(
            framesetter, CFRange(), nil, CGSize(width: textWidth, height: .greatestFiniteMagnitude), nil
        )
        let textHeight = ceil(measured.height) + 2
        let footerHeight = textHeight + margin * 2
        var pageBox = CGRect(x: 0, y: 0, width: width, height: height + footerHeight)
        let data = NSMutableData()
        guard let consumer = CGDataConsumer(data: data),
              let context = CGContext(consumer: consumer, mediaBox: &pageBox, nil) else {
            throw appError("Could not prepare the receipt for printing.")
        }
        context.beginPDFPage(nil)
        context.saveGState()
        let placement = CGRect(x: 0, y: footerHeight, width: width, height: height)
        context.concatenate(source.getDrawingTransform(.mediaBox, rect: placement, rotate: 0, preserveAspectRatio: true))
        context.drawPDFPage(source)
        context.restoreGState()

        let textBox = CGRect(x: margin, y: margin, width: textWidth, height: textHeight)
        let frame = CTFramesetterCreateFrame(framesetter, CFRange(), CGPath(rect: textBox, transform: nil), nil)
        CTFrameDraw(frame, context)
        context.endPDFPage()
        context.closePDF()

        guard let replacement = PDFDocument(data: data as Data)?.page(at: 0),
              let output = document.copy() as? PDFDocument else {
            throw appError("Could not prepare the receipt with the store message.")
        }
        output.removePage(at: index)
        output.insert(replacement, at: index)
        return output
    }
}
