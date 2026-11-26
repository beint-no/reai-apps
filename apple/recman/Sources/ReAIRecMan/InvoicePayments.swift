import Foundation

struct InvoiceBankMatch: Equatable {
    let bankID: Int
    let bankName: String
    let transactionID: Int
    let date: String
    let amount: Decimal
    let reference: String
    let existingInvoiceID: Int?
    let existingPostingID: Int?

    var detail: String {
        "Bank match · \(bankName) · \(date) · NOK \(amount) · transaction #\(transactionID)"
    }
}

struct InvoicePaymentReview {
    var matches: [String: InvoiceBankMatch] = [:]
    var issues: [String: String] = [:]
}

@MainActor
struct InvoicePayments {
    let target: AccountingTarget

    private struct Bank: Decodable, Sendable {
        let id: Int
        let currencyCode: String
        let manual: Bool
        let eligibleForPaymentCreation: Bool
    }

    private struct Transaction: Decodable, Equatable, Sendable {
        let id: Int
        let amount: Decimal
        let currencyCode: String
        let transactionDate: String
        let paymentReference: String?
        let status: String
        let voucherId: Int?
    }

    private struct Posting: Decodable, Sendable {
        let id: Int
        let voucherId: Int?
        let postingDate: String
        let amount: Decimal
        let currencyAmount: Decimal
    }

    private struct Overview: Decodable, Sendable {
        struct Group: Decodable, Sendable {
            let transactions: [Transaction]
        }

        let bankAccountId: Int
        let bankAccountName: String
        let month: String
        let bankCurrency: String
        let tenantCurrency: String
        let reconciliationLocked: Bool
        let pendingTransactions: [Transaction]
        let pendingPostings: [Posting]
        let matchedGroups: [Group]

        var transactions: [Transaction] { pendingTransactions + matchedGroups.flatMap(\.transactions) }
    }

    private struct Payment: Decodable, Sendable {
        let id: Int
        let invoiceId: Int
        let companyBankId: Int?
        let voucherId: Int?
        let date: String
        let paidAmount: Decimal
        let receivedAmount: Decimal
        let companyCurrencyCode: String
        let invoiceCurrencyCode: String
    }

    private struct RegisteredPayment: Decodable, Sendable {
        let paymentId: Int
        let voucherId: Int?
    }

    private struct Reconciliation: Decodable, Sendable {
        let bankAccountId: Int
        let success: Bool
        let reconciledPostingIds: [Int]
        let reconciledTransactionIds: [Int]
    }

    func review(_ documents: [RecManInvoice], journal: Journal) async throws -> InvoicePaymentReview {
        let paid = documents.filter(\.needsBankMatch)
        let now = osloDate(.now)
        let searchable = paid.filter {
            $0.bankReference != nil && $0.total > 0 && $0.total <= Decimal(string: "99999999.99")! &&
                roundedMoney($0.total) == $0.total && $0.date <= now
        }
        var review = InvoicePaymentReview()
        for document in paid {
            review.issues[document.key] = "Paid in RecMan. A valid KID, payment amount, and invoice date are required to find the bank receipt."
        }
        guard let firstDate = searchable.map(\.date).min() else { return review }

        let banks: [Bank] = try await target.read("/api/company-banks")
        let eligible = banks.filter { !$0.manual && $0.currencyCode == "NOK" }
        var overviews: [(bank: Bank, overview: Overview, transactions: [Transaction])] = []
        let references = Set(searchable.compactMap(\.bankReference))
        for month in months(from: firstDate, through: now) {
            for bank in eligible {
                let overview = try await readOverview(bank.id, month: month)
                let transactions = overview.transactions.filter { transaction in
                    transaction.paymentReference.flatMap(normalizedIdentity).map(references.contains) == true
                }
                if !transactions.isEmpty { overviews.append((bank, overview, transactions)) }
            }
        }

        for document in searchable {
            guard let reference = document.bankReference else { continue }
            do {
                let candidates = overviews.flatMap { item in
                    item.transactions.filter { matches($0, document: document, through: now) }
                        .map { (item.bank, item.overview, $0) }
                }
                guard let (bank, overview, transaction) = candidates.first, candidates.count == 1 else {
                    throw appError(candidates.isEmpty
                        ? "Paid in RecMan. No incoming bank transaction matches this KID and amount."
                        : "Paid in RecMan. Multiple bank transactions match this KID and amount.")
                }
                guard searchable.count(where: { matches(transaction, document: $0, through: now) }) == 1 else {
                    throw appError("Paid in RecMan. More than one invoice matches this bank transaction.")
                }
                guard bank.eligibleForPaymentCreation, !overview.reconciliationLocked,
                      transaction.status == "pending", transaction.voucherId == nil else {
                    throw appError("Paid in RecMan. The matching transaction is already booked or its bank reconciliation is unavailable.")
                }

                let invoiceID = journal.result(for: document.key)
                let postingID = try await existingPosting(document, invoiceID: invoiceID, transaction: transaction, overview: overview)
                review.matches[document.key] = InvoiceBankMatch(
                    bankID: bank.id, bankName: overview.bankAccountName, transactionID: transaction.id,
                    date: transaction.transactionDate, amount: transaction.amount,
                    reference: reference, existingInvoiceID: invoiceID, existingPostingID: postingID
                )
                review.issues[document.key] = nil
            } catch {
                try Task.checkCancellation()
                review.issues[document.key] = error.localizedDescription
            }
        }
        return review
    }

