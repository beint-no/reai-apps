#!/usr/bin/env python3
import argparse
import base64
import json
import os
from pathlib import Path
import plistlib
import re
import secrets
import subprocess
import tempfile

from build import APPS, ROOT, checksum, configuration, output, run


def release(app_id, version):
    app = configuration(app_id, version)
    required = ['APPLE_SIGNING_CERTIFICATE', 'APPLE_SIGNING_PASSWORD', 'APPLE_NOTARY_KEY', 'APPLE_NOTARY_KEY_ID', 'APPLE_NOTARY_ISSUER', 'APPLE_TEAM_ID']
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        raise ValueError('Missing release credentials: ' + ', '.join(missing))
    if not re.fullmatch(r'[A-Z0-9]{10}', os.environ['APPLE_TEAM_ID']):
        raise ValueError('Invalid Apple team ID')
    destination = ROOT / 'dist' / app_id
    with tempfile.TemporaryDirectory(prefix='reai-release-') as temporary:
        work = Path(temporary)
        work.chmod(0o700)
        certificate = work / 'certificate.p12'
        certificate.write_bytes(base64.b64decode(os.environ['APPLE_SIGNING_CERTIFICATE'], validate=True))
        key = work / 'notary.p8'
        key.write_bytes(base64.b64decode(os.environ['APPLE_NOTARY_KEY'], validate=True))
        certificate.chmod(0o600)
        key.chmod(0o600)
        keychain = work / 'signing.keychain-db'
        password = secrets.token_urlsafe(32)
        run('security', 'create-keychain', '-p', password, keychain)
        try:
            run('security', 'set-keychain-settings', '-lut', '21600', keychain)
            run('security', 'unlock-keychain', '-p', password, keychain)
            run('security', 'import', certificate, '-P', os.environ['APPLE_SIGNING_PASSWORD'], '-k', keychain, '-T', '/usr/bin/codesign', capture_output=True)
            run('security', 'set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', password, keychain, capture_output=True)
            identities = output('security', 'find-identity', '-v', '-p', 'codesigning', keychain)
            pattern = r'([A-Fa-f0-9]{40}) "Developer ID Application: [^"\n]+ \(' + re.escape(os.environ['APPLE_TEAM_ID']) + r'\)"'
            matches = re.findall(pattern, identities)
            if len(matches) != 1:
                raise ValueError('Expected exactly one valid Developer ID Application identity for APPLE_TEAM_ID')
            identity = matches[0]
            staging = work / 'image'
            staging.mkdir()
            run('ditto', '-x', '-k', destination / 'unsigned.zip', staging)
            bundle = staging / (app['name'] + '.app')
            info = plistlib.loads((bundle / 'Contents' / 'Info.plist').read_bytes())
            if info['CFBundleIdentifier'] != app['bundle_id'] or info['CFBundleShortVersionString'] != version:
                raise ValueError('Built app identity or version does not match this release')
            binary = bundle / 'Contents' / 'MacOS' / app['executable']
            if output('lipo', '-archs', binary) != 'arm64':
                raise ValueError('Only Apple Silicon releases are supported')
            if any((bundle / 'Contents' / name).exists() for name in ['Frameworks', 'PlugIns', 'XPCServices']):
                raise ValueError('Embedded code needs explicit inside-out signing before adding this app')
            run('codesign', '--force', '--timestamp', '--options', 'runtime', '--sign', identity, '--keychain', keychain, bundle)
            run('codesign', '--verify', '--strict', '--verbose=2', bundle)
            (staging / 'Applications').symlink_to('/Applications')
            image = destination / app['asset']
            image.unlink(missing_ok=True)
            run('hdiutil', 'create', '-volname', app['name'], '-srcfolder', staging, '-fs', 'APFS', '-format', 'UDZO', image)
            run('codesign', '--force', '--timestamp', '--sign', identity, '--keychain', keychain, image)
            credentials = ['--key', key, '--key-id', os.environ['APPLE_NOTARY_KEY_ID'], '--issuer', os.environ['APPLE_NOTARY_ISSUER']]
            response = subprocess.run([str(value) for value in ['xcrun', 'notarytool', 'submit', image, *credentials, '--wait', '--timeout', '30m', '--output-format', 'json']], capture_output=True, text=True)
            (destination / 'notarization-output.txt').write_text(response.stdout + response.stderr)
            result = json.loads(response.stdout)
            (destination / 'notarization.json').write_text(json.dumps(result, indent=2) + '\n')
            if result.get('status') != 'Accepted':
                if result.get('id'):
                    run('xcrun', 'notarytool', 'log', result['id'], *credentials, destination / 'notarization-log.json')
                raise ValueError('Apple did not accept this release for notarization')
            run('xcrun', 'stapler', 'staple', image)
            run('xcrun', 'stapler', 'validate', image)
            run('spctl', '--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=2', image)
            checksum(image)
            print(f'Ready: {image}')
        finally:
            run('security', 'delete-keychain', keychain)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('app', choices=APPS)
    parser.add_argument('--version', required=True)
    args = parser.parse_args()
    release(args.app, args.version)
