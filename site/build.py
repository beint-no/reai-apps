#!/usr/bin/env python3
import argparse
import html
import json
import os
from pathlib import Path
import re
import shutil
import urllib.request

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--offline', action='store_true')
args = parser.parse_args()
apps = json.loads((root / 'apps.json').read_text())
releases = []
if not args.offline:
    headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'reai-apps-site'}
    if os.environ.get('GH_TOKEN'):
        headers['Authorization'] = 'Bearer ' + os.environ['GH_TOKEN']
    page = 1
    while True:
        request = urllib.request.Request(f'https://api.github.com/repos/beint-no/reai-apps/releases?per_page=100&page={page}', headers=headers)
        with urllib.request.urlopen(request, timeout=30) as response:
            batch = json.load(response)
        releases.extend(batch)
        if len(batch) < 100:
            break
        page += 1
source = (root / 'site' / 'index.html').read_text()
for app_id, app in apps.items():
    candidates = []
    for release in releases:
        match = re.fullmatch(re.escape(app_id) + r'/v(\d+)\.(\d+)\.(\d+)', release['tag_name'])
        if not match or release['draft'] or release['prerelease']:
            continue
        asset = next((a for a in release['assets'] if a['name'] == app['asset']), None)
        if app.get('platform') == 'windows' and not {app['arm64_asset'], 'SHA256SUMS'}.issubset({a['name'] for a in release['assets']}):
            continue
        if asset:
            candidates.append((tuple(map(int, match.groups())), release, asset))
    if candidates:
        version, release, asset = max(candidates, key=lambda entry: entry[0])
        label = 'Download for Windows (x64)' if app.get('platform') == 'windows' else 'Download for Mac'
        download = f'<a class="button primary" href="{html.escape(asset["browser_download_url"], quote=True)}">{label} <span aria-hidden="true">↓</span></a>'
        details = f'<a class="release-note" href="{html.escape(release["html_url"], quote=True)}">Version {".".join(map(str, version))} · Release notes ↗</a>'
        if app.get('platform') == 'windows':
            arm = next(a for a in release['assets'] if a['name'] == app['arm64_asset'])
            download = '<div class="download-actions">' + ''.join(
                f'<a class="button secondary" href="{html.escape(item["browser_download_url"], quote=True)}">Windows {architecture} <span aria-hidden="true">↓</span></a>'
                for architecture, item in [('x64', asset), ('ARM64', arm)]) + '</div>'
            details = '<span class="release-note">Unsigned · Windows may warn or block. <a href="#windows-install">Installation help</a></span>' + details
    else:
        label = 'Windows download coming soon' if app.get('platform') == 'windows' else 'Download coming soon'
        download = f'<span class="button unavailable">{label}</span>'
        message = 'Preparing the first unsigned Windows release.' if app.get('platform') == 'windows' else 'Preparing the first notarized release.'
        details = f'<span class="release-note">{message}</span>'
    source = source.replace('{{' + app_id + '.download}}', download).replace('{{' + app_id + '.version}}', details)
if '{{' in source:
    raise SystemExit('Unresolved site template field')
destination = root / 'dist' / 'site'
destination.mkdir(parents=True, exist_ok=True)
(destination / 'index.html').write_text(source)
shutil.copy2(root / 'site' / 'style.css', destination / 'style.css')
shutil.copytree(root / 'site' / 'assets', destination / 'assets', dirs_exist_ok=True)
(destination / '.nojekyll').touch()
print(f'Built {destination}')
