#!/usr/bin/env python3
"""Switch the POS web root to verified, immutable release bytes."""
import argparse
import datetime
import fcntl
import filecmp
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
os.chdir(root)
parser = argparse.ArgumentParser()
parser.add_argument('environment', choices=['test', 'production'])
environment = parser.parse_args().environment
is_test = environment == 'test'
def run(*args):
    subprocess.run(args, check=True)
def git(*args):
    return subprocess.check_output(['git', *args], text=True).strip()
def switch(link, target):
    temporary = link.parent / ('.v5-static-' + str(os.getpid()))
    temporary.symlink_to(target, target_is_directory=True)
    os.replace(temporary, link)
def identical(source, release):
    def files(directory):
        return {p.relative_to(directory) for p in directory.rglob('*') if p.is_file()}
    names = files(source)
    return names == files(release) and all(filecmp.cmp(source / p, release / p, shallow=False) for p in names)

with open('/opt/backups/v5-pos-static-release.lock', 'w') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    run('python3', 'scripts/release-gate.py', '--verify')
    commit = git('rev-parse', 'HEAD')
    if not is_test:
        run('git', 'fetch', 'origin', 'main')
        if commit != git('rev-parse', 'origin/main'):
            raise SystemExit('Production requires the tested main commit')
    source = root / ('test-dist' if is_test else 'dist')
    link = Path('/opt/apps/customli-v5-test' if is_test else '/opt/apps/customli-v5-pos') / 'dist'
    releases = Path('/opt/apps/releases')
    release = releases / f'v5-pos-web-{environment}-{commit}'
    if not release.exists():
        with tempfile.TemporaryDirectory(dir=releases) as directory:
            staged = Path(directory) / 'web'
            shutil.copytree(source, staged)
            for entry in [staged, *staged.rglob('*')]:
                entry.chmod(0o755 if entry.is_dir() else 0o644)
            os.rename(staged, release)
    if not identical(source, release):
        raise SystemExit('Release directory differs from the attested build')
    if link.is_symlink():
        previous = link.resolve(strict=True)
    else:
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        previous = releases / f'v5-pos-web-before-{environment}-{stamp}'
        os.rename(link, previous)
    try:
        switch(link, release)
        run('node', 'qa/pos-layout-deployed.mjs', environment)
    except BaseException:
        switch(link, previous)
        raise
    shutil.copy2(root / 'qa/release-results/attestation.json', link.parent / 'POS_STATIC_RELEASE.json')
    print(f'{environment} served {commit}, rollback target {previous}')
