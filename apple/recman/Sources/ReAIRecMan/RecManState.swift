import CryptoKit
import Darwin
import Foundation

struct RecManState {
    private struct Budget: Codable { let day: String; var requests: Int }
    private struct Cache<Value: Codable>: Codable { let savedAt: Date; let value: Value }

    private let root: URL

    init(key: String) throws {
        let fingerprint = Self.fingerprint(key)
        root = URL.applicationSupportDirectory.appending(path: "ReAIRecMan", directoryHint: .isDirectory)
            .appending(path: "RecMan", directoryHint: .isDirectory).appending(path: fingerprint, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
    }

    static func fingerprint(_ key: String) -> String {
        SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    func spendRequest() throws {
        let lockURL = root.appending(path: "requests.lock")
        let descriptor = open(lockURL.path, O_WRONLY | O_CREAT | O_NOFOLLOW, 0o600)
        guard descriptor >= 0 else { throw appError("Could not open the RecMan request counter.") }
        defer { close(descriptor) }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
            throw appError("Another window is updating the RecMan request counter.")
        }

        let file = root.appending(path: "requests.json")
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "Europe/Oslo")
        formatter.dateFormat = "yyyy-MM-dd"
        let day = formatter.string(from: .now)
        let existing: Budget?
        do {
            existing = try JSONDecoder().decode(Budget.self, from: Data(contentsOf: file))
        } catch CocoaError.fileReadNoSuchFile {
            existing = nil
        }
        var budget = existing.flatMap { $0.day == day ? $0 : nil } ?? Budget(day: day, requests: 0)
        guard (0..<200).contains(budget.requests) else {
            throw appError("The app’s 200-request RecMan budget is used for today.")
        }
        budget.requests += 1
        try JSONEncoder().encode(budget).write(to: file, options: .atomic)
    }

    func cached<Value: Codable>(_ name: String) -> Value? {
        let file = root.appending(path: name + ".json")
        guard let data = try? Data(contentsOf: file), let entry = try? JSONDecoder().decode(Cache<Value>.self, from: data),
              (0..<86_400).contains(Date.now.timeIntervalSince(entry.savedAt)) else { return nil }
        return entry.value
    }

    func save<Value: Codable>(_ value: Value, as name: String) throws {
        let file = root.appending(path: name + ".json")
        try JSONEncoder().encode(Cache(savedAt: .now, value: value)).write(to: file, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }
}
