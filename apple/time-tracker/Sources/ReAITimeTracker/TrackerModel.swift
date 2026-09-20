import Foundation
import Observation

@MainActor @Observable
final class TrackerModel {
    private(set) var account: Account?
    private(set) var companyID: Int?
    private(set) var timer: RunningTimer?
    private(set) var projects: [Project] = []
    private(set) var activities: [Activity] = []
    private(set) var recentWork: [RecentWork] = []
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
    @ObservationIgnored private let recentStore = RecentWorkStore()
    @ObservationIgnored private var monitoringTask: Task<Void, Never>?
    @ObservationIgnored private var connectionTask: Task<Void, Never>?

    var company: Company? { account?.tenants.first { $0.id == companyID } }
    var canStart: Bool { account != nil && companyID != nil && synchronized && timer == nil && pending == nil && !busy }
    var availableActivities: [Activity] { activitiesFor(projectID) }
    var timesheetURL: URL? {
        companyID.flatMap { URL(string: "https://app.reai.no/timesheet?tenantId=\($0)") }
    }
    func projectTitle(_ project: Project) -> String {
        if let parent = projects.first(where: { $0.id == project.parentId }) { return "\(parent.name) / \(project.name)" }
        return project.name
    }
    func selectProject(_ id: Int?) { projectID = id; activityID = nil }
    private func activitiesFor(_ id: Int?) -> [Activity] {
        guard let project = projects.first(where: { $0.id == id }) else { return [] }
        let owner = project.parentId.flatMap { parent in projects.first { $0.id == parent } } ?? project
        return activities.filter { owner.activityIds.contains($0.id) }
    }
    private func loadRecent() async {
        guard let account, let companyID else { return }
        let saved = (try? await recentStore.load(account: account.email, company: companyID)) ?? []
        recentWork = saved.filter { work in
            if work.projectID == nil { return work.activityID == nil }
            return projects.contains { $0.id == work.projectID } && (work.activityID == nil || activitiesFor(work.projectID).contains { $0.id == work.activityID })
        }
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
        projectID = nil
        activityID = nil
        recentWork = []
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
            projects = list.filter { project in !project.archived && (project.parentId == nil || list.contains { $0.id == project.parentId && !$0.archived }) }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
            activities = try await api.request("api/projects/activities", token: token, company: companyID)
            projectNotice = nil
        } catch {
            projects = []
            activities = []
            projectNotice = "Projects are unavailable. You can still track time without a project."
        }
        await loadRecent()
        if let recent = recentWork.first { projectID = recent.projectID; activityID = recent.activityID }
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

    func start(recent: RecentWork? = nil) async {
        guard canStart, let account, let companyID else { return }
        if let recent {
            guard recentWork.contains(where: { $0.id == recent.id && $0.account == account.email && $0.company == companyID }) else { return }
            projectID = recent.projectID; activityID = recent.activityID
        }
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
                guard result.requestId == start.requestId, result.timerId > 0 else { throw appError("Unexpected timer response. Retry the saved request.") }
                timer = result.stoppedAt == nil ? result : nil
                let title = projects.first(where: { $0.id == result.projectId }).map(projectTitle) ?? result.projectName ?? "Without a project"
                let activity = activities.first { $0.id == result.activityId }?.code
                try? await recentStore.remember(RecentWork(account: operation.account, company: operation.company,
                    projectID: result.projectId, activityID: result.activityId, title: title + (activity.map { " · " + $0 } ?? "")))
                await loadRecent()
                notice = result.stoppedAt == nil ? "Timer started in ReAI." : "This session already finished in ReAI."
            } else if let stop = operation.stop {
                let result: CompletedTimer = try await api.request("api/project-timer/stop", token: token,
                    company: operation.company, body: JSONEncoder().encode(stop))
                guard result.timerId == stop.timerId, (0...600).contains(result.minutes) else { throw appError("Unexpected stop response. Retry the saved request.") }
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
            recentWork = []
            projectID = nil
            activityID = nil
            projectNotice = nil
            synchronized = false
            error = nil
            notice = "Disconnected on this Mac. Revoke the key in your ReAI profile if you no longer need it. Running timers continue in ReAI."
        } catch { self.error = error.localizedDescription }
    }
}
