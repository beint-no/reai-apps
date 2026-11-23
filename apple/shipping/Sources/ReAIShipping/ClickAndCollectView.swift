import AppKit
import PDFKit
import SwiftUI

struct ClickAndCollectView: View {
    @Bindable var model: ShippingModel
    @State private var confirmReprint = false
    @State private var confirmResendEmail = false
    @State private var confirmHandover = false

    var body: some View {
        HSplitView {
            pickupList.frame(minWidth: 190, idealWidth: 225, maxWidth: 270)
            ScrollView {
                pickupDetails.padding(16).frame(maxWidth: .infinity, alignment: .leading)
            }.frame(minWidth: 520)
        }
        .task { await model.refreshPickups() }
        .confirmationDialog("Print Click & Collect label again? Check the printer queue first.", isPresented: $confirmReprint) {
            Button("Print again") {
                Task { await model.printPickupLabel(markReady: false, confirmedReprint: true) }
            }
        } message: {
            if let order = model.selectedPickupOrder {
                Text("1 × Click & Collect label · \(order.number) (does not resend customer email)")
            }
        }
        .confirmationDialog(resendDialogTitle, isPresented: $confirmResendEmail) {
            Button(resendButtonLabel) {
                Task { await model.notifyPickupReady() }
            }
        } message: {
            if let order = model.selectedPickupOrder {
                Text(resendDialogMessage(for: order))
            }
        }
        .confirmationDialog("Mark order handed over?", isPresented: $confirmHandover) {
            Button("Mark handed over") {
                Task { await model.fulfillSelectedPickup() }
            }
        } message: {
            if let order = model.selectedPickupOrder {
                Text("Confirm customer collected \(order.number). This completes the order and records inventory delivery.")
            }
        }
    }

