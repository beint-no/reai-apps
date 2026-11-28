import AppKit
import ServiceManagement
import SwiftUI

final class BridgeAppDelegate: NSObject, NSApplicationDelegate {
    static let showSettings = Notification.Name("no.reai.posprintbridge.show-settings")

    func applicationWillFinishLaunching(_ notification: Notification) {
        // Single instance: a second launch asks the running bridge to show its settings, then quits.
        let others = NSRunningApplication.runningApplications(withBundleIdentifier: Bundle.main.bundleIdentifier ?? "")
            .filter { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }
        if !others.isEmpty {
            DistributedNotificationCenter.default().postNotificationName(Self.showSettings, object: nil, deliverImmediately: true)
            exit(0)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}

@main
struct BridgeApp: App {
    @NSApplicationDelegateAdaptor(BridgeAppDelegate.self) private var appDelegate
    @State private var model = BridgeModel()
    private let connected = Credentials.stored()

    var body: some Scene {
        MenuBarExtra {
            BridgeMenu(model: model)
        } label: {
            BridgeLabel(model: model)
        }
        Window("ReAI POS Print Bridge", id: "settings") {
            SettingsView(model: model)
                .frame(minWidth: 560, minHeight: 620)
                .task { await model.start() }
        }
        .defaultSize(width: 620, height: 760)
        .defaultLaunchBehavior(connected ? .suppressed : .presented)
    }
}

struct BridgeMenu: View {
    @Bindable var model: BridgeModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Text(model.company?.companyName ?? "Not connected")
        Text(model.status)
        if model.waiting > 0 { Text("\(model.waiting) receipt(s) waiting for the printer") }
        if !model.attention.isEmpty { Text("\(model.attention.count) receipt(s) need checking") }
        if let problem = model.connectionProblem ?? model.printerProblem ?? model.error { Text(problem) }
        Divider()
        Button("Test print") { Task { await model.testPrint() } }.disabled(!model.state.printer.configured || model.busy)
        Button("Open drawer") { Task { await model.openDrawer() } }.disabled(!model.state.printer.configured || model.busy)
        Button(model.state.paused ? "Resume printing" : "Pause printing") { model.togglePaused() }.disabled(!model.connected)
        Divider()
        Button("Settings…") { show() }.keyboardShortcut(",")
        Button("Quit ReAI POS Print Bridge") { NSApp.terminate(nil) }.keyboardShortcut("q")
    }

    private func show() { openWindow(id: "settings"); NSApp.activate() }
}

/// The menu bar icon is always present, so it starts the bridge and answers a second launch.
struct BridgeLabel: View {
    let model: BridgeModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Image(systemName: model.problem ? "exclamationmark.triangle" : "printer")
            .task { await model.start() }
            .onReceive(DistributedNotificationCenter.default().publisher(for: BridgeAppDelegate.showSettings)) { _ in
                openWindow(id: "settings"); NSApp.activate()
            }
    }
}

/// Opens at login through the system's login items.
enum LoginItem {
    static var enabled: Bool { SMAppService.mainApp.status == .enabled }
    static func set(_ on: Bool) throws {
        if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
    }
}
