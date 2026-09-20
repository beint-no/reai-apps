import Foundation
import ZIPFoundation

actor SpreadsheetReader {
    func read(_ url: URL) throws -> [Sheet] {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size > 0, size <= 10 * 1024 * 1024 else { throw appError("Choose a file between 1 byte and 10 MB.") }
        let data = try Data(contentsOf: url)
        guard data.count <= 10 * 1024 * 1024 else { throw appError("The file exceeds 10 MB.") }
        if url.pathExtension.lowercased() == "xlsx" { return try excel(data) }
        guard ["csv", "tsv", "txt"].contains(url.pathExtension.lowercased()) else { throw appError("Choose an Excel .xlsx, CSV or TSV file.") }
        let text: String?
        if data.starts(with: [0xff, 0xfe]) || data.starts(with: [0xfe, 0xff]) { text = String(data: data, encoding: .utf16) }
        else { text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .windowsCP1252) }
        guard let text else { throw appError("Could not read the text encoding. Save the file as UTF-8 CSV.") }
        let cleaned = text.replacingOccurrences(of: "\u{feff}", with: "").replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        let separators: [Character] = url.pathExtension.lowercased() == "tsv" ? ["\t"] : [",", ";", "\t"]
        let candidates = separators.compactMap { separator -> [[String]]? in try? Self.delimited(cleaned, separator: separator) }
        guard let rows = candidates.max(by: { ($0.first?.count ?? 0) < ($1.first?.count ?? 0) }) else {
            throw appError("The file has invalid quoting or exceeds 10,000 rows / 100 columns.")
        }
        return [Sheet(name: url.lastPathComponent, rows: rows)]
    }

    static func delimited(_ text: String, separator: Character) throws -> [[String]] {
        var rows: [[String]] = [], row: [String] = [], field = ""
        var quoted = false, endedQuote = false
        let characters = Array(text)
        var i = 0
        func check() throws {
            guard rows.count <= 10_001, row.count <= 100, field.utf8.count <= 100_000 else { throw appError("File exceeds the import limits.") }
        }
        while i < characters.count {
            let c = characters[i]
            if quoted {
                if c == "\"" {
                    if i + 1 < characters.count, characters[i + 1] == "\"" { field.append("\""); i += 1 }
                    else { quoted = false; endedQuote = true }
                } else { field.append(c) }
            } else if c == separator {
                row.append(field); field = ""; endedQuote = false
            } else if c == "\n" {
                row.append(field); rows.append(row); row = []; field = ""; endedQuote = false
            } else if c == "\"", field.isEmpty, !endedQuote {
                quoted = true
            } else {
                guard !endedQuote, c != "\"" else { throw appError("Invalid CSV quoting.") }
                field.append(c)
            }
            i += 1
            if i.isMultiple(of: 1024) { try check() }
        }
        guard !quoted else { throw appError("A quoted cell was not closed.") }
        if !row.isEmpty || !field.isEmpty || endedQuote { row.append(field); rows.append(row) }
        guard !rows.isEmpty, rows.count <= 10_001, rows.allSatisfy({ $0.count <= 100 }) else { throw appError("Use at most 10,000 data rows and 100 columns.") }
        return rows
    }

    private func excel(_ data: Data) throws -> [Sheet] {
        let archive = try Archive(data: data, accessMode: .read)
        var total: UInt64 = 0
        for entry in archive {
            total += UInt64(entry.uncompressedSize)
            guard total <= 64 * 1024 * 1024 else { throw appError("The expanded workbook exceeds 64 MB. Split it into smaller files.") }
        }
        func xml(_ path: String) throws -> XMLNode {
            guard let entry = archive[path], entry.uncompressedSize <= 24 * 1024 * 1024 else { throw appError("Missing or oversized workbook data: \(path).") }
            var bytes = Data()
            _ = try archive.extract(entry) { part in
                guard bytes.count + part.count <= 24 * 1024 * 1024 else { throw appError("Workbook data is too large.") }
                bytes.append(part)
            }
            return try XMLTree.parse(bytes)
        }
        let workbook = try xml("xl/workbook.xml")
        let relationships = try xml("xl/_rels/workbook.xml.rels")
        let strings: [String]
        if archive["xl/sharedStrings.xml"] != nil { strings = try xml("xl/sharedStrings.xml").children.filter { $0.name == "si" }.map { $0.allText("t") } }
        else { strings = [] }
        var formats: [Int: String] = [:], styles: [Int] = []
        if archive["xl/styles.xml"] != nil {
            let style = try xml("xl/styles.xml")
            for node in style.child("numFmts")?.children ?? [] {
                if let id = Int(node.attributes["numFmtId"] ?? "") { formats[id] = node.attributes["formatCode"] }
            }
            styles = (style.child("cellXfs")?.children ?? []).map { Int($0.attributes["numFmtId"] ?? "") ?? 0 }
        }
        let sheetNodes = workbook.child("sheets")?.children ?? []
        guard !sheetNodes.isEmpty, sheetNodes.count <= 30 else { throw appError("Use a workbook with 1–30 sheets.") }
        return try sheetNodes.enumerated().map { sheetIndex, sheet in
            let relationID = sheet.attributes["r:id"] ?? ""
            guard let relationship = relationships.children.first(where: { $0.attributes["Id"] == relationID }),
                  relationship.attributes["TargetMode"] != "External", let target = relationship.attributes["Target"],
                  !target.contains(".."), !target.contains(":") else { throw appError("Unsupported workbook sheet reference.") }
            let path = target.hasPrefix("/") ? String(target.dropFirst()) : "xl/" + target
            let worksheet = try xml(path)
            guard worksheet.child("mergeCells") == nil else { throw appError("Unmerge cells in sheet \(sheet.attributes["name"] ?? "") before importing.") }
            var rows: [[String]] = []
            for node in worksheet.child("sheetData")?.children ?? [] where node.name == "row" {
                guard let rowNumber = Int(node.attributes["r"] ?? ""), (1...10_001).contains(rowNumber) else { throw appError("Use at most 10,000 data rows per sheet.") }
                while rows.count < rowNumber { rows.append([]) }
                for cell in node.children where cell.name == "c" {
                    let letters = (cell.attributes["r"] ?? "").prefix(while: { $0.isLetter })
                    var column = 0
                    for scalar in letters.unicodeScalars {
                        guard (65...90).contains(scalar.value), column <= 100 else { throw appError("Invalid Excel column.") }
                        column = column * 26 + Int(scalar.value - 64)
                    }
                    guard (1...100).contains(column) else { throw appError("Use at most 100 columns.") }
                    guard cell.child("f") == nil else { throw appError("Sheet \(sheet.attributes["name"] ?? "") contains formulas. Paste values only into a new workbook, or export CSV first.") }
                    var value = cell.child("v")?.text ?? ""
                    switch cell.attributes["t"] {
                    case "s":
                        guard let index = Int(value), strings.indices.contains(index) else { throw appError("Invalid Excel shared string.") }
                        value = strings[index]
                    case "inlineStr": value = cell.child("is")?.allText("t") ?? ""
                    case "b": value = value == "1" ? "true" : "false"
                    case "e": throw appError("Sheet contains an Excel error at \(cell.attributes["r"] ?? "a cell").")
                    default:
                        if let index = Int(cell.attributes["s"] ?? ""), styles.indices.contains(index),
                           let format = formats[styles[index]], format.range(of: "^0{2,30}$", options: .regularExpression) != nil,
                           value.allSatisfy(\.isNumber), value.count < format.count {
                            value = String(repeating: "0", count: format.count - value.count) + value
                        }
                    }
                    while rows[rowNumber - 1].count < column { rows[rowNumber - 1].append("") }
                    rows[rowNumber - 1][column - 1] = value
                }
            }
            return Sheet(name: sheet.attributes["name"] ?? "Sheet \(sheetIndex + 1)", rows: rows)
        }
    }
}