    func reconcile(_ match: InvoiceBankMatch, document: RecManInvoice, invoiceID: Int, journal: Journal) async throws {
        let month = String(match.date.prefix(7))
        var overview = try await readOverview(match.bankID, month: month)
        let transaction = try pendingTransaction(match, invoiceDate: document.date, in: overview)
        let existing = try await existingPosting(document, invoiceID: invoiceID, transaction: transaction, overview: overview)
        guard existing == match.existingPostingID else {
            throw appError("The invoice payment changed in ReAI. Reload the preview.")
        }

        let postingID: Int
        if let existing {
            postingID = existing
        } else {
            let endpoint = "/api/invoices/\(invoiceID)/payments"
            let registered: RegisteredPayment = try await target.write(
                endpoint, fields: ["companyBankId": match.bankID, "paymentDate": match.date,
                                   "receivedAmount": decimalJSON(match.amount), "expectedOutstanding": decimalJSON(match.amount)],
                key: "invoice-payment-\(document.key)", journal: journal
            )
            let payments: [Payment] = try await target.read(endpoint)
            guard registered.paymentId > 0, let voucherID = registered.voucherId, voucherID > 0,
                  payments.count == 1, let payment = payments.first, payment.id == registered.paymentId,
                  payment.voucherId == voucherID, matches(payment, invoiceID: invoiceID, match: match) else {
                throw appError("ReAI did not verify the registered invoice receipt.")
            }
            try journal.complete("invoice-payment-\(document.key)", id: registered.paymentId)

            overview = try await readOverview(match.bankID, month: month)
            _ = try pendingTransaction(match, invoiceDate: document.date, in: overview)
            postingID = try bankPosting(for: voucherID, match: match, overview: overview)
        }

        let result: Reconciliation = try await target.write(
            "/api/bank-reconciliations/\(match.bankID)/matches",
            fields: ["transactionIds": [match.transactionID], "postingIds": [postingID]],
            key: document.bankMatchReceipt, journal: journal
        )
        guard result.success, result.bankAccountId == match.bankID,
              result.reconciledPostingIds == [postingID], result.reconciledTransactionIds == [match.transactionID] else {
            throw appError("ReAI did not verify the bank reconciliation. Check the invoice and bank transaction in ReAI.")
        }
        try journal.complete(document.bankMatchReceipt, id: match.transactionID)
    }

    private func readOverview(_ bankID: Int, month: String) async throws -> Overview {
        let overview: Overview = try await target.read("/api/bank-reconciliations/\(bankID)", query: [
            URLQueryItem(name: "month", value: month)
        ])
        guard overview.bankAccountId == bankID, overview.month == month,
              overview.bankCurrency == "NOK", overview.tenantCurrency == "NOK" else {
            throw appError("ReAI returned unexpected bank reconciliation details.")
        }
        return overview
    }

    private func months(from firstDate: String, through lastDate: String) -> [String] {
        let first = firstDate.split(separator: "-").prefix(2).compactMap { Int($0) }
        let last = lastDate.split(separator: "-").prefix(2).compactMap { Int($0) }
        guard first.count == 2, last.count == 2, first[0] <= last[0] else { return [] }
        return (first[0]...last[0]).flatMap { year in
            let lower = year == first[0] ? first[1] : 1
            let upper = year == last[0] ? last[1] : 12
            return (lower...upper).map { String(format: "%04d-%02d", year, $0) }
        }
    }

