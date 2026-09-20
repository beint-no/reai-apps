import AppKit
import SwiftUI

@main
struct TrackerApp: App {
    @State private var model = TrackerModel()

    var body: some Scene {
        Window("ReAI Time Tracker", id: "tracker") {
            TrackerView(model: model)
                .frame(minWidth: 390, idealWidth: 420, maxWidth: 520, minHeight: 530)
                .task { model.startMonitoring() }
        }
        .defaultSize(width: 420, height: 590)
        .windowResizability(.contentSize)
        MenuBarExtra {
            TrackerView(model: model, compact: true).frame(width: 350)
        } label: {
            Label(model.timer == nil ? "ReAI" : "Tracking", systemImage: model.timer == nil ? "timer" : "record.circle.fill")
        }
        .menuBarExtraStyle(.window)
    }
}

struct TrackerView: View {
    @Bindable var model: TrackerModel
    var compact = false
    @State private var confirmDisconnect = false
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                HStack(spacing: 12) {
                    Image(systemName: "timer").font(.system(size: 28, weight: .medium)).foregroundStyle(.teal)
                    Text("Time Tracker").font(.title2.bold())
                    Spacer()
                    if model.busy { ProgressView().controlSize(.small) }
                }
                if let account = model.account {
                    connected(account)
                } else {
                    connection
                }
                if let notice = model.notice {
                    Label(notice, systemImage: "checkmark.circle").font(.callout).foregroundStyle(.secondary)
                }
                if let error = model.error {
                    Label(error, systemImage: "exclamationmark.triangle").font(.callout).foregroundStyle(.orange)
                        .textSelection(.enabled)
                }
                Divider()
                HStack {
                    Link("ReAI", destination: AppEnvironment.origin)
                    Spacer()
                    if compact { Button("Open window") { openWindow(id: "tracker"); NSApp.activate() } }
                    Button("Quit") { NSApp.terminate(nil) }
                }.font(.caption).buttonStyle(.plain).foregroundStyle(.secondary)
            }.padding(24)
        }
        .background(.background)
        .task { model.startMonitoring(); await model.refresh() }
        .confirmationDialog("Disconnect this Mac?", isPresented: $confirmDisconnect) {
            Button("Disconnect", role: .destructive) { Task { await model.disconnect() } }
        } message: {
            Text("Any running timer will keep running in ReAI. This removes the local connection; revoke its access key in your ReAI profile to remove server access.")
        }
    }

    private var connection: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Connect to ReAI").font(.title.bold())
            Text("Start and stop a timer to record your work in ReAI.")
                .foregroundStyle(.secondary)
            if model.connecting {
                ProgressView("Waiting for approval…")
                if !model.code.isEmpty {
                    Text(model.code).font(.title.monospaced().bold()).textSelection(.enabled)
                    Text("Compare this code with the code in ReAI before approving. Only approve if both match.").font(.callout)
                }
                Button("Cancel connection") { model.cancelConnection() }
            } else {
                Button("Connect to ReAI", systemImage: "arrow.up.right.square") { model.connect() }
                    .buttonStyle(.borderedProminent).tint(.teal).controlSize(.large).disabled(model.busy)
            }
            Text("Choose a company and approve in your browser. The access key stays in macOS Keychain.")
                .font(.caption).foregroundStyle(.secondary)
            Link("Manage connected app keys", destination: AppEnvironment.profile).font(.caption)
        }.padding(.vertical, 14)
    }

    private func connected(_ account: Account) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            if let company = model.company {
                LabeledContent("Company", value: company.companyName)
            }
            if account.tenants.isEmpty { Text("No accessible companies. Ask your ReAI administrator for access.").foregroundStyle(.secondary) }
            if let timer = model.timer {
                VStack(alignment: .leading, spacing: 8) {
                    Label(model.synchronized ? "TRACKING" : "LAST KNOWN TIMER", systemImage: "record.circle.fill")
                        .font(.caption.weight(.semibold)).foregroundStyle(.teal)
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        let seconds = min(36_000, max(0, Int(context.date.timeIntervalSince(timer.startedAt))))
                        Text(String(format: "%02d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60))
                            .font(.system(size: compact ? 42 : 52, weight: .light, design: .monospaced))
                            .accessibilityLabel("Elapsed time")
                    }
                    Text(timer.projectName ?? "Without a project").font(.headline)
                    Text("Started \(timer.startedAt.formatted(date: .abbreviated, time: .shortened))").font(.caption).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity, alignment: .leading).padding(20).background(.teal.opacity(0.08), in: .rect(cornerRadius: 16))
                Button("Stop & save", systemImage: "stop.fill") { Task { await model.stop() } }
                    .buttonStyle(.borderedProminent).tint(.teal).controlSize(.large)
                    .disabled(model.busy || model.pending != nil)
            } else if model.companyID != nil {
                VStack(alignment: .leading, spacing: 14) {
                    Text(model.synchronized ? "No timer running." : "Checking your timer…").font(.title2.weight(.medium))
                    Picker("Project", selection: $model.projectID) {
                        Text("Without a project").tag(Int?.none)
                        ForEach(model.projects) { project in Text(project.name).tag(Optional(project.id)) }
                    }.onChange(of: model.projectID) { model.activityID = nil }
                    if !model.availableActivities.isEmpty {
                        Picker("Activity", selection: $model.activityID) {
                            Text("No activity").tag(Int?.none)
                            ForEach(model.availableActivities) { activity in Text(activity.code).tag(Optional(activity.id)) }
                        }
                    }
                    Button("Start tracking", systemImage: "play.fill") { Task { await model.start() } }
                        .buttonStyle(.borderedProminent).tint(.teal).controlSize(.large).disabled(!model.canStart)
                    if let notice = model.projectNotice { Text(notice).font(.caption).foregroundStyle(.secondary) }
                }.disabled(model.busy || model.pending != nil)
            }
            if model.pending != nil {
                VStack(alignment: .leading, spacing: 8) {
                    Text("A request needs confirmation").font(.headline)
                    Text("Retry the saved request to safely confirm its result. It will not duplicate time or stop a newer session.").font(.caption)
                    Button("Retry saved request", systemImage: "arrow.clockwise") { Task { await model.retry() } }.disabled(model.busy)
                }
            }
            Text("Timers keep running when you quit or your Mac sleeps. ReAI stops them automatically after 10 hours.")
                .font(.caption).foregroundStyle(.secondary)
            HStack {
                Button("Refresh", systemImage: "arrow.clockwise") { Task { await model.refresh() } }.disabled(model.busy)
                Spacer()
                Button("Disconnect") { confirmDisconnect = true }.disabled(model.busy)
            }.buttonStyle(.plain).font(.caption)
            Text(account.email).font(.caption2).foregroundStyle(.secondary).textSelection(.enabled)
        }
    }
}
