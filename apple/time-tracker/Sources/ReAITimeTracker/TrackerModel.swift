import Foundation
import Observation

@MainActor @Observable
final class TrackerModel {
    private(set) var account: Account?
    private(set) var companyID: Int?
    private(set) var timer: RunningTimer?
    private(set) var projects: [Project] = []
    private(set) var activities: [Activity] = []
    private(set) var pending: PendingOperation?
    private(set) var busy = false
    private(set) var connecting = false
    private(set) var code = ""
    private(set) var synchronized = false
    private(set) var lastSync: Date?
    var projectID: Int?
    var activityID: Int?
    var error: String?
    var notice: String?
    var projectNotice: String?
    @ObservationIgnored private var token: String?
    @ObservationIgnored private let api = ReAIAPI()
    @ObservationIgnored private let credentials = Credentials()
    @ObservationIgnored private let operations = OperationStore()
    @ObservationIgnored private var monitoringTask: Task<Void, Never>?
    @ObservationIgnored private var connectionTask: Task<Void, Never>?

    var company: Company? { account?.tenants.first { $0.id == companyID } }
    var canStart: Bool { account != nil && companyID != nil && synchronized && timer == nil && pending == nil && !busy }
    var availableActivities: [Activity] {
        guard let project = projects.first(where: { $0.id == projectID }) else { return [] }
        let owner = project.parentId.flatMap { parent in projects.first { $0.id == parent } } ?? project
        return activities.filter { owner.activityIds.contains($0.id) }
    }

    func startMonitoring() {
        guard monitoringTask == nil else { return }
        monitoringTask = Task { await run() }
    }

    private func run() async {
        busy = true
        do {
            pending = try await operations.load()
            token = try await credentials.load()
            if let token { try await loadAccount(token) }
        } catch { self.error = error.localizedDescription }
        busy = false
        while !Task.isCancelled {
            do { try await Task.sleep(for: .seconds(30)) } catch { return }
            await refresh()
        }
    }

    func connect() {
        guard !busy, !connecting else { return }
        connecting = true
        error = nil
        connectionTask = Task { [self] in
            defer { connecting = false; code = ""; connectionTask = nil }
            do {
                let value = try await Connection().authorize { [weak self] code in
                    await MainActor.run { self?.code = code }
                }
                try await credentials.save(value)
                token = value
                busy = true
                defer { busy = false }
                try await loadAccount(value)
            } catch is CancellationError {
            } catch { self.error = error.localizedDescription }
        }
    }

    func cancelConnection() { connectionTask?.cancel() }

    private func loadAccount(_ token: String) async throws {
        let loaded: Account = try await api.request("api/me", token: token)
        account = loaded
        companyID = nil
        timer = nil
        synchronized = false
        if loaded.tenants.count == 1 {
            companyID = loaded.tenants[0].id
        } else if loaded.tenants.count > 1 {
            error = "Disconnect and connect again to choose a company and restrict this app’s access."
        }
        if companyID != nil { try await loadCompany() }
    }

    private func loadCompany() async throws {
        guard let token, let companyID else { return }
        try await loadTimer(token: token, company: companyID)
        do {
            let list: [Project] = try await api.request("api/projects", token: token, company: companyID)
            projects = list.filter { !$0.archived }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
            activities = try await api.request("api/projects/activities", token: token, company: companyID)
            projectNotice = nil
        } catch {
            projects = []
            activities = []
            projectNotice = "Projects are unavailable. You can still track time without a project."
        }
    }

    private func loadTimer(token: String, company: Int) async throws {
        synchronized = false
        let result: TimerStatus = try await api.request("api/project-timer", token: token, company: company)
        timer = result.timer
        synchronized = true
        lastSync = .now
    }

    func refresh() async {
        guard !busy, !connecting, let token else { return }
        busy = true
        defer { busy = false }
        do {
            if account == nil { try await loadAccount(token) }
            else if let companyID { try await loadTimer(token: token, company: companyID) }
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    func start() async {
        guard canStart, let account, let companyID else { return }
        let operation = PendingOperation(account: account.email, company: companyID,
                                         start: StartRequest(requestId: UUID(), projectId: projectID, activityId: activityID), stop: nil)
        await perform(operation)
    }

    func stop() async {
        guard !busy, pending == nil, let timer, let account, let companyID else { return }
        await perform(PendingOperation(account: account.email, company: companyID, start: nil,
                                       stop: StopRequest(timerId: timer.timerId)))
    }

    func retry() async {
        guard let pending else { return }
        await perform(pending)
    }

    private func perform(_ operation: PendingOperation) async {
        guard !busy, let token, operation.account == account?.email,
              operation.company == companyID else {
            error = "Reconnect with the original account and company to resolve the pending operation."
            return
        }
        busy = true
        error = nil
        notice = nil
        defer { busy = false }
        do {
            try await operations.save(operation)
            pending = operation
            if let start = operation.start {
                let result: RunningTimer = try await api.request("api/project-timer/start", token: token,
                    company: operation.company, body: JSONEncoder().encode(start))
                timer = result.stoppedAt == nil ? result : nil
                notice = result.stoppedAt == nil ? "Timer started in ReAI." : "This session already finished in ReAI."
            } else if let stop = operation.stop {
                let result: CompletedTimer = try await api.request("api/project-timer/stop", token: token,
                    company: operation.company, body: JSONEncoder().encode(stop))
                timer = nil
                notice = result.minutes == 0 ? "Stopped. Sessions under one minute do not create a timesheet entry." : "Saved \(result.minutes) minutes to ReAI."
            }
            try await operations.clear()
            pending = nil
            try await loadTimer(token: token, company: operation.company)
        } catch {
            let failure = error as NSError
            if failure.domain == "no.reai.timetracker", [400, 403, 404, 409, 422].contains(failure.code) {
                do { try await operations.clear(); pending = nil } catch { }
            }
            synchronized = false
            self.error = error.localizedDescription
        }
    }

    func disconnect() async {
        guard !busy, !connecting else { return }
        busy = true
        defer { busy = false }
        do {
            try await credentials.delete()
            token = nil
            account = nil
            companyID = nil
            timer = nil
            projects = []
            activities = []
            projectID = nil
            activityID = nil
            projectNotice = nil
            synchronized = false
            error = nil
            notice = "Disconnected on this Mac. Revoke the key in your ReAI profile if you no longer need it. Running timers continue in ReAI."
        } catch { self.error = error.localizedDescription }
    }
}
