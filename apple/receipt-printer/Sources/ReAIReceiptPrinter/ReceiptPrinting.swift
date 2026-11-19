import AppKit
import PDFKit

@MainActor
struct ReceiptPrinting {
    private let printer: NSPrinter

    init(printerName: String) throws {
        guard NSPrinter.printerNames.contains(printerName), let printer = NSPrinter(name: printerName) else {
            throw appError("Select an installed printer before issuing a copy.")
        }
        self.printer = printer
    }

    func printCopy(_ data: Data) throws -> Bool {
        guard let document = PDFDocument(data: data), let first = document.page(at: 0) else {
            throw appError("ReAI issued a copy but returned an unreadable PDF. Check the receipt journal.")
        }
        let info = NSPrintInfo(dictionary: [.copies: 1])
        info.printer = printer
        info.jobDisposition = .spool
        info.paperSize = first.bounds(for: .mediaBox).size
        info.topMargin = 0
        info.bottomMargin = 0
        info.leftMargin = 0
        info.rightMargin = 0
        info.isHorizontallyCentered = true
        info.isVerticallyCentered = false
        guard let operation = document.printOperation(for: info, scalingMode: .pageScaleNone, autoRotate: false) else {
            throw appError("ReAI issued the copy, but macOS could not prepare it for printing.")
        }
        operation.jobTitle = "ReAI receipt copy"
        operation.showsPrintPanel = false
        return operation.run()
    }
}