    private var pickupList: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text("Click & Collect").font(.subheadline.weight(.semibold))
                Text("\(model.pickupTotalOrders)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                Spacer()
                if model.loadingPickups { ProgressView().controlSize(.mini) }
                Button { Task { await model.refreshPickups() } } label: { Image(systemName: "arrow.clockwise") }
                    .buttonStyle(.borderless).help("Refresh Click & Collect orders").disabled(model.busy)
            }.padding(.horizontal, 10).padding(.top, 8)
            HStack(spacing: 4) {
                TextField("Order or customer", text: $model.pickupSearch)
                    .textFieldStyle(.roundedBorder).controlSize(.small)
                    .onSubmit { Task { await model.refreshPickups() } }
                Button { Task { await model.refreshPickups() } } label: { Image(systemName: "magnifyingglass") }
                    .controlSize(.small).help("Search Click & Collect orders").disabled(model.loadingPickups)
            }.padding(.horizontal, 10).disabled(model.busy)
            if model.pickupOrders.isEmpty && !model.loadingPickups {
                Text("No pending Click & Collect orders.")
                    .font(.caption).foregroundStyle(.secondary).padding(.horizontal, 10).padding(.top, 4)
            }
            List {
                ForEach(model.pickupOrders) { order in
                    let isReady = order.pickupReadiness?.ready == true
                    let isPrinted = model.pickupRecord(order.id) != nil
                    Button { Task { await model.selectPickup(order) } } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 4) {
                                Text(order.number).font(.callout.weight(.semibold)).lineLimit(1)
                                if isReady {
                                    Text("Ready")
                                        .font(.caption2.weight(.semibold))
                                        .padding(.horizontal, 5).padding(.vertical, 1)
                                        .background(Color.teal.opacity(0.16), in: Capsule())
                                        .foregroundStyle(.teal)
                                } else if isPrinted {
                                    Image(systemName: "printer.fill").font(.caption2).foregroundStyle(.secondary)
                                }
                                Spacer(minLength: 4)
                                Text(order.date).font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
                            }
                            Text(order.customerName).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }.padding(.vertical, 2).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                    }.buttonStyle(.plain)
                        .listRowBackground(model.selectedPickupOrder?.id == order.id ? Color.accentColor.opacity(0.14) : Color.clear)
                        .disabled(model.busy)
                }
                if model.canLoadMorePickups {
                    Button("Load more") { Task { await model.refreshPickups(more: true) } }
                        .controlSize(.small).disabled(model.busy || model.loadingPickups)
                }
            }.listStyle(.sidebar)
        }
    }

    @ViewBuilder private var pickupDetails: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let order = model.selectedPickupOrder {
                pickupHeader(order)
                OrderItemsCardView(items: model.pickupDisplayedItems, loading: model.busy)
                if let notes = model.selectedPickupDetail?.notes?.trimmingCharacters(in: .whitespacesAndNewlines), !notes.isEmpty {
                    HStack(alignment: .top, spacing: 6) {
                        Image(systemName: "note.text").foregroundStyle(.secondary)
                        Text(notes).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                    }
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 6))
                }
                pickupActions(order)
                pickupInfoAndPreview(order)
            } else {
                ContentUnavailableView("Choose a Click & Collect order", systemImage: "bag",
                                       description: Text("Pick an order on the left to see items, warehouse locations, mark it ready, and print a \"Will be collected\" label."))
                    .padding(.vertical, 24)
            }
        }
    }

    private func pickupHeader(_ order: CommercePickingOrder) -> some View {
        let isReady = model.pickupReadiness?.ready == true
        return HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(order.number).font(.title2.bold())
            Text(order.customerName).font(.headline).foregroundStyle(.secondary).lineLimit(1)
            Text(isReady ? "Ready for pickup" : "Awaiting prep")
                .font(.caption.weight(.medium))
                .padding(.horizontal, 7).padding(.vertical, 2)
                .background((isReady ? Color.teal : Color.secondary).opacity(0.14), in: Capsule())
                .foregroundStyle(isReady ? .teal : .secondary)
            Spacer(minLength: 8)
            if let company = model.company {
                Link("Open in ReAI", destination: AppEnvironment.origin.appending(path: "order/\(order.id)")
                    .appending(queryItems: [URLQueryItem(name: "tenantId", value: String(company.id))]))
                    .font(.caption)
            }
        }
    }

    private func pickupActions(_ order: CommercePickingOrder) -> some View {
        let readiness = model.pickupReadiness
        let isReady = readiness?.ready == true
        let hasReceipt = model.pickupRecord(order.id) != nil
        let canMarkAndPrint = !isReady && readiness?.allowsNotification == true
        let canFulfill = model.selectedPickupDetail?.canFulfillPickup == true
        let printLabelTitle = canMarkAndPrint
            ? "Print \"Will be collected\" label & mark ready"
            : (hasReceipt ? "Print \"Will be collected\" label again" : "Print \"Will be collected\" label")
        let triggerPrint: () -> Void = {
            if hasReceipt {
                confirmReprint = true
            } else {
                Task { await model.printPickupLabel(markReady: canMarkAndPrint) }
            }
        }
        return VStack(alignment: .leading, spacing: 8) {
            if isReady && canFulfill {
                Button { confirmHandover = true } label: {
                    Label("Mark handed over", systemImage: "checkmark.circle.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent).controlSize(.large)
                .disabled(model.busy)

                Text("Confirm when the customer collects this order in store. Completes the order and removes it from Click & Collect.")
                    .font(.caption).foregroundStyle(.secondary)

                HStack(spacing: 8) {
                    Button(action: triggerPrint) {
                        Label(printLabelTitle, systemImage: "printer")
                    }
                    .buttonStyle(.bordered)
                    .disabled(!model.canPrint || model.loadingPickups || model.selectedPickupDetail == nil)

                    if let readiness, readiness.allowsNotification {
                        Button(resendButtonLabel) { confirmResendEmail = true }
                            .buttonStyle(.bordered)
                            .disabled(model.busy)
                    }
                    Spacer(minLength: 8)
                    if let readiness {
                        HStack(spacing: 5) {
                            Image(systemName: "checkmark.circle.fill").foregroundStyle(.teal)
                            Text("Pickup email: \(emailStatusLabel(readiness.emailStatus))")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            } else {
                Button(action: triggerPrint) {
                    Label(printLabelTitle, systemImage: "printer.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent).controlSize(.large)
                .disabled(!model.canPrint || model.loadingPickups || model.selectedPickupDetail == nil)

                Text(primaryCaption(canMarkAndPrint: canMarkAndPrint))
                    .font(.caption).foregroundStyle(.secondary)

                HStack(spacing: 8) {
                    if canFulfill {
                        Button { confirmHandover = true } label: {
                            Label("Mark handed over", systemImage: "checkmark.circle")
                        }
                        .buttonStyle(.bordered)
                        .disabled(model.busy)
                    }
                    if let readiness, !readiness.ready, readiness.allowsNotification {
                        Button("Mark ready without printing") {
                            Task { await model.notifyPickupReady() }
                        }
                        .buttonStyle(.bordered)
                        .disabled(model.busy)
                    } else if let readiness, readiness.ready {
                        HStack(spacing: 5) {
                            Image(systemName: "checkmark.circle.fill").foregroundStyle(.teal)
                            Text("Pickup email: \(emailStatusLabel(readiness.emailStatus))")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        if readiness.allowsNotification {
                            Button(resendButtonLabel) { confirmResendEmail = true }
                                .buttonStyle(.bordered)
                                .disabled(model.busy)
                        }
                    }
                    Spacer(minLength: 8)
                }
            }
        }
    }

    private func pickupInfoAndPreview(_ order: CommercePickingOrder) -> some View {
        let detail = model.selectedPickupDetail
        let contactParts = [order.customerName, detail?.phone, detail?.email]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        let receipt = model.pickupRecord(order.id)
        return HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Image(systemName: "person").font(.caption).foregroundStyle(.secondary)
                    Text(contactParts.joined(separator: " · ")).font(.callout).textSelection(.enabled)
                }
                if let instructions = detail?.pickupInstructions?.trimmingCharacters(in: .whitespacesAndNewlines), !instructions.isEmpty {
                    HStack(alignment: .top, spacing: 6) {
                        Image(systemName: "storefront").font(.caption).foregroundStyle(.secondary).padding(.top, 2)
                        Text(instructions).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                    }
                }
                if let receipt {
                    HStack(spacing: 6) {
                        Image(systemName: "printer").font(.caption).foregroundStyle(.secondary)
                        Text((receipt.state == "queued" ? "Label sent to queue" : "Check printer queue") + " · " + receipt.printerId.replacingOccurrences(of: "_", with: " "))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12).padding(.vertical, 9)
            .background(Color.primary.opacity(0.025), in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.primary.opacity(0.08)))

            if let detail, detail.order?.id == order.id,
               let data = try? model.pickupLabelPDF(),
               let pdf = PDFDocument(data: data),
               let page = pdf.page(at: 0) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Label preview · 100 × 150 mm").font(.caption2).foregroundStyle(.secondary)
                    Image(nsImage: page.thumbnail(of: CGSize(width: 240, height: 360), for: .mediaBox))
                        .resizable().aspectRatio(contentMode: .fit)
                        .frame(width: 120, height: 180)
                        .background(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                        .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(Color.primary.opacity(0.15)))
                }
            }
        }
    }

    private func primaryCaption(canMarkAndPrint: Bool) -> String {
        if model.printerId.isEmpty { return "Choose a printer below to print." }
        if canMarkAndPrint {
            return "Marks this order ready, notifies the customer by email, and prints one 100 × 150 mm Click & Collect label."
        }
        return "Prints one 100 × 150 mm \"Will be collected\" label to your printer. Does not complete handover."
    }

    private func emailStatusLabel(_ status: String?) -> String {
        switch status {
        case "queued": "Accepted by mail server"
        case "pending": "Pending"
        case "delivered": "Delivered"
        case "rerouted": "Rerouted"
        case "failed": "Failed"
        case "suppressed": "Suppressed"
        case "unknown": "Unknown"
        default: "Not sent"
        }
    }

    private var resendButtonLabel: String {
        let failed = model.pickupReadiness?.emailStatus == "failed" || model.pickupReadiness?.emailStatus == "suppressed"
        return failed ? "Retry pickup email" : "Resend pickup email"
    }

    private var resendDialogTitle: String {
        let failed = model.pickupReadiness?.emailStatus == "failed" || model.pickupReadiness?.emailStatus == "suppressed"
        return failed ? "Retry the pickup-ready email?" : "Send another pickup-ready email?"
    }

    private func resendDialogMessage(for order: CommercePickingOrder) -> String {
        if model.pickupReadiness?.emailStatus == "unknown" {
            return "The customer may already have received the previous pickup email for \(order.number). Send another?"
        }
        return "Queues a new ready-for-pickup email for order \(order.number)."
    }
}
