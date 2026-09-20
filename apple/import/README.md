# ReAI Import

Import products, customers and suppliers from Excel (`.xlsx`), CSV or TSV into one ReAI company.

## Install

[Download for Mac](https://beint-no.github.io/reai-apps/#import). Apple Silicon (M1 or newer), macOS 15+.
Open the disk image, drag **ReAI Import** to **Applications**, then open it. Published downloads are signed and notarized by Apple.

## Import

1. Click **Connect to ReAI**. Compare the code in your browser, choose a company, and approve. Your account needs read and write access for the record type.
2. Choose **Products**, **Customers** or **Suppliers**, then drop a file or use **Choose file**. A blank CSV template is available in the app.
3. Select the worksheet and header row. English and Norwegian headings are matched locally, including common abbreviations and small spelling mistakes. Review every match, change it if needed, and leave unwanted columns as **Do not import**.
4. Check the decimal separator for products, or the default contact type for customers/suppliers.
5. Click **Review import**. Existing active/archived records and repeated file rows are checked by SKU (products), or contact number, name and email (contacts). Matches are skipped, never overwritten. Organization-number-only matches are not detected by this pre-check; ReAI still validates each creation.
6. Inspect the preview. Select a row to see its prepared values or exclude it. Invalid rows are excluded. Click **Import rows**, verify the company in the confirmation, and create the records.
7. **Export report** saves source row numbers, results, ReAI IDs and errors. Correct invalid rows in your source file and start another import.

Each product row creates one product with one variant. Product name, SKU and selling price are required; prices exclude VAT.
Stock item defaults to Yes. Missing VAT and revenue-account fields use ReAI defaults. Use ReAI VAT **codes**, not percentages; inventory and multi-variant grouping are not imported.

Contact country defaults to `NO`; Norwegian companies require a valid organization number. Use **Private person** for individuals.
Names have a 75-character limit. Phone numbers need `+country code`. Addresses need both address line 1 and city.
Customer imports also support invoice email, payment terms in days and invoices in English. Registry lookup is skipped so supplied values are used.
National identity numbers and contact-person lists are not imported.

## Files and limits

- Up to 10 MB, 10,000 data rows and 100 columns; Excel workbooks may contain up to 30 sheets / 64 MB expanded data.
- CSV delimiter detection supports comma, semicolon and tab, quoted multiline cells, UTF-8, UTF-16 and Windows-1252.
- Excel formulas are never evaluated. For workbooks containing formulas, paste values into a new workbook or export CSV. Unmerge cells first. Password-protected workbooks and `.xls` are unsupported.
- Store identifiers as text in Excel to preserve leading zeros and long numbers. Simple zero-padded Excel number formats are preserved. Excel numeric cells use a dot decimal separator; other display formatting is not reproduced.
- Files and column matching stay on your Mac. Only confirmed records and normal API reads go to ReAI; no external AI service receives the file.

## Interrupted imports

Pause stops after the current request. Completed rows are saved locally; reopening the app restores the last report.
Reconnect with the same account/company to continue only unsent rows. A failed or interrupted request is never automatically retried: check **Check ReAI** and **Rejected** rows in ReAI before including them in another import.
The API does not provide an idempotency key for these create endpoints, so the app cannot guarantee exactly-once creation after a lost response or concurrent imports.
A new import replaces the local report; export it first if you need to retain it. Completed records are not automatically rolled back.

The last report, including prepared row data, is stored with owner-only permissions in `~/Library/Application Support/ReAI Import/last-import.json` and its `.progress` file. Row progress is appended and flushed before each request, so large imports do not rewrite the entire file for every row.
**New import** removes that report. The access token is stored separately in macOS Keychain; disconnect to remove it from this Mac, or revoke access in your [ReAI profile](https://app.reai.no/user/profile#user-access-tokens).

## Development

From the repository root: `python3 tools/apple/build.py import`. Swift 6.4, SwiftUI, arm64, macOS 15+.
ZIPFoundation 0.9.20 handles bounded in-memory Excel ZIP decompression; Foundation parses the worksheet XML. The dependency is pinned in `Package.resolved`.
See the shared [release instructions](../../tools/apple/README.md). No local Apple signing credentials are needed to publish through GitHub.
