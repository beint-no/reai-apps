import Foundation

struct Company: Codable, Identifiable, Hashable, Sendable {
    let id: Int
    let companyName: String
}

struct Account: Decodable, Sendable {
    let email: String
    let tenants: [Company]
}

struct Project: Decodable, Identifiable, Sendable {
    let id: Int
    let name: String
    let archived: Bool
    let parentId: Int?
    let activityIds: [Int]
}

struct Activity: Decodable, Identifiable, Sendable {
    let id: Int
    let code: String
}

struct RunningTimer: Codable, Sendable {
    let timerId: Int
    let requestId: UUID
    let startedAt: Date
    let stoppedAt: Date?
    let projectId: Int?
    let projectName: String?
    let activityId: Int?
}

struct TimerStatus: Decodable, Sendable {
    let timer: RunningTimer?
}

struct StartRequest: Codable, Sendable {
    let requestId: UUID
    let projectId: Int?
    let activityId: Int?
}

struct StopRequest: Codable, Sendable {
    let timerId: Int
}

struct CompletedTimer: Decodable, Sendable {
    let timerId: Int
    let minutes: Int
    let hours: Double
}

struct PendingOperation: Codable, Sendable {
    let account: String
    let company: Int
    let start: StartRequest?
    let stop: StopRequest?
}

func appError(_ text: String, code: Int = 0) -> NSError {
    NSError(domain: "no.reai.timetracker", code: code, userInfo: [NSLocalizedDescriptionKey: text])
}

enum AppEnvironment {
    static let origin = URL(string: "https://app.reai.no")!
    static let profile = URL(string: "https://app.reai.no/user/profile#user-access-tokens")!
}
