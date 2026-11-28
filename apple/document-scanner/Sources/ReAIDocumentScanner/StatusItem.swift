import AppKit
import SwiftUI

/// The menu bar icon. Files dropped on it upload to the quick drop destination; clicking it shows recent uploads.
@MainActor
final class StatusItemController: NSObject {
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    private let popover = NSPopover()
    private let model: ScannerModel

    init(model: ScannerModel) {
        self.model = model
        super.init()
        popover.behavior = .transient
        popover.contentViewController = NSHostingController(rootView: MenuPanel(model: model) { [weak self] in self?.popover.performClose(nil) })
        guard let button = item.button else { return }
        button.setAccessibilityLabel(AppEnvironment.appName)
        let target = StatusDropView(frame: button.bounds)
        target.autoresizingMask = [.width, .height]
        target.onClick = { [weak self] in self?.toggle() }
        target.onDrop = { [weak self] urls in
            guard let self else { return }
            Task { await self.model.quickAdd(urls) }
        }
        target.onTargeted = { button.highlight($0) }
        button.addSubview(target)
        observeIcon()
    }

    private func toggle() {
        guard let button = item.button else { return }
        if popover.isShown { popover.performClose(nil); return }
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        popover.contentViewController?.view.window?.makeKey()
        NSApp.activate()
    }

    private func observeIcon() {
        let symbol = withObservationTracking {
            model.needsAttention ? "exclamationmark.triangle.fill" : model.pending > 0 ? "tray.and.arrow.up.fill" : "doc.viewfinder"
        } onChange: { [weak self] in
            Task { @MainActor in self?.observeIcon() }
        }
        item.button?.image = NSImage(systemSymbolName: symbol, accessibilityDescription: model.uploadStatus)
    }
}

final class StatusDropView: NSView {
    var onClick: () -> Void = {}
    var onDrop: ([URL]) -> Void = { _ in }
    var onTargeted: (Bool) -> Void = { _ in }

    override init(frame: NSRect) {
        super.init(frame: frame)
        registerForDraggedTypes([.fileURL])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func mouseDown(with event: NSEvent) { onClick() }
    override func rightMouseDown(with event: NSEvent) { onClick() }

    private func files(_ info: any NSDraggingInfo) -> [URL] {
        info.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL] ?? []
    }

    override func draggingEntered(_ sender: any NSDraggingInfo) -> NSDragOperation {
        guard !files(sender).isEmpty else { return [] }
        onTargeted(true)
        return .copy
    }

    override func draggingExited(_ sender: (any NSDraggingInfo)?) { onTargeted(false) }

    override func performDragOperation(_ sender: any NSDraggingInfo) -> Bool {
        onTargeted(false)
        let urls = files(sender)
        guard !urls.isEmpty else { return false }
        onDrop(urls)
        return true
    }
}

struct MenuPanel: View {
    @Bindable var model: ScannerModel
    let close: () -> Void
    @State private var targeted = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(AppEnvironment.appName).font(.headline)
                    Text(model.company?.companyName ?? model.uploadStatus).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button(model.paused ? "Resume" : "Pause", systemImage: model.paused ? "play" : "pause") {
                    model.paused.toggle(); model.runQueue()
                }.labelStyle(.iconOnly).help(model.paused ? "Resume uploads" : "Pause uploads")
            }
            if model.connected {
                Picker("Drop to", selection: $model.quickDestination) {
                    ForEach(Destination.allCases) { Text($0.rawValue).tag($0) }
                }
                VStack(spacing: 6) {
                    Image(systemName: "tray.and.arrow.down").font(.title2).foregroundStyle(.teal)
                    Text("Drop files here or on the menu bar icon").font(.callout)
                }
                .frame(maxWidth: .infinity).padding(14)
                .background(.teal.opacity(targeted ? 0.15 : 0.06), in: RoundedRectangle(cornerRadius: 10))
                .dropDestination(for: URL.self) { urls, _ in
                    Task { await model.quickAdd(urls) }; return true
                } isTargeted: { targeted = $0 }
                HStack {
                    Button("Capture receipt", systemImage: "rectangle.dashed") {
                        close()
                        Task { await model.captureReceipt() }
                    }
                    Spacer()
                    if model.captureShortcut.id != "off" {
                        Text(model.captureShortcut.title).font(.caption).foregroundStyle(.secondary)
                    }
                }
                DeviceImportButton { data, name in
                    let destination = model.quickDestination
                    Task { await model.addScan(data, filename: name, destination: destination) }
                }
                Divider()
                Text("Recent uploads").font(.subheadline.bold())
                if model.visibleTransfers.isEmpty {
                    Text("No uploads yet.").font(.caption).foregroundStyle(.secondary)
                }
                ForEach(model.visibleTransfers.prefix(5)) { transfer in
                    HStack(spacing: 8) {
                        Image(systemName: TransferRow.symbol(transfer.status)).foregroundStyle(TransferRow.tint(transfer.status))
                        VStack(alignment: .leading, spacing: 1) {
                            Text(transfer.filename).lineLimit(1).truncationMode(.middle)
                            Text("\(transfer.status) · \(transfer.destination.rawValue)").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            } else {
                Text("Connect to ReAI to upload documents.").foregroundStyle(.secondary)
            }
            if let error = model.error {
                Text(error).font(.caption).foregroundStyle(.red).lineLimit(3)
            }
            Divider()
            HStack {
                Button("Open \(AppEnvironment.appName)") { close(); model.openMainWindow() }
                Spacer()
                Button("Quit") { NSApp.terminate(nil) }
            }
        }
        .padding(16).frame(width: 320)
    }
}
