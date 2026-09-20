#!/usr/bin/env python3
import json
import os
import re
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[2]
apps = json.loads((root / 'apps.json').read_text())
ref = os.environ.get('GITHUB_REF', '')
event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
if ref.startswith('refs/tags/'):
    match = re.fullmatch(r'refs/tags/([a-z-]+)/v(\d+\.\d+\.\d+)', ref)
    if not match or match[1] not in apps or apps[match[1]]['version'] != match[2]:
        raise SystemExit('Release tag must match an app and its version in apps.json')
    subprocess.run(['git', 'merge-base', '--is-ancestor', 'HEAD', 'origin/main'], cwd=root, check=True)
    selected = [match[1]]
else:
    base = event.get('pull_request', {}).get('base', {}).get('sha') or event.get('before')
    if not base or set(base) == {'0'}:
        selected = list(apps)
    else:
        files = subprocess.check_output(['git', 'diff', '--name-only', base, 'HEAD'], cwd=root, text=True).splitlines()
        shared = any(p == 'apps.json' or p.startswith(('tools/apple/', '.github/actions/', '.github/workflows/apps.yml')) for p in files)
        selected = [key for key, app in apps.items() if shared or any(p.startswith(app['path'] + '/') for p in files)]
items = [dict(id=key, **apps[key]) for key in selected]
with open(os.environ['GITHUB_OUTPUT'], 'a') as result:
    result.write('matrix=' + json.dumps({'include': items}, separators=(',', ':')) + '\n')
    result.write('has_apps=' + str(bool(items)).lower() + '\n')
