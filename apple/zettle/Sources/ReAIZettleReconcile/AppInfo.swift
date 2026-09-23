import Foundation
struct CredentialField { let key: String; let label: String; let secret: Bool }
enum AppInfo {
    static let slug = "zettle"
    static let bundle = "no.reai.zettlereconcile"
    static let brand = "Zettle"
    static let helpURL = URL(string: "https://developer.zettle.com/docs/get-started/user-guides/create-app-credentials/create-app-credentials-for-self-hosted-app/create-credentials-self-hosted-app")!
    static let fields: [CredentialField] = [CredentialField(key: "clientId", label: "Client ID", secret: false), CredentialField(key: "apiKey", label: "API key (JWT)", secret: true)]
    static let credentialHint = "Create a Zettle self-hosted API key with READ:FINANCE scope. Paste its client ID and key; no browser sign-in in this app."
}
