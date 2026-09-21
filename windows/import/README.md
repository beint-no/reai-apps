# ReAI Import for Windows

Import products, customers and suppliers from Excel, CSV and TSV files.

Windows 11 25H2 or newer, x64 or ARM64. Native WinUI 3 interface. Windows-only; no cross-platform UI framework.

## Download

[Download for Windows](https://beint-no.github.io/reai-apps/#import) — x64 for Intel/AMD PCs, ARM64 for ARM-based PCs. Check **Settings → System → About → System type** if unsure.

1. Download the ZIP for your processor from the app’s GitHub release.
2. Right-click it → **Extract All**. Keep the entire extracted folder together.
3. Open **ReAI.Import.exe** from that folder.

The app is self-contained: no .NET installation, developer tools or administrator access is needed.

**Unsigned download.** Windows may show “Unknown publisher” or block it. If SmartScreen offers **More info → Run anyway**, you can choose it after confirming the download is from `beint-no/reai-apps` and you trust it. Smart App Control, S mode or workplace policy can block it with no per-app override. Keep Windows security protections enabled; this download cannot run on every locked-down PC.

The release includes `SHA256SUMS`. To check a download, run `Get-FileHash .\ReAI-Import-Windows-x64.zip -Algorithm SHA256` in PowerShell (use the ARM64 filename when applicable) and compare with the matching checksum. Checksums detect changed downloads; they are not a trusted publisher signature.

To update, close the app and extract the new release into a new folder. Your connection and saved app data remain in your Windows user profile. To uninstall, close the app and delete the extracted folder. Disconnect/revoke access and remove the local data described below if you also want to remove your connection and history.

[Windows security behavior](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions)

## Import

1. Click **Connect to ReAI**, compare the code in your browser, choose a company and approve.
2. Drop an `.xlsx`, `.csv` or `.tsv` file into the window, or click **Choose file**.
3. Choose products, customers or suppliers, the worksheet and header row. For products, choose the decimal separator. For contacts, choose the company/private-person default.
4. Review the automatic English/Norwegian column matches. Correct the mappings and ignore unwanted columns.
5. Click **Review import**. Select rows to see the prepared values, validation errors and duplicate matches. Exclude unwanted rows.
6. Confirm the company and import the ready rows. Export the CSV report when finished.

The first version uses create APIs, not update APIs. ReAI may reuse an existing company profile and fill missing address details.
Products use one product and one variant per row; product name, SKU and selling price are required. Prices exclude VAT.
Stock item defaults to yes. Use ReAI VAT codes, not percentages. Omitted VAT and revenue account use ReAI defaults.
Contacts default to Norway. Norwegian companies require valid organization numbers; private people must not have one.
Country codes are checked against the countries supported by ReAI before import.
An address requires both address line 1 and city. Phone numbers need their international +country prefix.

Matching is local, using column titles and conservative typo matching. Files are not uploaded to an AI service.
Duplicate checks use SKU for products, and contact number, name or email for customers/suppliers, including archived records.
ReAI remains responsible for permissions and validation. Existing-record checks cannot prevent every concurrent duplicate.

Up to 10 MB, 10,000 data rows, 100 columns and 30 worksheets; expanded workbooks up to 64 MB.
CSV supports UTF-8 and BOM-marked UTF-16. Paste Excel formulas as values and unmerge cells first.
Legacy `.xls`, encrypted workbooks, inventory imports, multiple variants, national identity numbers and nested contact persons are unsupported.

## Connection and recovery

Your password stays in the browser. The access key is stored in Windows Credential Locker and restricted to the company you approved.
Disconnect removes the key from this computer. Revoke access in your [ReAI profile](https://app.reai.no/user/profile#user-access-tokens).

The latest import and progress are saved in `%LOCALAPPDATA%\ReAI\Import`. They contain your prepared data and report, but no access key.
**Pause** finishes the current request first. Reopen the app and connect with the same account/company to continue unsent rows.
Interrupted requests become **Check ReAI**; rejected and uncertain rows are never retried automatically. Check the actual record before preparing another import for them.
Rejected rows do not stop the remaining ready rows. Unknown outcomes still pause the import for manual review.
**New import** removes the previous local report; export it first if needed. Already-created ReAI records remain there.

## Development

Tools checked 20 September 2026:

- [.NET SDK 11.0.100-rc.1.26425.128](https://dotnet.microsoft.com/en-us/download/dotnet/11.0), runtime 11.0.0-rc.1.26425.128 and C# 15.
- [Windows App SDK 2.5.1](https://www.nuget.org/packages/Microsoft.WindowsAppSDK/2.5.1), including WinUI 3.
- [Windows SDK Build Tools 10.0.28000.2705](https://www.nuget.org/packages/Microsoft.Windows.SDK.BuildTools/10.0.28000.2705).
- Windows SDK .NET reference package 10.0.26100.87, the latest stable reference package available for the .NET Windows target.

.NET 11 RC1 is the explicitly selected release candidate with Microsoft go-live support. Windows 11 25H2 is the minimum customer OS; no Windows 10 or x86 support.
The Windows SDK reference version is an API contract, not the app's minimum supported Windows release.

Write code on macOS; from `windows/`, run `dotnet build import/Core` to build the import logic.
WinUI compilation and execution require Windows. GitHub's **Windows apps** workflow builds x64 and ARM64.
On Windows, install the .NET SDK and run from the repository root:

```powershell
./tools/windows/build.ps1 -App import-windows -Architecture x64
./tools/windows/build.ps1 -App import-windows -Architecture ARM64
```

Build output is in `dist/import-windows`. It includes the .NET and Windows App SDK runtimes.

Windows dependencies use individual WinUI/runtime components, without unused AI/ML, widgets or search packages. All resolved NuGet packages were checked against their latest stable versions: WinUI 2.3.9, Runtime 2.5.1, Interactive Experiences 2.1.9, Foundation 2.3.12, Base 2.0.4, WebView2 1.0.4191.47, SDK Build Tools 10.0.28000.2705 and MSIX Build Tools 1.7.260903100.
