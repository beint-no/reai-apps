import AppKit
import Foundation

actor Connection {
    func authorize(showCode: @escaping @Sendable (String) async -> Void) async throws -> String {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 30
        let session = URLSession(configuration: configuration, delegate: RedirectBlocker(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let (data, response) = try await session.data(for: form("authorize", ["client_id": "stripe", "client_name": "ReAI Stripe Import"]))
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw appError("ReAI could not start the connection. Please try again.")
        }
        struct Grant: Decodable {
            let deviceCode: String
            let userCode: String
            let verificationUriComplete: String
            let expiresIn: Int
            let interval: Int
        }
        let grant = try decoder.decode(Grant.self, from: data)
        guard (1...600).contains(grant.expiresIn), (1...60).contains(grant.interval),
              grant.userCode.range(of: "^[A-Z2-9]{5}-[A-Z2-9]{5}$", options: .regularExpression) != nil else {
            throw appError("ReAI returned an invalid approval request.")
        }
        let expected = AppEnvironment.origin.appending(path: "connect-app")
            .appending(queryItems: [URLQueryItem(name: "user_code", value: grant.userCode)])
        guard URL(string: grant.verificationUriComplete) == expected else {
            throw appError("ReAI returned an unexpected approval address.")
        }
        let deadline = ContinuousClock.now.advanced(by: .seconds(grant.expiresIn))
        await showCode(grant.userCode)
        try Task.checkCancellation()
        guard await MainActor.run(body: { NSWorkspace.shared.open(expected) }) else {
            throw appError("Your browser could not open. Please check your default browser and try again.")
        }
        var delay = grant.interval
        while ContinuousClock.now < deadline {
            try await Task.sleep(for: .seconds(delay))
            guard ContinuousClock.now < deadline else { break }
            let pair: (Data, URLResponse)
            do {
                pair = try await session.data(for: form("token", [
                    "client_id": "stripe", "device_code": grant.deviceCode,
                    "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
                ]))
            } catch {
                try Task.checkCancellation()
                delay = min(max(delay * 2, 10), 60)
                continue
            }
            guard let response = pair.1 as? HTTPURLResponse else { throw appError("Invalid approval response.") }
            if response.statusCode == 429 {
                let retry = response.value(forHTTPHeaderField: "Retry-After").flatMap(Int.init) ?? 60
                delay = max(delay, retry, 1)
                continue
            }
            struct Result: Decodable { let accessToken: String?; let tokenType: String?; let error: String? }
            guard response.statusCode == 200 || response.statusCode == 400 else {
                throw appError("ReAI could not finish connecting. Please try again.")
            }
            let result = try decoder.decode(Result.self, from: pair.0)
            if response.statusCode == 200, result.tokenType == "Bearer", let token = result.accessToken, !token.isEmpty {
                try Task.checkCancellation()
                return token
            }
            switch result.error {
            case "authorization_pending": break
            case "slow_down": delay += 5
            case "access_denied": throw appError("Connection declined in ReAI. You can connect again when ready.")
            case "expired_token": throw appError("The approval code expired. Please connect again.")
            default: throw appError("ReAI could not authorize this app. Please connect again.")
            }
        }
        throw appError("The approval code expired. Please connect again.")
    }

    private func form(_ action: String, _ fields: [String: String]) -> URLRequest {
        var request = URLRequest(url: AppEnvironment.origin.appending(path: "oauth/device/\(action)"))
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let characters = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
        request.httpBody = Data(fields.sorted { $0.key < $1.key }.map { key, value in
            key.addingPercentEncoding(withAllowedCharacters: characters)! + "=" + value.addingPercentEncoding(withAllowedCharacters: characters)!
        }.joined(separator: "&").utf8)
        return request
    }
}
