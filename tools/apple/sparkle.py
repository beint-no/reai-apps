import hashlib
import os
import shutil
import tarfile
import urllib.request

from build import run

SPARKLE_URL = 'https://github.com/sparkle-project/Sparkle/releases/download/2.10.0/Sparkle-2.10.0.tar.xz'
SPARKLE_SHA256 = 'c2bf58aa8387266ac179357b1415d6f2635f044da8be41042af32425dae6da0c'


def sign_framework(framework, identity, keychain=None):
    version = framework / 'Versions' / 'B'
    if not version.is_dir():
        raise ValueError('Missing Sparkle framework')
    credentials = ['--keychain', keychain] if keychain else []
    timestamp = ['--timestamp'] if identity != '-' else []
    for code in [version / 'Autoupdate', version / 'Updater.app',
                 version / 'XPCServices' / 'Downloader.xpc', version / 'XPCServices' / 'Installer.xpc', framework]:
        run('codesign', '--force', *timestamp, '--options', 'runtime', '--sign', identity, *credentials, code)
    run('codesign', '--verify', '--deep', '--strict', framework)


def generate_feed(image, version, work, app_id, key_secret):
    archive = work / 'Sparkle.tar.xz'
    with urllib.request.urlopen(SPARKLE_URL, timeout=60) as response:
        archive.write_bytes(response.read())
    if hashlib.sha256(archive.read_bytes()).hexdigest() != SPARKLE_SHA256:
        raise ValueError('Sparkle distribution checksum mismatch')
    distribution = work / 'sparkle'
    with tarfile.open(archive) as compressed:
        compressed.extractall(distribution, filter='data')
    key = work / 'sparkle-private-key'
    key.write_text(os.environ[key_secret])
    key.chmod(0o600)
    try:
        updates = work / 'updates'
        updates.mkdir()
        shutil.copy2(image, updates / image.name)
        feed = image.parent / f'{app_id}.xml'
        run(distribution / 'bin' / 'generate_appcast', '--ed-key-file', key,
            '--download-url-prefix', f'https://github.com/beint-no/reai-apps/releases/download/{app_id}/v{version}/',
            '--maximum-deltas', '0', '-o', feed, updates)
        run(distribution / 'bin' / 'sign_update', '--ed-key-file', key, '--verify', feed)
    finally:
        key.unlink(missing_ok=True)
