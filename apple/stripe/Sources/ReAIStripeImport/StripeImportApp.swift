import SwiftUI

@main struct StripeImportApp: App {
    @State private var model = ImportModel()
    var body: some Scene {
        Window("Stripe → ReAI", id: "stripe-import") {
            ImportView(model: model)
                .frame(minWidth: 700, minHeight: 620)
                .task { await model.start() }
        }
        .defaultSize(width: 880, height: 760)
    }
}

struct ImportView: View {
    @Bindable var model: ImportModel
    @State private var invoiceToConfirm: StripeInvoice?
    @State private var subscriptionToConfirm: StripeSubscription?
    @State private var tab = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Label("Stripe → ReAI", systemImage: "arrow.left.arrow.right").font(.title.bold())
                Spacer()
                if model.busy { ProgressView().controlSize(.small) }
                Button("Refresh") { model.refresh() }.disabled(model.busy || model.stripeAccount == nil)
            }
            Text("Choose what to move. Nothing runs in the background.").foregroundStyle(.secondary)
            connections
            if let error = model.error {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange).textSelection(.enabled)
            }
            if let notice = model.notice {
                Label(notice, systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green).textSelection(.enabled)
            }
            if model.truncated {
                Label("Showing the newest 500 records from each Stripe list. Older records require a later import version.", systemImage: "info.circle")
                    .foregroundStyle(.orange)
            }
            if model.account != nil && model.stripeAccount != nil {
                Picker("", selection: $tab) {
                    Text("Paid invoices (\(model.invoices.count))").tag(0)
                    Text("Subscriptions (\(model.subscriptions.count))").tag(1)
                }.pickerStyle(.segmented).labelsHidden()
                if tab == 0 { invoiceList } else { subscriptionList }
            } else {
                Spacer()
            }
            HStack {
                Link("Stripe key instructions", destination: URL(string: "https://docs.stripe.com/keys/restricted-api-keys")!)
                Spacer()
                Link("ReAI app access", destination: AppEnvironment.profile)
            }.font(.caption)
        }
        .padding(24)
        .confirmationDialog("Import this paid Stripe invoice?", isPresented: Binding(get: { invoiceToConfirm != nil }, set: { if !$0 { invoiceToConfirm = nil } })) {
            Button("Import into ReAI") {
                if let invoice = invoiceToConfirm { model.importInvoice(invoice) }
                invoiceToConfirm = nil
            }
            Button("Cancel", role: .cancel) { invoiceToConfirm = nil }
        } message: {
            Text("Creates a historical ReAI invoice and paid record. It makes no accounting postings, sends no invoice, and leaves Stripe unchanged.")
        }
        .confirmationDialog("Stage this Stripe subscription?", isPresented: Binding(get: { subscriptionToConfirm != nil }, set: { if !$0 { subscriptionToConfirm = nil } })) {
            Button("Stage in ReAI") {
                if let subscription = subscriptionToConfirm { model.stageSubscription(subscription) }
                subscriptionToConfirm = nil
            }
            Button("Cancel", role: .cancel) { subscriptionToConfirm = nil }
        } message: {
            Text("Creates a ReAI subscription with automatic billing off. It does not cancel Stripe, transfer payment methods, or collect money. Review terms before switching billing.")
        }
    }

    private var connections: some View {
        HStack(alignment: .top, spacing: 24) {
            GroupBox("Stripe") {
                VStack(alignment: .leading, spacing: 10) {
                    if let account = model.stripeAccount {
                        Text("Connected: \(account)").font(.callout).textSelection(.enabled)
                        Button("Remove key from this Mac") { model.disconnectStripe() }.font(.caption).disabled(model.busy)
                    } else {
                        SecureField("Paste restricted read key (rk_live_…)", text: $model.stripeInput)
                            .textFieldStyle(.roundedBorder)
                        Button("Connect Stripe") { model.saveStripeKey() }.disabled(model.busy || model.stripeInput.isEmpty)
                        Text("Create a restricted key in Stripe with read access to Account, Customers, Invoices and Subscriptions. Use a test key first. This key stays in Keychain on this Mac.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading).padding(6)
            }
            GroupBox("ReAI") {
                VStack(alignment: .leading, spacing: 10) {
                    if let account = model.account {
                        Picker("Company", selection: $model.selectedCompany) {
                            ForEach(account.tenants) { company in
                                Text("\(company.companyName) (\(company.currencyCode))").tag(company.id)
                            }
                        }.disabled(model.busy).onChange(of: model.selectedCompany) { _, _ in model.refresh() }
                        if !model.zeroVATProducts.isEmpty {
                            Picker("Zero-rate product", selection: $model.selectedProduct) {
                                ForEach(model.zeroVATProducts) { product in Text(product.title).tag(product.id) }
                            }.disabled(model.busy)
                        } else {
                            Text("Create a non-stock zero-rate product in ReAI before importing.")
                                .font(.caption).foregroundStyle(.orange)
                        }
                    } else {
                        Button("Connect to ReAI") { model.connectReAI() }.disabled(model.busy)
                        if !model.code.isEmpty {
                            Text("Compare this code in your browser: \(model.code)").font(.callout.monospaced()).textSelection(.enabled)
                        }
                        Text("Approve in your browser and choose a company. No ReAI app registration is needed.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading).padding(6)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var invoiceList: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Paid Stripe invoices").font(.headline)
            Text("Only simple, tax-free invoices can be imported. The selected product supplies the ReAI sales category; historical revenue and VAT are not posted again.")
                .font(.caption).foregroundStyle(.secondary)
            List(model.invoices) { invoice in
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(invoice.number ?? invoice.id).font(.body.weight(.medium))
                        Text("\(invoice.customer_email ?? "No customer email") · \(Dates.day(invoice.issuedAt))")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text("\(Double(invoice.total)/100, format: .number.precision(.fractionLength(2))) \(invoice.currency.uppercased())")
                        .monospacedDigit()
                    if let reason = model.invoiceReason(invoice) {
                        Text(reason).font(.caption).foregroundStyle(.secondary).frame(width: 180, alignment: .leading)
                    } else {
                        Button("Import") { invoiceToConfirm = invoice }.disabled(model.busy)
                    }
                }.padding(.vertical, 4)
            }
        }
    }

    private var subscriptionList: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Stripe subscriptions").font(.headline)
            Text("Staging creates a ReAI subscription with automatic billing off. Stripe remains the payment system until you complete a separate handover.")
                .font(.caption).foregroundStyle(.secondary)
            List(model.subscriptions) { subscription in
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(subscription.customer?.name ?? subscription.customer?.email ?? subscription.id)
                            .font(.body.weight(.medium))
                        Text("\(subscription.id) · \(subscription.status)").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if let item = subscription.items.data.first, let amount = item.price.unit_amount {
                        Text("\(Double(amount)/100, format: .number.precision(.fractionLength(2))) \(item.price.currency.uppercased())")
                            .monospacedDigit()
                    }
                    if let reason = model.subscriptionReason(subscription) {
                        Text(reason).font(.caption).foregroundStyle(.secondary).frame(width: 180, alignment: .leading)
                    } else {
                        Button("Stage") { subscriptionToConfirm = subscription }.disabled(model.busy)
                    }
                }.padding(.vertical, 4)
            }
        }
    }
}
