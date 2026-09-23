import Foundation

actor StripeAPI {
    private let session: URLSession
    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 25
        configuration.timeoutIntervalForResource = 45
        session = URLSession(configuration: configuration, delegate: RedirectBlocker(), delegateQueue: nil)
    }

    private func get<T: Decodable & Sendable>(_ path: String, key: String, query: [URLQueryItem] = []) async throws -> T {
        guard let url = URL(string: "https://api.stripe.com/v1/\(path)")?.appending(queryItems: query) else {
            throw appError("Invalid Stripe request.")
        }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw appError("Stripe returned an invalid response.") }
        guard (200..<300).contains(response.statusCode) else {
            throw appError(response.statusCode == 401 ? "Stripe rejected this key. Paste a valid restricted read key." :
                           "Stripe returned HTTP \(response.statusCode). Check the key's read permissions and try again.")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    func account(key: String) async throws -> StripeAccount { try await get("account", key: key) }

    func invoices(key: String) async throws -> ([StripeInvoice], Bool) {
        var result: [StripeInvoice] = []
        var more = true
        while more && result.count < 500 {
            var query = [URLQueryItem(name: "limit", value: "100"), URLQueryItem(name: "status", value: "paid")]
            if let last = result.last { query.append(URLQueryItem(name: "starting_after", value: last.id)) }
            let page: StripePage<StripeInvoice> = try await get("invoices", key: key, query: query)
            guard !page.has_more || !page.data.isEmpty else { throw appError("Stripe returned an empty invoice page.") }
            result += page.data
            more = page.has_more
        }
        return (result, more)
    }

    func subscriptions(key: String) async throws -> ([StripeSubscription], Bool) {
        var result: [StripeSubscription] = []
        var more = true
        while more && result.count < 500 {
            var query = [URLQueryItem(name: "limit", value: "100"), URLQueryItem(name: "status", value: "all"),
                         URLQueryItem(name: "expand[]", value: "data.customer")]
            if let last = result.last { query.append(URLQueryItem(name: "starting_after", value: last.id)) }
            let page: StripePage<StripeSubscription> = try await get("subscriptions", key: key, query: query)
            guard !page.has_more || !page.data.isEmpty else { throw appError("Stripe returned an empty subscription page.") }
            result += page.data
            more = page.has_more
        }
        return (result, more)
    }
}