private final class XMLNode {
    let name: String
    let attributes: [String: String]
    var text = ""
    var children: [XMLNode] = []
    init(_ name: String, _ attributes: [String: String] = [:]) { self.name = name; self.attributes = attributes }
    func child(_ name: String) -> XMLNode? { children.first { $0.name == name } }
    func allText(_ name: String) -> String { (self.name == name ? text : "") + children.map { $0.allText(name) }.joined() }
}
private final class XMLTree: NSObject, XMLParserDelegate {
    let root = XMLNode("root")
    var stack: [XMLNode] = []
    var count = 0
    static func parse(_ data: Data) throws -> XMLNode {
        let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .utf16) ?? ""
        guard !text.isEmpty, !text.contains("\0"), !text.contains("<!DOCTYPE"), !text.contains("<!ENTITY") else { throw appError("Workbook XML declarations are not supported.") }
        let tree = XMLTree(); tree.stack = [tree.root]
        let parser = XMLParser(data: data); parser.shouldResolveExternalEntities = false; parser.delegate = tree
        guard parser.parse(), let root = tree.root.children.first else { throw appError("The workbook XML is invalid or exceeds import limits.") }
        return root
    }
    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String: String]) {
        count += 1
        guard count <= 400_000, stack.count <= 30 else { parser.abortParsing(); return }
        let node = XMLNode(elementName.split(separator: ":").last.map(String.init) ?? elementName, attributeDict)
        stack.last?.children.append(node); stack.append(node)
    }
    func parser(_ parser: XMLParser, foundCharacters string: String) { stack.last?.text += string }
    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) { if stack.count > 1 { stack.removeLast() } }
}