    private func matches(_ transaction: Transaction, document: RecManInvoice, through date: String) -> Bool {
        transaction.id > 0 && transaction.currencyCode == "NOK" && transaction.amount == document.total &&
            normalizedIdentity(transaction.paymentReference) == document.bankReference &&
            accountingDate(transaction.transactionDate) && transaction.transactionDate >= document.date &&
            transaction.transactionDate <= date
    }

    private func matches(_ payment: Payment, invoiceID: Int, match: InvoiceBankMatch) -> Bool {
        payment.invoiceId == invoiceID && payment.companyBankId == match.bankID && payment.date == match.date &&
            payment.paidAmount == match.amount && payment.receivedAmount == match.amount &&
            payment.companyCurrencyCode == "NOK" && payment.invoiceCurrencyCode == "NOK"
    }

    private func pendingTransaction(_ match: InvoiceBankMatch, invoiceDate: String, in overview: Overview) throws -> Transaction {
        let candidates = overview.transactions.filter {
            normalizedIdentity($0.paymentReference) == match.reference && $0.amount == match.amount &&
                $0.currencyCode == "NOK" && $0.transactionDate >= invoiceDate && $0.transactionDate <= osloDate(.now)
        }
        guard !overview.reconciliationLocked, candidates.count == 1, let transaction = candidates.first,
              transaction.id == match.transactionID, transaction.transactionDate == match.date,
              transaction.status == "pending", transaction.voucherId == nil else {
            throw appError("The bank match changed in ReAI. Reload the preview.")
        }
        return transaction
    }

    private func existingPosting(_ document: RecManInvoice, invoiceID: Int?, transaction: Transaction,
                                 overview: Overview) async throws -> Int? {
        if let invoiceID {
            let invoice: InvoiceResult = try await target.read("/api/invoices/\(invoiceID)")
            guard invoice.id == invoiceID, invoice.importSource == "recman",
                  invoice.importSourceInstance == "department-\(document.departmentId)", invoice.externalId == document.key,
                  invoice.number == String(document.number), invoice.issueDate == document.date, !invoice.creditNote,
                  invoice.voucherId != nil, invoice.currencyCode == "NOK", invoice.totalAmount == transaction.amount,
                  normalizedIdentity(invoice.paymentReference) == document.bankReference else {
                throw appError("The booked invoice differs from the RecMan record. Review it in ReAI.")
            }
            let payments: [Payment] = try await target.read("/api/invoices/\(invoiceID)/payments")
            if !payments.isEmpty {
                guard let reference = document.bankReference else { throw appError("The RecMan invoice has no valid KID.") }
                let match = InvoiceBankMatch(bankID: overview.bankAccountId, bankName: overview.bankAccountName,
                                             transactionID: transaction.id, date: transaction.transactionDate,
                                             amount: transaction.amount, reference: reference,
                                             existingInvoiceID: invoiceID, existingPostingID: nil)
                guard invoice.outstanding == 0, payments.count == 1, let payment = payments.first, let voucherID = payment.voucherId,
                      matches(payment, invoiceID: invoiceID, match: match) else {
                    throw appError("The invoice already has payment activity that needs review in ReAI.")
                }
                return try bankPosting(for: voucherID, match: match, overview: overview)
            }
            guard invoice.outstanding == transaction.amount else {
                throw appError("The invoice outstanding balance differs from the bank receipt. Review it in ReAI.")
            }
        }

        guard !overview.pendingPostings.contains(where: {
            $0.amount == transaction.amount || $0.currencyAmount == transaction.amount
        }) else {
            throw appError("A bank posting for this amount already exists. Verify which invoice it belongs to in ReAI.")
        }
        return nil
    }

    private func bankPosting(for voucherID: Int, match: InvoiceBankMatch, overview: Overview) throws -> Int {
        let postings = overview.pendingPostings.filter { $0.voucherId == voucherID }
        guard postings.count == 1, let posting = postings.first, posting.id > 0,
              posting.postingDate == match.date, posting.amount == match.amount, posting.currencyAmount == match.amount else {
            throw appError("The payment voucher has no unique matching bank posting. Review it in ReAI.")
        }
        return posting.id
    }
}
