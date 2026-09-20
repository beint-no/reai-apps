#!/usr/bin/env python3
import json
import os
import re
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[2]
all_apps = json.loads((root / 'apps.json').read_text())
apps = {key: app for key, app in all_apps.items() if app.get('platform', 'apple') == 'apple'}
ref = os.environ.get('GITHUB_REF', '')
event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
version = '0.0.0'
if os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch':
    app_id = event.get('inputs', {}).get('app')
    if ref != 'refs/heads/main' or app_id not in apps:
        raise SystemExit('Choose a known app and the main branch to release')
    tags = subprocess.check_output(['git', 'tag', '--list', f'{app_id}/v*'], cwd=root, text=True).splitlines()
    versions = [tuple(map(int, match.groups())) for tag in tags
                if (match := re.fullmatch(re.escape(app_id) + r'/v(\d+)\.(\d+)\.(\d+)', tag))]
    major, minor, patch = max(versions, default=(0, 1, -1))
    version = f'{major}.{minor}.{patch + 1}'
    selected = [app_id]
elif ref.startswith('refs/tags/'):
    match = re.fullmatch(r'refs/tags/([a-z-]+)/v(\d+\.\d+\.\d+)', ref)
    if not match or match[1] not in all_apps:
        raise SystemExit('Release tag must use a known app and major.minor.patch version')
    subprocess.run(['git', 'merge-base', '--is-ancestor', 'HEAD', 'origin/main'], cwd=root, check=True)
    selected = [match[1]] if match[1] in apps else []
    version = match[2]
else:
    base = event.get('pull_request', {}).get('base', {}).get('sha') or event.get('before')
    if not base or set(base) == {'0'}:
        selected = list(apps)
    else:
        files = subprocess.check_output(['git', 'diff', '--name-only', base, 'HEAD'], cwd=root, text=True).splitlines()
        shared = any(p == 'apps.json' or p.startswith(('tools/apple/', '.github/actions/', '.github/workflows/apps.yml')) for p in files)
        selected = [key for key, app in apps.items() if shared or any(p.startswith(app['path'] + '/') for p in files)]
items = [dict(id=key, version=version, **apps[key]) for key in selected]
with open(os.environ['GITHUB_OUTPUT'], 'a') as result:
    result.write('matrix=' + json.dumps({'include': items}, separators=(',', ':')) + '\n')
    result.write('has_apps=' + str(bool(items)).lower() + '\n')
