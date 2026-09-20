#!/usr/bin/env python3
import json
import os
from pathlib import Path
import re
import subprocess

root = Path(__file__).resolve().parents[2]
apps = {key: app for key, app in json.loads((root / 'apps.json').read_text()).items() if app.get('platform') == 'windows'}
selected = list(apps)
version = '0.0.0'
if os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch':
    event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
    app = event.get('inputs', {}).get('app')
    if os.environ.get('GITHUB_REF') != 'refs/heads/main' or app not in apps:
        raise SystemExit('Choose a Windows app and the main branch to release')
    tags = subprocess.check_output(['git', 'tag', '--list', f'{app}/v*'], cwd=root, text=True).splitlines()
    versions = [tuple(map(int, match.groups())) for tag in tags
                if (match := re.fullmatch(re.escape(app) + r'/v(\d+)\.(\d+)\.(\d+)', tag))]
    major, minor, patch = max(versions, default=(0, 1, -1))
    version = f'{major}.{minor}.{patch + 1}'
    selected = [app]
if any(int(part) > 65535 for part in version.split('.')):
    raise SystemExit('Version exceeds Windows file-version limits')
matrix = {'include': [dict(app=app, version=version, architecture=arch) for app in selected for arch in ['x64', 'ARM64']]}
with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
    output.write('matrix=' + json.dumps(matrix, separators=(',', ':')) + '\n')
    output.write('app=' + selected[0] + '\nversion=' + version + '\n')
