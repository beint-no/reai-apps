#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.15"
# dependencies = []
# ///
"""Compare compiler async and preview runtime async against the real Windows Core clients."""
import argparse
import json
import os
from pathlib import Path
import platform
import statistics
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def run(*args, **kwargs):
    return subprocess.run([str(arg) for arg in args], cwd=ROOT / 'windows', check=True, **kwargs)


def output(*args):
    return run(*args, capture_output=True, text=True).stdout.strip()


def compare(destination, iterations, pairs):
    destination.mkdir(mode=0o700, parents=True, exist_ok=False)
    dotnet = os.environ.get('DOTNET_BIN', 'dotnet')
    project = ROOT / 'tools/profiling/runtime-async/Profile.csproj'
    metadata = {'sdk': output(dotnet, '--version'), 'platform': platform.platform(), 'machine': platform.machine(),
                'commit': output('git', '-C', ROOT, 'rev-parse', 'HEAD'),
                'working_tree': output('git', '-C', ROOT, 'status', '--short')}
    for name, flag in [('baseline', 'off'), ('runtime', 'on')]:
        run(dotnet, 'build', project, '-c', 'Release', '--artifacts-path', destination / name,
            f'-p:Features=runtime-async={flag}')
    results = []
    for mode in ('completed', 'yield'):
        for pair in range(pairs):
            # Alternate ordering to reduce warm-up, thermal and background-load bias.
            for name in (('baseline', 'runtime') if pair % 2 == 0 else ('runtime', 'baseline')):
                binary = destination / name / 'bin/Profile/release/Profile.dll'
                result = json.loads(output(dotnet, binary, iterations, mode))
                if result['stateMachines'] != (name == 'baseline'):
                    raise RuntimeError('Async compiler flag did not take effect; do not use these measurements')
                result.update(variant=name, pair=pair)
                results.append(result)
    summary = []
    for mode in ('completed', 'yield'):
        for name in ('baseline', 'runtime'):
            values = [row for row in results if row['mode'] == mode and row['variant'] == name]
            row = {'mode': mode, 'variant': name, 'runs': pairs, 'iterations': iterations}
            row.update({key: statistics.median(value[key] for value in values)
                        for key in ('elapsedMs', 'cpuMs', 'bytesPerIteration')})
            summary.append(row)
            print(json.dumps(row), flush=True)
    (destination / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    (destination / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
    (destination / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True, help='New private directory outside the checkout')
    parser.add_argument('--iterations', type=int, default=100000, metavar='1..1000000')
    parser.add_argument('--pairs', type=int, default=5, metavar='3..20')
    args = parser.parse_args()
    if not 1 <= args.iterations <= 1000000 or not 3 <= args.pairs <= 20:
        parser.error('Choose 1..1000000 iterations and 3..20 pairs')
    destination = args.output.expanduser().resolve()
    if destination.is_relative_to(ROOT):
        parser.error('Keep profiling data outside the checkout')
    compare(destination, args.iterations, args.pairs)
