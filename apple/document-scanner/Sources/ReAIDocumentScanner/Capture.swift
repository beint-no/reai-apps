import AppKit
import Carbon.HIToolbox
import CoreGraphics
import Foundation
import ServiceManagement
import UserNotifications

enum ScreenCapture {
    /// Runs the system region picker. Returns nil when the user presses Escape.
    static func region() async throws -> URL? {
        guard CGPreflightScreenCaptureAccess() else {
            CGRequestScreenCaptureAccess()
            throw appError("Allow ReAI Document Scanner under System Settings → Privacy & Security → Screen & System Audio Recording, then capture again.")
        }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let url = folder.appendingPathComponent("Receipt capture \(FileStamp.now).png")
        let status: Int32 = try await withCheckedThrowingContinuation { continuation in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
            // Interactive selection, no sound, PNG.
            process.arguments = ["-i", "-x", "-t", "png", url.path]
            process.terminationHandler = { continuation.resume(returning: $0.terminationStatus) }
            do { try process.run() } catch { continuation.resume(throwing: error) }
        }
        guard status == 0, FileManager.default.fileExists(atPath: url.path) else {
            try? FileManager.default.removeItem(at: folder)
            return nil
        }
        return url
    }
}

extension FileStamp {
    /// A local timestamp for generated file names, such as 2026-11-28 14.03.12.
    static var now: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd HH.mm.ss"
        return formatter.string(from: Date())
    }
}

enum Notifications {
    static func requestAuthorization() async {
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
    }

    static func post(title: String, body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
    }
}

/// A system-wide shortcut registered with Carbon, which needs no Accessibility permission.
struct Shortcut: Identifiable, Hashable, Sendable {
    let id: String
    let title: String
    let keyCode: UInt32
    let modifiers: UInt32

    static let options = [
        Shortcut(id: "shift-command-b", title: "⇧⌘B", keyCode: UInt32(kVK_ANSI_B), modifiers: UInt32(shiftKey | cmdKey)),
        Shortcut(id: "control-shift-command-b", title: "⌃⇧⌘B", keyCode: UInt32(kVK_ANSI_B), modifiers: UInt32(controlKey | shiftKey | cmdKey)),
        Shortcut(id: "option-shift-command-r", title: "⌥⇧⌘R", keyCode: UInt32(kVK_ANSI_R), modifiers: UInt32(optionKey | shiftKey | cmdKey)),
        Shortcut(id: "off", title: "Off", keyCode: 0, modifiers: 0),
    ]
    static let standard = options[0]
}

@MainActor
final class HotKey {
    static let shared = HotKey()
    private var reference: EventHotKeyRef?
    private var handler: EventHandlerRef?
    var action: () -> Void = {}

    var shortcut: Shortcut {
        get { Shortcut.options.first { $0.id == UserDefaults.standard.string(forKey: "captureShortcut") } ?? .standard }
        set { UserDefaults.standard.set(newValue.id, forKey: "captureShortcut") }
    }

    /// Registers the saved shortcut. Returns false when another app already owns it.
    @discardableResult
    func register() -> Bool {
        if let reference { UnregisterEventHotKey(reference); self.reference = nil }
        if handler == nil {
            var type = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
            InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in
                // Carbon delivers hot key events on the main thread.
                MainActor.assumeIsolated { HotKey.shared.action() }
                return noErr
            }, 1, &type, nil, &handler)
        }
        let shortcut = shortcut
        guard shortcut.id != "off" else { return true }
        let id = EventHotKeyID(signature: OSType(0x5245_4149), id: 1)
        return RegisterEventHotKey(shortcut.keyCode, shortcut.modifiers, id, GetApplicationEventTarget(), 0, &reference) == noErr
    }
}

enum LoginItem {
    static var enabled: Bool { SMAppService.mainApp.status == .enabled }

    static func set(_ enabled: Bool) throws {
        if enabled { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
    }
}
