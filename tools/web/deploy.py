#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.15"
# dependencies = []
# ///
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / 'web'


def main() -> None:
    subprocess.run(['uv', 'run', '--script', str(ROOT / 'tools' / 'web' / 'build.py')], check=True)
    subprocess.run(['wrangler', 'deploy'], cwd=WEB, check=True)


if __name__ == '__main__':
    main()
