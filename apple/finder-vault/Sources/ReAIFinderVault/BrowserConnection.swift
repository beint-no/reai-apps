import AppKit
import Foundation

actor BrowserConnection {
    private let configuration: URLSessionConfiguration
    private let openBrowser: @Sendable (URL) async -> Bool
    private let onCode: @Sendable (String) async -> Void

    init(configuration: URLSessionConfiguration = .ephemeral,
         onCode: @escaping @Sendable (String) async -> Void = { _ in },
         openBrowser: @escaping @Sendable (URL) async -> Bool = { url in
             await MainActor.run { NSWorkspace.shared.open(url) }
         }) {
        self.configuration = configuration
        self.onCode = onCode
        self.openBrowser = openBrowser
    }

    func connect() async throws -> String {
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 30
        let session = URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let (data, response) = try await session.data(for: request("oauth/device/authorize", fields: ["client_id": "finder-vault", "client_name": "ReAI Finder Vault"]))
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw vaultError("ReAI could not start the connection. Please try again.")
        }
        struct Authorization: Decodable {
            let deviceCode: String
            let userCode: String
            let verificationUriComplete: String
            let expiresIn: Int
            let interval: Int
        }
        let authorization = try decoder.decode(Authorization.self, from: data)
        guard authorization.expiresIn > 0, authorization.expiresIn <= 600, authorization.interval > 0,
              authorization.interval <= 60,
              authorization.userCode.range(of: "^[A-Z2-9]{5}-[A-Z2-9]{5}$", options: .regularExpression) != nil else {
            throw vaultError("ReAI returned an invalid connection request.")
        }
        var expected = URLComponents(string: VaultEnvironment.origin + "/connect-app")!
        expected.queryItems = [URLQueryItem(name: "user_code", value: authorization.userCode)]
        guard let url = expected.url, URL(string: authorization.verificationUriComplete) == url else {
            throw vaultError("ReAI returned an unexpected approval address.")
        }
        let deadline = ContinuousClock.now.advanced(by: .seconds(authorization.expiresIn))
        await onCode(authorization.userCode)
        try Task.checkCancellation()
        guard await openBrowser(url) else { throw vaultError("Could not open your browser.") }
        var interval = authorization.interval
        struct TokenResponse: Decodable { let accessToken: String?; let tokenType: String?; let error: String? }
        while ContinuousClock.now < deadline {
            try await Task.sleep(for: .seconds(interval))
            guard ContinuousClock.now < deadline else { break }
            let (tokenData, tokenResponse) = try await session.data(for: request("oauth/device/token", fields: [
                "client_id": "finder-vault", "device_code": authorization.deviceCode,
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
            ]))
            let status = (tokenResponse as? HTTPURLResponse)?.statusCode
            if status == 429 { interval = max(interval, 60); continue }
            guard status == 200 || status == 400 else { throw vaultError("ReAI could not finish connecting. Please try again.") }
            let result = try decoder.decode(TokenResponse.self, from: tokenData)
            if status == 200, let token = result.accessToken, !token.isEmpty, result.tokenType == "Bearer" {
                try Task.checkCancellation()
                return token
            }
            switch result.error {
            case "authorization_pending": continue
            case "slow_down": interval = min(interval + 5, 60)
            case "access_denied": throw vaultError("Connection was cancelled in ReAI. You can start again whenever you’re ready.")
            case "expired_token": throw vaultError("This connection request expired. Click Connect to ReAI to start again.")
            default: throw vaultError("ReAI could not authorize this app. Please start a new connection.")
            }
        }
        throw vaultError("Connection timed out. Click Connect to ReAI to try again.")
    }

    private func request(_ path: String, fields: [String: String]) -> URLRequest {
        var request = URLRequest(url: VaultEnvironment.baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        request.httpBody = Data(fields.sorted { $0.key < $1.key }.map {
            $0.key.addingPercentEncoding(withAllowedCharacters: allowed)! + "=" + $0.value.addingPercentEncoding(withAllowedCharacters: allowed)!
        }.joined(separator: "&").utf8)
        return request
    }
}
