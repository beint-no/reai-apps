import Foundation

struct RecentWork: Codable, Identifiable, Sendable {
    let account: String
    let company: Int
    let projectID: Int?
    let activityID: Int?
    let title: String
    var id: String { "\(projectID ?? 0):\(activityID ?? 0)" }
}

actor RecentWorkStore {
    private let directory = URL.applicationSupportDirectory.appending(path: "ReAI Time Tracker")
    private var file: URL { directory.appending(path: "recent-work.json") }

    func load(account: String, company: Int) throws -> [RecentWork] {
        try all().filter { $0.account == account && $0.company == company }
    }

    func remember(_ work: RecentWork) throws {
        var entries = try all().filter { !($0.account == work.account && $0.company == work.company && $0.id == work.id) }
        entries.insert(work, at: 0)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(Array(entries.prefix(30))).write(to: file, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }

    private func all() throws -> [RecentWork] {
        guard FileManager.default.fileExists(atPath: file.path) else { return [] }
        return try JSONDecoder().decode([RecentWork].self, from: Data(contentsOf: file))
    }
}

enum TimerPresentation {
    static func seconds(startedAt: Date, now: Date) -> Int { min(36_000, max(0, Int(now.timeIntervalSince(startedAt)))) }
    static func stopPreview(seconds: Int) -> String {
        seconds < 60 ? "\(60 - seconds)s until the first saved minute. Stopping now saves no time." : "Stop now to save \(seconds / 60) whole minute\(seconds / 60 == 1 ? "" : "s")."
    }
    static let rules = "Stop saves to ReAI immediately, in whole minutes. Under 1 minute saves nothing. For example, 1:59 saves 1 minute."
}
