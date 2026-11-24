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

actor RecManAPI {
    private struct EmployeePage: Decodable {
        let success: Bool
        let numRows: Int?
        let employees: [RecManEmployee]
        let hasNext: Bool

        private enum CodingKeys: String, CodingKey { case success, numRows, data, nextPage }

        init(from decoder: Decoder) throws {
            let box = try decoder.container(keyedBy: CodingKeys.self)
            success = try box.decode(Bool.self, forKey: .success)
            numRows = try box.decodeIfPresent(Int.self, forKey: .numRows)
            guard success else {
                employees = []
                hasNext = false
                return
            }

            if let byID = try? box.decode([String: RecManEmployee].self, forKey: .data) {
                employees = Array(byID.values)
            } else {
                employees = try box.decodeIfPresent([RecManEmployee].self, forKey: .data) ?? []
            }
            if let next = try? box.decode(Bool.self, forKey: .nextPage) {
                hasNext = next
            } else {
                let next = try box.decodeIfPresent(RecManNumber.self, forKey: .nextPage)
                hasNext = (next?.value ?? 0) > 0
            }
        }
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
        var employees: [RecManEmployee] = []
        var identities = Set<Int>()
        for page in 1...10 {
            let result = try await fetch(page: page, key: key)
            for employee in result.employees {
                guard let id = employee.candidateId.positiveID, identities.insert(id).inserted else {
                    throw appError("RecMan returned a missing or repeated candidate ID. Reload before importing.")
                }
                employees.append(employee)
            }
            if !result.hasNext {
                return employees.sorted {
                    let comparison = $0.name.localizedCaseInsensitiveCompare($1.name)
                    if comparison == .orderedSame {
                        return ($0.candidateId.positiveID ?? 0) < ($1.candidateId.positiveID ?? 0)
                    }
                    return comparison == .orderedAscending
                }
            }
        }
        throw appError("The employee list reached the 10-request limit. No partial list was loaded.")
    }

    private func fetch(page: Int, key: String) async throws -> EmployeePage {
        let url = URL(string: "https://api.recman.io/v2/get/")!.appending(queryItems: [
            URLQueryItem(name: "key", value: key),
            URLQueryItem(name: "scope", value: "candidate"),
            URLQueryItem(name: "isEmployee", value: "1"),
            URLQueryItem(name: "fields", value: "firstName,lastName,email,employment"),
            URLQueryItem(name: "page", value: String(page))
        ])
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("en", forHTTPHeaderField: "Accept-Language")
        // The URL contains the API key. Keep transport errors and response bodies out of messages.
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            try Task.checkCancellation()
            throw appError("Could not reach RecMan. Check your connection and try again.")
        }
        guard let http = response as? HTTPURLResponse, data.count <= 20_000_000 else {
            throw appError("RecMan returned an invalid or oversized response.")
        }
        if http.statusCode == 429 { throw appError("RecMan’s request limit was reached. Try again later.") }
        if http.statusCode == 401 || http.statusCode == 403 {
            throw appError("RecMan denied access. Check the API key and Candidates SELECT permission.")
        }
        guard (200..<300).contains(http.statusCode) else {
            throw appError("RecMan returned HTTP \(http.statusCode).")
        }
        guard let result = try? JSONDecoder().decode(EmployeePage.self, from: data) else {
            throw appError("RecMan returned an unexpected employee list.")
        }
        guard result.success else {
            throw appError("RecMan rejected the employee request. Check the API key and Candidates SELECT permission.")
        }
        guard result.numRows == result.employees.count,
              !result.hasNext || !result.employees.isEmpty else {
            throw appError("RecMan returned an incomplete employee page.")
        }
        return result
    }
}
