#!/usr/bin/env python3
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import struct
import zipfile

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('app')
parser.add_argument('--version', required=True)
parser.add_argument('--directory', type=Path, required=True)
args = parser.parse_args()
app = json.loads((root / 'apps.json').read_text()).get(args.app)
if not app or app.get('platform') != 'windows' or not re.fullmatch(r'\d+\.\d+\.\d+', args.version):
    raise SystemExit('A Windows app and numeric release version are required')
checksums = []
for asset, machine in [(app['asset'], 0x8664), (app['arm64_asset'], 0xAA64)]:
    path = args.directory / asset
    with zipfile.ZipFile(path) as archive:
        if archive.testzip() is not None:
            raise SystemExit(f'Corrupt ZIP: {asset}')
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise SystemExit(f'Duplicate archive paths: {asset}')
        for name in names:
            normalized = name.replace('\\', '/')
            if PurePosixPath(normalized).is_absolute() or '..' in PurePosixPath(normalized).parts or ':' in normalized:
                raise SystemExit(f'Unsafe archive path: {asset}')
        required = [app['executable'], Path(app['executable']).with_suffix('.dll').name,
                    Path(app['executable']).with_suffix('.runtimeconfig.json').name,
                    'resources.pri', 'coreclr.dll', 'LICENSE.txt', 'README.md']
        if not all(name in names for name in required):
            raise SystemExit(f'Incomplete app archive: {asset}')
        binary = archive.read(app['executable'])
        if len(binary) < 64 or binary[:2] != b'MZ':
            raise SystemExit(f'Invalid Windows executable: {asset}')
        offset = struct.unpack_from('<I', binary, 0x3C)[0]
        if offset + 6 > len(binary) or binary[offset:offset + 4] != b'PE\0\0' or struct.unpack_from('<H', binary, offset + 4)[0] != machine:
            raise SystemExit(f'Wrong executable architecture: {asset}')
    checksums.append(hashlib.sha256(path.read_bytes()).hexdigest() + '  ' + asset)
(args.directory / 'SHA256SUMS').write_text('\n'.join(checksums) + '\n')
notes = f'''Windows 11 25H2 or newer. Choose **x64** for Intel/AMD PCs or **ARM64** for ARM-based PCs (check Settings → System → About → System type).

**Unsigned download.** Windows may show “Unknown publisher” or block this app. If SmartScreen offers **More info → Run anyway**, you can choose it after confirming that you downloaded this release from beint-no/reai-apps and trust it. Smart App Control, S mode, or workplace policy can prevent it from running; there may be no per-app override. Do not disable Windows security features to install it.

1. Download **{app['asset']}** or **{app['arm64_asset']}**.
2. Right-click the ZIP → **Extract All**. Keep the entire extracted folder together.
3. Open **{app['executable']}**. No .NET installation, build tools or administrator access is needed.
4. Click **Connect to ReAI**, compare the browser code, choose a company and approve.

To update, close the app and extract the new version into a new folder. Account keys and app data stay in your Windows user profile. To remove the app, close it and delete its extracted folder; see the app README for stored data and access revocation.

`SHA256SUMS` contains download checksums. These detect changed downloads; they are not a publisher signature or a way around Windows security policy.

Built from the main-branch source by GitHub Actions. .NET 11 RC1 is bundled. Native startup is checked on Windows x64; ARM64 is compiled and its archive checked, but not launched in CI.

[App instructions](https://github.com/beint-no/reai-apps/tree/main/{app['path']}) · [All apps](https://beint-no.github.io/reai-apps/)
'''
(args.directory / 'release-notes.md').write_text(notes)
print(f'Verified both archives for {args.app} {args.version}; wrote checksums and release notes')
