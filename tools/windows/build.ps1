param([ValidateSet('x64', 'ARM64')][string]$Architecture = 'x64')
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path "$PSScriptRoot/../..").Path
$rid = 'win-' + $Architecture.ToLowerInvariant()
$destination = "$root/dist/import-windows/$rid"
Push-Location "$root/windows"
try {
    dotnet publish import/ReAI.Import.csproj -c Release -p:Platform=$Architecture -r $rid --self-contained -o $destination
    if ($LASTEXITCODE -ne 0) { throw 'Windows build failed' }
    Copy-Item "$root/LICENSE" "$destination/LICENSE.txt"
    Copy-Item "$root/windows/import/README.md" "$destination/README.md"
    Compress-Archive -Path "$destination/*" -DestinationPath "$root/dist/import-windows/ReAI-Import-Windows-$Architecture.zip" -Force
} finally { Pop-Location }
