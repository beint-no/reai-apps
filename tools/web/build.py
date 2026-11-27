#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.15"
# dependencies = []
# ///
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / 'web'
LEGACY_RASTER_EXTS = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'}


def fetch_releases() -> list[dict]:
    headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'reai-apps-web'}
    if os.environ.get('GH_TOKEN'):
        headers['Authorization'] = 'Bearer ' + os.environ['GH_TOKEN']
    releases: list[dict] = []
    page = 1
    while True:
        req = urllib.request.Request(
            f'https://api.github.com/repos/beint-no/reai-apps/releases?per_page=100&page={page}',
            headers=headers,
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            batch = json.load(resp)
        releases.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    return releases


def sync_releases(offline: bool) -> None:
    apps = json.loads((ROOT / 'apps.json').read_text())
    releases = [] if offline else fetch_releases()
    data: dict[str, dict[str, str]] = {}

    for app_id, app in apps.items():
        if app.get('platform') == 'web':
            continue
        candidates = []
        for release in releases:
            match = re.fullmatch(re.escape(app_id) + r'/v(\d+)\.(\d+)\.(\d+)', release['tag_name'])
            if not match or release['draft'] or release['prerelease']:
                continue
            asset = next((a for a in release['assets'] if a['name'] == app['asset']), None)
            if app.get('platform') == 'windows' and not {app['arm64_asset'], 'SHA256SUMS'}.issubset(
                {a['name'] for a in release['assets']}
            ):
                continue
            if asset:
                candidates.append((tuple(map(int, match.groups())), release, asset))

        if candidates:
            version, release, asset = max(candidates, key=lambda entry: entry[0])
            entry = {
                'version': '.'.join(map(str, version)),
                'url': asset['browser_download_url'],
                'releaseUrl': release['html_url'],
            }
            if app.get('platform') == 'windows':
                arm = next(a for a in release['assets'] if a['name'] == app['arm64_asset'])
                entry['arm64Url'] = arm['browser_download_url']
            data[app_id] = entry
        else:
            fallback = 'https://github.com/beint-no/reai-apps/releases'
            entry = {'version': 'offline' if offline else 'latest', 'url': fallback, 'releaseUrl': fallback}
            if app.get('platform') == 'windows':
                entry['arm64Url'] = fallback
            data[app_id] = entry

    target = WEB / 'data' / 'releases.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(data, indent=2) + '\n')


def check_no_legacy_images() -> None:
    bad = []
    for folder in (WEB / 'assets', WEB / 'apps'):
        if not folder.exists():
            continue
        for path in folder.rglob('*'):
            if path.is_file() and path.suffix.lower() in LEGACY_RASTER_EXTS:
                bad.append(str(path.relative_to(ROOT)))
    if bad:
        raise SystemExit(f'Legacy raster images found in web/ (use AVIF or SVG): {", ".join(bad)}')


def copy_app_assets() -> None:
    src = WEB / 'apps' / 'shared'
    dst = WEB / 'public' / 'app' / 'shared'
    if dst.exists():
        shutil.rmtree(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(src, dst)


def main() -> None:
    parser = argparse.ArgumentParser(description='Build apps.reai.no static site and Worker assets.')
    parser.add_argument('--offline', action='store_true', help='Skip fetching GitHub releases.')
    parser.add_argument('--skip-typecheck', action='store_true', help='Skip JSDoc tsc check.')
    args = parser.parse_args()

    check_no_legacy_images()
    sync_releases(offline=args.offline)
    subprocess.run(['lyn', 'build', str(WEB)], check=True)
    copy_app_assets()
    if not args.skip_typecheck:
        subprocess.run(['npm', 'run', 'typecheck'], cwd=WEB, check=True)
    print(f'Built {WEB / "public"}')


if __name__ == '__main__':
    main()
