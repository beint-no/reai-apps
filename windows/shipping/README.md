# ReAI Shipping for Windows

Ship orders and print labels from a native Windows app. Connect to ReAI, choose an order, review its parcel and shipping price, then click **Ship & print**. ReAI books the carrier, handles payment capture where required, and records shipping, stock and fulfillment. The PC prints one copy of the resulting label. It works like [Shipping for Mac](../../apple/shipping).

Native WinUI 3, Windows 11 25H2+, x64 or ARM64.

## Download

[Download for Windows](https://beint-no.github.io/reai-apps/#shipping) — x64 for Intel/AMD PCs, ARM64 for ARM-based PCs. Check **Settings → System → About → System type** if unsure.

1. Download the ZIP for your processor from the app’s GitHub release.
2. Right-click it → **Extract All**. Keep the entire extracted folder together.
3. Open **ReAI.Shipping.exe** from that folder.

The app is self-contained: no .NET installation, developer tools or administrator access is needed.

**Unsigned download.** Windows may show “Unknown publisher” or block it. If SmartScreen offers **More info → Run anyway**, you can choose it after confirming the download is from `beint-no/reai-apps` and you trust it. Smart App Control, S mode or workplace policy can block it with no per-app override. Keep Windows security protections enabled; this download cannot run on every locked-down PC.

The release includes `SHA256SUMS`. To check a download, run `Get-FileHash .\ReAI-Shipping-Windows-x64.zip -Algorithm SHA256` in PowerShell (use the ARM64 filename when applicable) and compare with the matching checksum. Checksums detect changed downloads; they are not a trusted publisher signature.

To update, close the app and extract the new release into a new folder. Your connection, unresolved shipping requests and print receipts remain in your Windows user profile. To uninstall, close the app and delete the extracted folder. Disconnect/revoke access and remove the local data described below if you also want to remove your connection and history.

[Windows security behavior](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions)

## Ship and print

1. Add your Zebra under **Settings → Bluetooth & devices → Printers & scanners**, with its Windows driver and the loaded label size set in the driver. The app chooses a single Zebra automatically; choose a printer if several are installed.
2. **Connect to ReAI**, compare the code in your browser, choose a company and approve. Your user needs invoice read/write permission and shipping enabled.
3. Select an order. Existing checkout parcels use their agreed snapshot. Other orders get recipient, item, weight and parcel defaults; check the actual package, choose a service/pickup and review the price. The last service choice is remembered.
4. Click **Ship & print**. Labels use the carrier PDF's own page size, including common 100/102 × 150/192 mm formats; load matching stock. There is no print dialog.

**Ready to ship** shows orders from the last 14 days; check **Include older orders** for all dates. **History** browses orders with saved shipments, or finds any order by number, ID or full ReAI order link. **Print label** there sends another copy of the existing label and never books a new shipment.

When a separate customs invoice exists, **Open customs invoice in ReAI (A4)** opens ReAI's PDF viewer for normal browser printing. Full-page A4 / Letter labels need a matching office printer and are rejected on a detected Zebra rather than reduced onto label stock. PDFs with mixed or unsupported page sizes are printed manually from ReAI.

## Location labels

**Locations** lists the warehouses, zones and locations of the connected company. Choose a location to preview its QR label, pick the size that matches the loaded roll (60 × 40, 80 × 50 or 100 × 50 mm) and click **Print label**. One location per label, at actual size. Printing a location label never changes stock or creates a shipment.

## Recovery and privacy

Shipping requests are saved before sending. If interrupted, use **Resume safely**: the app looks up the original request/shipment, continues confirmed preparation, and polls pending progress for up to two minutes. It never creates a replacement merely because a response was lost. A definitively rejected request can be reviewed and priced again after the app checks that no shipment exists. **Cancel preparation** releases an unbooked manual parcel so it can be edited.

**Sent to the printer queue** means Windows accepted the job. Check that queue if the printer is offline or out of stock. Print receipts prevent automatic duplicate copies across restarts; printing again requires confirmation and only downloads the existing label.

The access key stays in Windows Credential Locker and is bound to the approved company. Requests go only to `https://app.reai.no`, with redirects blocked. `%LOCALAPPDATA%\ReAI\Shipping\shipping.json` holds unresolved request IDs and proposals (including delivery details until the shipment exists), print receipts and your printer, service and label-size choices; no access key. Keep it to preserve recovery and duplicate protection. If it cannot be read, shipping and printing pause instead of starting over.

Disconnect removes the local key; revoke server access in your [ReAI profile](https://app.reai.no/user/profile#user-access-tokens).

## Development

The SDK is pinned in [global.json](../global.json); this app’s [project](ReAI.Shipping.csproj) and lockfile record its Windows dependencies.

On macOS, build the app-local logic from `windows/`: `dotnet build shipping/Core`. WinUI and printing require Windows. CI builds both architectures and checks native startup.

```powershell
./tools/windows/build.ps1 -App shipping-windows -Architecture x64
```

API: `/api/me`, `/api/orders/shipping-ready`, `/api/orders`, `/api/orders/{id}/shipping-options`, `shipping-rates`, `shipping-quote`, `/api/shipments` (create, read, `book`, `cancel`, `label`, `by-request-id`) and `/api/warehouses` (`locations`, `zones`). Authentication uses the registration-free device flow with `shipping-windows`. ReAI owns booking, accounting and permissions.
