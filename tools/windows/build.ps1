param([ValidateSet('x64', 'ARM64')][string]$Architecture = 'x64')
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path "$PSScriptRoot/../..").Path
$rid = 'win-' + $Architecture.ToLowerInvariant()
$app = (Get-Content "$root/apps.json" -Raw | ConvertFrom-Json).'import-windows'
$asset = if ($Architecture -eq 'ARM64') { $app.arm64_asset } else { $app.asset }
$destination = "$root/dist/import-windows/$rid"
Push-Location "$root/windows"
try {
    dotnet publish import/ReAI.Import.csproj -c Release -p:RestoreLockedMode=true -p:Platform=$Architecture -r $rid --self-contained -o $destination
    if ($LASTEXITCODE -ne 0) { throw 'Windows build failed' }
    if (-not (Test-Path "$destination/resources.pri")) { throw 'Published app is missing its XAML resources' }
    $notices = New-Item -ItemType Directory -Path "$destination/ThirdPartyNotices" -Force
    $packages = if ($env:NUGET_PACKAGES) { $env:NUGET_PACKAGES } else { "$env:USERPROFILE/.nuget/packages" }
    $lock = Get-Content "$root/windows/import/packages.lock.json" -Raw | ConvertFrom-Json
    $framework = $lock.dependencies.PSObject.Properties | Where-Object Name -NotMatch '/' | Select-Object -First 1
    foreach ($package in $framework.Value.PSObject.Properties) {
        if ($package.Value.type -eq 'Project') { continue }
        $packageRoot = "$packages/$($package.Name.ToLowerInvariant())/$($package.Value.resolved)"
        $files = Get-ChildItem $packageRoot -File -ErrorAction Stop | Where-Object { $_.Name -match '^(license|thirdparty|notice)' }
        foreach ($file in $files) { Copy-Item $file.FullName "$notices/$($package.Name)-$($file.Name)" }
    }
    $runtime = Get-Content "$destination/ReAI.Import.runtimeconfig.json" -Raw | ConvertFrom-Json
    $runtimeVersion = ($runtime.runtimeOptions.includedFrameworks | Where-Object name -eq 'Microsoft.NETCore.App').version
    Get-ChildItem "$packages/microsoft.netcore.app.runtime.$rid/$runtimeVersion" -File | Where-Object { $_.Name -match '^(license|thirdparty|notice)' } | ForEach-Object { Copy-Item $_.FullName "$notices/dotnet-$($_.Name)" }
    Copy-Item "$root/LICENSE" "$destination/LICENSE.txt"
    Copy-Item "$root/windows/import/README.md" "$destination/README.md"
    Compress-Archive -Path "$destination/*" -DestinationPath "$root/dist/import-windows/$asset" -Force
} finally { Pop-Location }
