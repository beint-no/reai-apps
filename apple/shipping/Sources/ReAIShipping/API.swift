import Foundation

final class RedirectBlocker: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

struct Company: Decodable, Sendable { let id: Int; let companyName: String }
struct Account: Decodable, Sendable { let tenants: [Company] }

enum AppEnvironment {
    static let origin = URL(string: "https://app.reai.no")!
    static func setup(company: Int) -> URL {
        origin.appending(path: "shipments").appending(queryItems: [
            URLQueryItem(name: "printOnMac", value: "true"), URLQueryItem(name: "tenantId", value: String(company))
        ])
    }
}

func t(_ key: String) -> String { NSLocalizedString(key, bundle: .module, comment: "") }
func appError(_ text: String, code: Int = 0) -> NSError {
    NSError(domain: "no.reai.shipping", code: code, userInfo: [NSLocalizedDescriptionKey: t(text)])
}

actor ReAIAPI {
    private let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 30
        return URLSession(configuration: config, delegate: RedirectBlocker(), delegateQueue: nil)
    }()

    func account(token: String) async throws -> Company {
        let (data, _) = try await get("api/me", token: token)
        let account = try JSONDecoder().decode(Account.self, from: data)
        guard account.tenants.count == 1, let company = account.tenants.first else {
            throw appError("Connect again and choose one company in ReAI.")
        }
        return company
    }

    func label(_ job: PrintRequest, token: String, verifyHandoff: Bool) async throws -> Data {
        let deadline = ContinuousClock.now.advanced(by: .seconds(120))
        while ContinuousClock.now < deadline {
            try Task.checkCancellation()
            let (data, response) = try await get("api/shipments/\(job.shipmentId)/label", token: token, company: job.tenantId, ticket: verifyHandoff ? job.printTicket : nil)
            if response.statusCode == 202 {
                try await Task.sleep(for: .seconds(2))
                continue
            }
            guard response.mimeType == "application/pdf", data.count <= 10 * 1024 * 1024,
                  data.starts(with: Data("%PDF-".utf8)) else {
                throw appError("This label is not a supported PDF. Open the order in ReAI to print it manually.")
            }
            return data
        }
        throw appError("The label is still being prepared. Try again here; the shipment will not be booked again.")
    }

    private func get(_ path: String, token: String, company: Int? = nil, ticket: String? = nil) async throws -> (Data, HTTPURLResponse) {
        var url = AppEnvironment.origin.appending(path: path)
        if let ticket { url.append(queryItems: [URLQueryItem(name: "printTicket", value: ticket)]) }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(Locale.preferredLanguages.first ?? "en", forHTTPHeaderField: "Accept-Language")
        if let company { request.setValue(String(company), forHTTPHeaderField: "X-Tenant-Id") }
        let (data, raw) = try await session.data(for: request)
        guard let response = raw as? HTTPURLResponse else { throw appError("ReAI returned an invalid response.") }
        guard (200..<300).contains(response.statusCode) else {
            switch response.statusCode {
            case 401: throw appError("Your connection has expired. Disconnect and connect to ReAI again.", code: 401)
            case 403: throw appError("You do not have permission to read labels in this company.", code: 403)
            case 404: throw appError("The shipment was not found, or shipping is disabled for this company.", code: 404)
            default:
                struct Problem: Decodable { let detail: String? }
                let detail = (try? JSONDecoder().decode(Problem.self, from: data))?.detail
                throw appError(detail ?? "ReAI could not load the label. Open the order to check its status.", code: response.statusCode)
            }
        }
        return (data, response)
    }
}
