param([ValidateSet('import-windows', 'time-tracker-windows')][string]$App = 'import-windows', [ValidateSet('x64', 'ARM64')][string]$Architecture = 'x64', [ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version = '0.0.0')
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path "$PSScriptRoot/../..").Path
$rid = 'win-' + $Architecture.ToLowerInvariant()
$manifest = (Get-Content "$root/apps.json" -Raw | ConvertFrom-Json).PSObject.Properties[$App].Value
$project = [IO.Path]::ChangeExtension($manifest.executable, '.csproj')
$projectPath = "$root/$($manifest.path)/$project"
$asset = if ($Architecture -eq 'ARM64') { $manifest.arm64_asset } else { $manifest.asset }
$destination = "$root/dist/$App/$rid"
Push-Location "$root/windows"
try {
    dotnet publish $projectPath -c Release -p:Version=$Version -p:FileVersion=$Version.0 -p:AssemblyVersion=$Version.0 -p:RestoreLockedMode=true -p:Platform=$Architecture -r $rid --self-contained -o $destination
    if ($LASTEXITCODE -ne 0) { throw 'Windows build failed' }
    $fileVersion = (Get-Item "$destination/$($manifest.executable)").VersionInfo.FileVersion
    if ($fileVersion -ne "$Version.0") { throw "Unexpected app version: $fileVersion" }
    if (-not (Test-Path "$destination/resources.pri")) {
        Get-ChildItem "$root/$($manifest.path)/bin", $destination -Recurse -Include *.pri,*.xbf | Select-Object FullName
        throw 'Published app is missing its XAML resources'
    }
    $notices = New-Item -ItemType Directory -Path "$destination/ThirdPartyNotices" -Force
    $packages = if ($env:NUGET_PACKAGES) { $env:NUGET_PACKAGES } else { "$env:USERPROFILE/.nuget/packages" }
    $lock = Get-Content "$root/$($manifest.path)/packages.lock.json" -Raw | ConvertFrom-Json
    $framework = $lock.dependencies.PSObject.Properties | Where-Object Name -NotMatch '/' | Select-Object -First 1
    foreach ($package in $framework.Value.PSObject.Properties) {
        if ($package.Value.type -eq 'Project') { continue }
        $packageRoot = "$packages/$($package.Name.ToLowerInvariant())/$($package.Value.resolved)"
        $files = Get-ChildItem $packageRoot -File -ErrorAction Stop | Where-Object { $_.Name -match '^(license|thirdparty|notice)' }
        foreach ($file in $files) { Copy-Item $file.FullName "$notices/$($package.Name)-$($file.Name)" }
    }
    $runtime = Get-Content "$destination/$([IO.Path]::ChangeExtension($manifest.executable, '.runtimeconfig.json'))" -Raw | ConvertFrom-Json
    $runtimeVersion = ($runtime.runtimeOptions.includedFrameworks | Where-Object name -eq 'Microsoft.NETCore.App').version
    Get-ChildItem "$packages/microsoft.netcore.app.runtime.$rid/$runtimeVersion" -File | Where-Object { $_.Name -match '^(license|thirdparty|notice)' } | ForEach-Object { Copy-Item $_.FullName "$notices/dotnet-$($_.Name)" }
    Copy-Item "$root/LICENSE" "$destination/LICENSE.txt"
    Copy-Item "$root/$($manifest.path)/README.md" "$destination/README.md"
    Compress-Archive -Path "$destination/*" -DestinationPath "$root/dist/$App/$asset" -Force
} finally { Pop-Location }
