#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
APPS = json.loads((ROOT / 'apps.json').read_text())


def run(*args, **kwargs):
    result = subprocess.run([str(arg) for arg in args], **kwargs)
    if result.returncode:
        raise RuntimeError(f'{Path(args[0]).name} failed with exit code {result.returncode}')
    return result


def output(*args, **kwargs):
    return run(*args, capture_output=True, text=True, **kwargs).stdout.strip()


def configuration(app_id, version=None):
    app = APPS[app_id].copy()
    app['version'] = version or '0.0.0'
    app['build'] = os.environ.get('GITHUB_RUN_NUMBER', '1')
    if not re.fullmatch(r'\d+\.\d+\.\d+', app['version']):
        raise ValueError('Version must be major.minor.patch')
    return app


def checksum(path):
    (path.parent / 'SHA256SUMS').write_text(f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n')


def build(app_id, version=None):
    app = configuration(app_id, version)
    source = ROOT / app['path']
    swift = os.environ.get('SWIFT_BIN', 'swift')
    if not re.search(r'Swift version 6\.4(?:[ .]|$)', output(swift, '--version')):
        raise ValueError('Swift 6.4 is required; set SWIFT_BIN to its executable')
    run(swift, 'build', '-c', 'release', '--arch', 'arm64', cwd=source)
    binary_directory = Path(output(swift, 'build', '-c', 'release', '--arch', 'arm64', '--show-bin-path', cwd=source))
    destination = ROOT / 'dist' / app_id
    destination.mkdir(parents=True, exist_ok=True)
    bundle = destination / (app['name'] + '.app')
    if bundle.exists():
        shutil.rmtree(bundle)
    resources = bundle / 'Contents' / 'Resources'
    resources.mkdir(parents=True)
    (bundle / 'Contents' / 'MacOS').mkdir()
    binary = bundle / 'Contents' / 'MacOS' / app['executable']
    shutil.copy2(binary_directory / app['executable'], binary)
    for resource in binary_directory.glob('*.bundle'):
        shutil.copytree(resource, resources / resource.name)
    if (source / 'Resources').is_dir():
        shutil.copytree(source / 'Resources', resources, dirs_exist_ok=True)
    if output('lipo', '-archs', binary) != 'arm64':
        raise ValueError('Release executable must contain only arm64')
    info = plistlib.loads((source / 'Info.plist').read_bytes())
    if info['CFBundleIdentifier'] != app['bundle_id'] or info['CFBundleExecutable'] != app['executable']:
        raise ValueError('Bundle identity does not match apps.json')
    info['CFBundleShortVersionString'] = app['version']
    info['CFBundleVersion'] = app['build']
    (bundle / 'Contents' / 'Info.plist').write_bytes(plistlib.dumps(info))
    iconset = source / '.build' / 'AppIcon.iconset'
    iconset.mkdir(exist_ok=True)
    icon_tool = source / '.build' / 'make-icon'
    swiftc = str(Path(swift).with_name('swiftc')) if '/' in swift else 'swiftc'
    run(swiftc, source / app['icon'], '-sdk', output('xcrun', '--sdk', 'macosx', '--show-sdk-path'), '-o', icon_tool, '-framework', 'AppKit')
    run(icon_tool, iconset)
    run('iconutil', '-c', 'icns', iconset, '-o', resources / 'AppIcon.icns')
    run('codesign', '--force', '--options', 'runtime', '--sign', '-', bundle)
    run('codesign', '--verify', '--strict', bundle)
    archive = destination / 'unsigned.zip'
    archive.unlink(missing_ok=True)
    run('ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', bundle, archive)
    print(f'Built {bundle}')
    return bundle


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('app', choices=APPS)
    parser.add_argument('--version')
    args = parser.parse_args()
    build(args.app, args.version)
