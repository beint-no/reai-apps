---
title: "RecMan Staffing & Accounting Integration"
seoTitle: "RecMan Accounting Integration for ReAI — Invoices, PDF, KID & Payroll AGA"
description: "Connect RecMan to ReAI for free. Import issued staffing invoices and credit notes with original PDFs and KID numbers, and prepare draft payroll with automatic Kartverket AGA municipality resolution."
summary: "Book issued RecMan invoices & credit notes with original PDFs and KID, and prepare ReAI draft payroll with Kartverket workplace municipality (AGA zone) detection."
industry: operations
icon: icons/recman.svg
webAppUrl: /app/recman/
sourcePath: web/worker/apps/recman.js
highlights:
  - "Imports issued RecMan invoices & credit notes with original PDFs, KID (paymentReference), VAT and 3xxx accounts — without resending EHF or email"
  - "Resolves staffing workplace addresses through Kartverket to Norwegian municipality codes for differentiated AGA zones — holding multi-municipality paychecks for review"
  - "Quota-safe incremental RecMan API v2 fetches (minInvoiceId, minCreditNoteId, minPaycheckId, exported=0) with zero background polling"
---

## How RecMan integrates with ReAI for Norwegian staffing agencies

Staffing agencies (*bemanningsbyråer*) typically generate customer invoices, credit notes and payroll basis (*lønnsgrunnlag*) in **RecMan**, while running bookkeeping, MVA, payroll execution, A-melding and bank settlements in **ReAI**.

| Domain | RecMan API v2 scope | ReAI Public API target | Safety guardrails |
| --- | --- | --- | --- |
| **Customers** | `company` (`vatNumber`, `number`) | `GET/POST /api/customers` | Matches by Norwegian Mod11 org.nr, customer number or name |
| **Invoices & Credit Notes** | `invoice`, `creditNote`, `invoicePdf`, `creditNotePdf` | `POST /api/orders` + `POST /api/invoices/import` | Books with `accounting: "book"`, preserves KID & original PDF, `sendEhf: false`, `automaticRemindersEnabled: false` |
| **Workplace AGA Zones** | `paycheck` → `work` → `project` → `company.visitAddress` | Kartverket Address API (`kommunenummer`) | Holds paychecks spanning multiple municipalities for manual AGA verification |
| **Draft Payroll** | `candidate` (`isEmployee=1`), `paycheck` (`exported=0`) | `POST/PATCH /api/employees`, `POST /api/salary-payments`, `/wage-specs` | Creates editable draft only — never finalizes payroll, sends A-melding, or initiates bank payouts |

## Step-by-step setup

1. In RecMan, open **System settings → Database → API** and generate a **read-only (`SELECT`)** API key with access to *Companies*, *Projects*, *Work*, *Products*, *Invoices*, *Credit Notes*, *Paychecks* and *Candidates*.
2. Click **Open integration** above and connect your Norwegian (NOK) ReAI company.
3. Click **Test RecMan key** to confirm permissions, then scan **Invoices & Credit Notes** or **Paychecks & AGA Zones** using incremental ID watermarks (`minInvoiceId`, `minPaycheckId`) to keep daily RecMan API call counts minimal.
4. Review every VAT code, `3xxx` account, customer match, wage specification code (`hourly_salary`, `evening_supplement`, `night_supplement`, `weekend_supplement`, `public_holiday_supplement`, `irregular_non_worked_time_supplement`) and Kartverket municipality before confirming.
