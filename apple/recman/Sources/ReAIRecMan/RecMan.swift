import Foundation

struct RecManEmployee: Decodable, Equatable, Sendable {
    let candidateId: RecManNumber
    let corporationId: RecManNumber?
    let firstName: String?
    let lastName: String?
    let email: String?
    let employment: [Employment]?

    struct Employment: Decodable, Equatable, Sendable {
        let startDate: String?
        let endDate: String?
        let positionPercent: RecManNumber?
        let bankAccount: String?
        let employmentId: RecManNumber?
    }

    var name: String {
        [firstName, lastName].compactMap(clean).joined(separator: " ")
    }

    var contactEmail: String? { clean(email) }

    private func clean(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }
}

struct RecManNumber: Decodable, Equatable, Sendable {
    let value: Decimal

    var positiveID: Int? {
        let number = NSDecimalNumber(decimal: value)
        let integer = number.intValue
        return integer > 0 && Decimal(integer) == value ? integer : nil
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let value = try? container.decode(Decimal.self) {
            self.value = value
        } else if let text = try? container.decode(String.self),
                  let value = Decimal(string: text, locale: Locale(identifier: "en_US_POSIX")),
                  text.range(of: #"^-?[0-9]+(?:\.[0-9]+)?$"#, options: .regularExpression) != nil {
            self.value = value
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid RecMan number.")
        }
    }
}

struct RecManRows<Row: Decodable>: Decodable {
    let values: [Row]

    init(from decoder: Decoder) throws {
        let box = try decoder.singleValueContainer()
        if let rows = try? box.decode([String: Row].self) {
            values = rows.sorted { $0.key.compare($1.key, options: .numeric) == .orderedAscending }.map(\.value)
        } else {
            values = try box.decode([Row].self)
        }
    }
}

extension RecManRows: Sendable where Row: Sendable {}

