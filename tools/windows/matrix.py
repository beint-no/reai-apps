#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.15"
# dependencies = []
# ///
import json
import os
from pathlib import Path
import re
import subprocess

root = Path(__file__).resolve().parents[2]
all_apps = json.loads((root / 'apps.json').read_text())
apps = {key: app for key, app in all_apps.items() if app.get('platform') == 'windows'}
selected = list(apps)
version = '0.0.0'
event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
if os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch':
    app = event.get('inputs', {}).get('app')
    if os.environ.get('GITHUB_REF') != 'refs/heads/main' or app not in apps:
        raise SystemExit('Choose a Windows app and the main branch to release')
    tags = subprocess.check_output(['git', 'tag', '--list', f'{app}/v*'], cwd=root, text=True).splitlines()
    versions = [tuple(map(int, match.groups())) for tag in tags
                if (match := re.fullmatch(re.escape(app) + r'/v(\d+)\.(\d+)\.(\d+)', tag))]
    major, minor, patch = max(versions, default=(0, 1, -1))
    version = f'{major}.{minor}.{patch + 1}'
    selected = [app]
else:
    base = event.get('pull_request', {}).get('base', {}).get('sha') or event.get('before')
    if base and set(base) != {'0'}:
        files = subprocess.check_output(['git', 'diff', '--name-only', base, 'HEAD'], cwd=root, text=True).splitlines()
        previous = subprocess.run(['git', 'show', f'{base}:apps.json'], cwd=root, text=True, capture_output=True)
        before = json.loads(previous.stdout) if previous.returncode == 0 else {}
        changed = {key for key, app in apps.items() if before.get(key) != app}
        shared = any(p in {'windows/global.json', '.github/workflows/windows.yml'} or p.startswith('tools/windows/') for p in files)
        selected = [key for key, app in apps.items() if shared or key in changed or any(p.startswith(app['path'] + '/') for p in files)]
if any(int(part) > 65535 for part in version.split('.')):
    raise SystemExit('Version exceeds Windows file-version limits')
matrix = {'include': [dict(app=app, version=version, architecture=arch) for app in selected for arch in ['x64', 'ARM64']]}
with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
    output.write('matrix=' + json.dumps(matrix, separators=(',', ':')) + '\n')
    output.write('has_apps=' + str(bool(selected)).lower() + '\n')
    output.write('app=' + (selected[0] if selected else '') + '\nversion=' + version + '\n')
