#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.15"
# dependencies = []
# ///
"""Record an isolated, synthetic workload using the real app views and models."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]


def run(*args, **kwargs):
    return subprocess.run([str(arg) for arg in args], check=True, **kwargs)


def output(*args):
    return run(*args, capture_output=True, text=True).stdout.strip()


def profile(app, destination, template):
    destination.mkdir(mode=0o700, parents=True, exist_ok=False)
    swift = os.environ.get('SWIFT_BIN', 'swift')
    version = (ROOT / '.swift-version').read_text().strip()
    swift_version = output(swift, '--version')
    if not re.search(r'Swift version ' + re.escape(version) + r'(?:[ .]|$)', swift_version):
        raise ValueError(f'Swift {version} is required; set SWIFT_BIN')
    app_id = 'product-labels' if app == 'labels' else 'import'
    target = 'ReAIProductLabels' if app == 'labels' else 'ReAIImport'
    original = ROOT / 'apple' / app_id
    package = destination / 'fixture'
    sources = package / 'Sources' / 'ReAIProfile'
    sources.mkdir(parents=True)
    entry = 'LabelsApp.swift' if app == 'labels' else 'ImportApp.swift'
    view = 'struct LabelsView:' if app == 'labels' else 'struct ImportView:'
    for source in (original / 'Sources' / target).glob('*.swift'):
        if source.name.endswith('Updater.swift'):
            continue
        text = source.read_text()
        if source.name == entry:
            # Use the actual view; replace only the app entry point and its startup task.
            text = 'import AppKit\nimport PDFKit\nimport SwiftUI\n\n' + text[text.index(view):]
        (sources / source.name).write_text(text)
    shutil.copy2(ROOT / 'tools/profiling' / f'{app.title()}Profile.swift', sources / 'ProfileApp.swift')
    lock = json.loads((original / 'Package.resolved').read_text())
    identity = 'swift-subprocess' if app == 'labels' else 'zipfoundation'
    pin = next(pin for pin in lock['pins'] if pin['identity'] == identity)
    dependency = f'.package(url: "{pin["location"]}", exact: "{pin["state"]["version"]}")'
    product = '.product(name: "Subprocess", package: "swift-subprocess")' if app == 'labels' else '.product(name: "ZIPFoundation", package: "ZIPFoundation")'
    resources = ''
    if app == 'labels':
        shutil.copytree(original / 'Sources' / target / 'Resources', sources / 'Resources')
        resources = ', resources: [.process("Resources")]'
    (package / 'Package.swift').write_text(f'''// swift-tools-version: 6.4
import PackageDescription
let package = Package(name: "ReAIProfile", defaultLocalization: "en", platforms: [.macOS(.v15)],
    products: [.executable(name: "ReAIProfile", targets: ["ReAIProfile"])],
    dependencies: [{dependency}],
    targets: [.executableTarget(name: "ReAIProfile", dependencies: [{product}]{resources})],
    swiftLanguageModes: [.v6])
''')
    run(swift, 'build', '--package-path', package, '-c', 'release', '--arch', 'arm64', '-Xswiftc', '-g')
    binaries = Path(output(swift, 'build', '--package-path', package, '-c', 'release', '--arch', 'arm64', '--show-bin-path'))
    bundle = destination / 'Synthetic Profile.app'
    executable = bundle / 'Contents/MacOS/ReAIProfile'
    executable.parent.mkdir(parents=True)
    shutil.copy2(binaries / 'ReAIProfile', executable)
    for resource in binaries.glob('*.bundle'):
        shutil.copytree(resource, bundle / 'Contents/Resources' / resource.name)
    (bundle / 'Contents/Info.plist').write_bytes(plistlib.dumps({
        'CFBundleIdentifier': f'no.reai.profiling.{app}', 'CFBundleExecutable': 'ReAIProfile',
        'CFBundleName': 'Synthetic Profile', 'CFBundlePackageType': 'APPL',
        'LSMinimumSystemVersion': '15.0', 'NSHighResolutionCapable': True,
    }))
    run('xcrun', 'dsymutil', executable, '-o', destination / 'ReAIProfile.dSYM')
    run('codesign', '--force', '--sign', '-', bundle)
    metadata = {
        'app': app_id, 'template': template, 'swift': swift_version,
        'macos': output('sw_vers', '-productVersion'), 'architecture': output('uname', '-m'),
        'commit': output('git', '-C', ROOT, 'rev-parse', 'HEAD'),
        'working_tree': output('git', '-C', ROOT, 'status', '--short'),
        'dependency': pin,
    }
    (destination / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    run('xcrun', 'xctrace', 'record', '--template', template, '--time-limit', '30s', '--no-prompt',
        '--output', destination / 'profile.trace', '--target-stdout', destination / 'workload.jsonl',
        '--env', f'REAI_PROFILE_DIR={destination}', '--launch', '--', executable)
    results = []
    for line in (destination / 'workload.jsonl').read_text().splitlines():
        if line.startswith('{'):
            try:
                result = json.loads(line)
            except json.JSONDecodeError:
                continue
            if 'workload' in result:
                results.append(result)
    expected = 6 if app == 'labels' else 1
    if len(results) != expected:
        raise RuntimeError('Synthetic workload did not finish; inspect workload.jsonl before using this recording')
    (destination / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
    run('xcrun', 'xctrace', 'export', '--input', destination / 'profile.trace', '--toc',
        '--output', destination / 'toc.xml')
    if template == 'SwiftUI':
        updates = destination / 'swiftui-updates.xml'
        run('xcrun', 'xctrace', 'export', '--input', destination / 'profile.trace',
            '--xpath', '/trace-toc/run[@number="1"]/data/table[@schema="swiftui-updates"]', '--output', updates)
        has_updates = False
        for _, element in ET.iterparse(updates):
            if element.tag == 'row':
                has_updates = True
                break
            element.clear()
        if not has_updates:
            print('WARNING: No SwiftUI update events. Inspect the Time Profiler lane; do not infer view-update counts.')
    print(f'Profile: {destination / "profile.trace"}')
    print(f'Workload results: {destination / "results.json"}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('app', choices=['labels', 'import'])
    parser.add_argument('--output', type=Path, required=True, help='New private directory outside the checkout')
    parser.add_argument('--template', choices=['SwiftUI', 'Time Profiler', 'Allocations'], default='SwiftUI')
    args = parser.parse_args()
    destination = args.output.expanduser().resolve()
    if destination.is_relative_to(ROOT):
        parser.error('Keep profiling data outside the checkout')
    profile(args.app, destination, args.template)
