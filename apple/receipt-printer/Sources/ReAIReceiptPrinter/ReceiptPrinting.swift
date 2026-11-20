import AppKit
import PDFKit

@MainActor
struct ReceiptPrinting {
    private let printer: NSPrinter

    init(printerName: String) throws {
        guard NSPrinter.printerNames.contains(printerName), let printer = NSPrinter(name: printerName) else {
            throw appError("Select an installed printer before printing.")
        }
        self.printer = printer
    }

    func printReceipt(_ data: Data, message: String, receiptNumber: String) throws -> Bool {
        guard let source = PDFDocument(data: data) else {
            throw appError("ReAI returned an unreadable receipt PDF.")
        }
        let document = try ReceiptPDF.withStoreMessage(message, in: source)
        guard let first = document.page(at: 0) else {
            throw appError("ReAI returned an empty receipt PDF.")
        }
        let info = NSPrintInfo(dictionary: [.copies: 1])
        info.printer = printer
        info.jobDisposition = .spool
        info.paperSize = document.pageCount == 1
            ? first.bounds(for: .mediaBox).size
            : document.page(at: document.pageCount - 1)?.bounds(for: .mediaBox).size ?? first.bounds(for: .mediaBox).size
        info.topMargin = 0
        info.bottomMargin = 0
        info.leftMargin = 0
        info.rightMargin = 0
        info.isHorizontallyCentered = true
        info.isVerticallyCentered = false
        guard let operation = document.printOperation(for: info, scalingMode: .pageScaleNone, autoRotate: false) else {
            throw appError("macOS could not prepare the receipt for printing.")
        }
        operation.jobTitle = "ReAI \(receiptNumber)"
        operation.showsPrintPanel = false
        return operation.run()
    }
}