actor RecManAPI {
    private struct Page<Row: Decodable>: Decodable {
        let success: Bool
        let numRows: Int?
        let data: RecManRows<Row>?
        let nextPage: RecManFlag?
    }

    private let session: URLSession

    init() {
        let config = URLSessionConfiguration.ephemeral
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 30
        session = URLSession(configuration: config, delegate: RedirectBlocker(), delegateQueue: nil)
    }

    func employees(key: String) async throws -> [RecManEmployee] {
        let rows: [RecManEmployee] = try await fetchAll("candidate", key: key, parameters: [
            "isEmployee": "1", "fields": "firstName,lastName,email,employment"
        ])
        guard rows.compactMap({ $0.candidateId.positiveID }).count == rows.count,
              Set(rows.map(\.candidateId.value)).count == rows.count else {
            throw appError("RecMan returned a missing or repeated candidate ID.")
        }
        return rows.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    func health(key: String) async throws -> String {
        struct Organization: Decodable { let name: String? }
        do {
            let organizations: [Organization] = try await fetchAll("corporation", key: key, parameters: ["fields": "name"],
                                                                   maxPages: 1)
            let names = organizations.compactMap(\.name).filter { !$0.isEmpty }
            if !names.isEmpty { return "RecMan connected · \(names.joined(separator: ", "))" }
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            // Some read-only keys allow employees but do not expose the organization directory.
        }
        struct Candidate: Decodable { let corporationId: RecManNumber? }
        let response: Page<Candidate> = try await read("candidate", key: key, parameters: [
            "fields": "firstName", "isEmployee": "1", "page": "1"
        ])
        guard response.success, response.numRows != nil else {
            throw appError("RecMan denied access. Check the key and Candidates SELECT permission.")
        }
        let organizations = Set((response.data?.values ?? []).compactMap { $0.corporationId?.positiveID })
        if organizations.isEmpty { return "RecMan connection verified · Candidates SELECT" }
        return "RecMan connected · Corporation \(organizations.sorted().map(String.init).joined(separator: ", "))"
    }

    func fetchAll<Row: Decodable & Sendable>(_ scope: String, key: String,
                                             parameters: [String: String] = [:], maxPages: Int = 10) async throws -> [Row] {
        var rows: [Row] = []
        for page in 1...maxPages {
            let result: Page<Row> = try await read(scope, key: key,
                                                  parameters: parameters.merging(["page": String(page)]) { _, page in page })
            guard result.success else { throw appError("RecMan rejected the \(scope) request. Check SELECT access.") }
            let batch = result.data?.values ?? []
            guard result.numRows == batch.count, result.nextPage?.value != true || !batch.isEmpty else {
                throw appError("RecMan returned an incomplete \(scope) page.")
            }
            rows += batch
            if result.nextPage?.value != true { return rows }
        }
        throw appError("The \(scope) request reached its page limit. No partial list was loaded.")
    }

    func companies(key: String) async throws -> [RecManCompany] {
        try await cached("companies", scope: "company", key: key,
                         parameters: ["fields": "name,number,vatNumber,visitAddress"])
    }

    func products(key: String) async throws -> [RecManProduct] {
        try await cached("products", scope: "product", key: key)
    }

    func projects(key: String) async throws -> [RecManProject] {
        try await cached("projects", scope: "project", key: key, parameters: ["fields": "name,companyId"])
    }

    private func cached<T: Codable & Sendable>(_ name: String, scope: String, key: String,
                                                parameters: [String: String] = [:]) async throws -> [T] {
        let state = try RecManState(key: key)
        if let saved: [T] = state.cached(name) { return saved }
        let rows: [T] = try await fetchAll(scope, key: key, parameters: parameters)
        try state.save(rows, as: name)
        return rows
    }

    func originalPDF(document: RecManInvoice, key: String) async throws -> String {
        struct PDF: Decodable { let base64: String }
        struct Response: Decodable { let success: Bool; let data: PDF? }
        let response: Response = try await read(document.kind.scope + "Pdf", key: key,
                                                parameters: [document.kind.scope + "Id": String(document.id)])
        guard response.success, let encoded = response.data?.base64, let bytes = Data(base64Encoded: encoded),
              bytes.starts(with: Data("%PDF-".utf8)), bytes.count <= 10_000_000 else {
            throw appError("RecMan did not return a supported original PDF for \(document.number).")
        }
        return encoded
    }

    private func read<T: Decodable>(_ scope: String, key: String, parameters: [String: String]) async throws -> T {
        try Task.checkCancellation()
        try RecManState(key: key).spendRequest()
        let items = parameters.merging(["scope": scope, "key": key]) { _, required in required }
        let url = URL(string: "https://api.recman.io/v2/get/")!.appending(queryItems: items.sorted { $0.key < $1.key }
            .map { URLQueryItem(name: $0.key, value: $0.value) })
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("en", forHTTPHeaderField: "Accept-Language")
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            try Task.checkCancellation()
            // The request URL contains the key. Do not surface the transport error.
            throw appError("Could not reach RecMan. Check the connection and try again.")
        }
        guard let http = response as? HTTPURLResponse, data.count <= 20_000_000 else {
            throw appError("RecMan returned an invalid or oversized response.")
        }
        if http.statusCode == 429 { throw appError("RecMan’s request limit was reached. Try again later.") }
        if http.statusCode == 401 || http.statusCode == 403 { throw appError("RecMan denied access. Check the API key.") }
        guard (200..<300).contains(http.statusCode) else { throw appError("RecMan returned HTTP \(http.statusCode).") }
        guard let result = try? JSONDecoder().decode(T.self, from: data) else {
            throw appError("RecMan returned an unexpected \(scope) response.")
        }
        return result
    }
}

private struct RecManFlag: Decodable {
    let value: Bool

    init(from decoder: Decoder) throws {
        let box = try decoder.singleValueContainer()
        if let flag = try? box.decode(Bool.self) {
            value = flag
        } else {
            value = try RecManNumber(from: decoder).value > 0
        }
    }
}
