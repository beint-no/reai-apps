import AppKit
import CoreText
import PDFKit
import SwiftUI

enum PaperWidth: Int, CaseIterable, Identifiable {
    case narrow = 58, wide = 80
    var id: Int { rawValue }
    var label: String { "\(rawValue) mm" }
}

struct NoteDocument {
    static let maxLength = 500
    let data: Data
    let size: CGSize

    @MainActor init(company: Company, receipt: Receipt, message: String, paper: PaperWidth) throws {
        let margin: CGFloat = 4 * 72 / 25.4
        let width = CGFloat(paper.rawValue) * 72 / 25.4
        let contentWidth = width - 2 * margin
        let content = NSMutableAttributedString()
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byWordWrapping
        paragraph.paragraphSpacing = 5

        func append(_ text: String, font: NSFont) {
            content.append(NSAttributedString(string: text, attributes: [
                .font: font, .foregroundColor: NSColor.black, .paragraphStyle: paragraph
            ]))
        }

        append("Store message\n", font: .boldSystemFont(ofSize: 12))
        append("NOT PROOF OF PURCHASE\n", font: .boldSystemFont(ofSize: 9))
        append(company.companyName + "\n", font: .systemFont(ofSize: 10))
        append("Receipt \(receipt.receiptNumber) · Register \(receipt.cashPointId)\n\(receipt.displayDate)\n",
               font: .systemFont(ofSize: 9))
        append("\nItems\n", font: .boldSystemFont(ofSize: 10))
        for line in receipt.lines {
            append("\(line.quantity.formatted()) × \(line.productText)\n\(receipt.amount(line.grossAmount))\n",
                   font: .systemFont(ofSize: 9))
        }
        append("Total: \(receipt.amount(receipt.grossAmount))\n", font: .boldSystemFont(ofSize: 10))
        append("\n" + message + "\n", font: .systemFont(ofSize: 10))
        append("\nKeep the original receipt. For returns, staff should look up the sale in ReAI.",
               font: .boldSystemFont(ofSize: 9))

        let framesetter = CTFramesetterCreateWithAttributedString(content)
        let capacity = CGSize(width: contentWidth, height: .greatestFiniteMagnitude)
        let suggested = CTFramesetterSuggestFrameSizeWithConstraints(framesetter, CFRange(), nil, capacity, nil)
        var box = CGRect(x: 0, y: 0, width: width, height: ceil(suggested.height) + 2 * margin + 2)
        let path = CGPath(rect: box.insetBy(dx: margin, dy: margin), transform: nil)
        let frame = CTFramesetterCreateFrame(framesetter, CFRange(), path, nil)
        guard CTFrameGetVisibleStringRange(frame).length == content.length else {
            throw appError("The message does not fit on this paper. Choose a wider roll or shorten it.")
        }
        let bytes = NSMutableData()
        guard let consumer = CGDataConsumer(data: bytes as CFMutableData),
              let context = CGContext(consumer: consumer, mediaBox: &box, nil) else {
            throw appError("Could not prepare the print preview.")
        }
        context.beginPDFPage(nil)
        context.textMatrix = .identity
        CTFrameDraw(frame, context)
        context.endPDFPage()
        context.closePDF()
        data = bytes as Data
        size = box.size
    }

    @MainActor func printNote() throws -> Bool {
        guard let document = PDFDocument(data: data), let info = NSPrintInfo.shared.copy() as? NSPrintInfo else {
            throw appError("Could not open the print dialog.")
        }
        info.paperSize = size
        info.topMargin = 0
        info.bottomMargin = 0
        info.leftMargin = 0
        info.rightMargin = 0
        info.isHorizontallyCentered = true
        info.isVerticallyCentered = false
        guard let operation = document.printOperation(for: info, scalingMode: .pageScaleNone, autoRotate: false) else {
            throw appError("Could not open the print dialog.")
        }
        operation.jobTitle = "ReAI store message"
        operation.showsPrintPanel = true
        return operation.run()
    }
}

struct NotePreview: NSViewRepresentable {
    let document: NoteDocument

    final class Coordinator {
        var displayed: Data?
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePage
        return view
    }

    func updateNSView(_ view: PDFView, context: Context) {
        guard context.coordinator.displayed != document.data else { return }
        view.document = PDFDocument(data: document.data)
        context.coordinator.displayed = document.data
    }
}
