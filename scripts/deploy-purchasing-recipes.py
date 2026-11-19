#!/usr/bin/env python3
"""Deploy the verified purchasing/recipe release without changing KDS or auth configuration."""
import argparse
import datetime
import fcntl
import json
import os
import pathlib
import shutil
import sqlite3
import subprocess
import time
import urllib.error
import urllib.request

POS = pathlib.Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('environment', choices=('test', 'production'))
parser.add_argument('--dashboard', type=pathlib.Path, required=True)
args = parser.parse_args()
test = args.environment == 'test'
dashboard = args.dashboard.resolve()
target = pathlib.Path('/opt/apps/customli-v5-test' if test else '/opt/apps/customli-v5-pos')
dashboard_target = pathlib.Path('/opt/apps/customli-v5-dashboard') / ('dist' if test else 'prod-dist')
data = pathlib.Path('/var/lib/customli-v5-test' if test else '/var/lib/customli-v5') / 'pos.sqlite'
service = 'customli-v5-test' if test else 'customli-v5-api'
port = 4396 if test else 4395
prefix = '/v5-test' if test else '/v5'

def run(*command):
    subprocess.run(command, check=True)

def git(root, *command):
    return subprocess.check_output(('git', '-C', str(root), *command), text=True).strip()

def snapshot(db):
    with sqlite3.connect('file:' + str(db) + '?mode=ro', uri=True) as connection:
        return {
            'orders': connection.execute('SELECT count(*),coalesce(sum(total),0),coalesce(sum(refund_total),0) FROM orders').fetchone(),
            'lines': connection.execute('SELECT count(*),coalesce(sum(price*quantity),0) FROM order_items').fetchone(),
            'shifts': connection.execute('SELECT count(*),sum(closed_at IS NULL) FROM shifts').fetchone(),
            'snapshots': connection.execute("SELECT count(*),coalesce(sum(per_item_cost_minor),0) FROM order_item_cost_snapshots").fetchone(),
        }

def db_backup(destination):
    with sqlite3.connect('file:' + str(data) + '?mode=ro', uri=True) as src, sqlite3.connect(destination) as dst:
        src.backup(dst)
        assert dst.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'

def swap_link(path, release):
    temporary = path.with_name(path.name + '.next')
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(release)
    if path.exists() and not path.is_symlink():
        path.rename(path.with_name(path.name + '.previous'))
    temporary.replace(path)

with open('/opt/backups/v5-purchasing-recipes-release.lock', 'w') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    run('python3', str(POS / 'scripts/release-gate.py'), '--verify')
    assert not git(POS, 'status', '--porcelain'), 'POS source must be clean'
    assert not git(dashboard, 'status', '--porcelain'), 'Dashboard source must be clean'
    if not test:
        run('git', '-C', str(POS), 'fetch', 'origin', 'main')
        run('git', '-C', str(dashboard), 'fetch', 'origin', 'main')
        assert git(POS, 'rev-parse', 'HEAD') == git(POS, 'rev-parse', 'origin/main'), 'POS must be merged main'
        assert git(dashboard, 'rev-parse', 'HEAD') == git(dashboard, 'rev-parse', 'origin/main'), 'Dashboard must be merged main'
    pos_build = POS / ('test-dist' if test else 'dist')
    dash_build = dashboard / 'customli-v5-dashboard' / ('dist' if test else 'prod-dist')
    assert (pos_build / 'index.html').is_file() and (dash_build / 'index.html').is_file(), 'Builds are missing'
    before = snapshot(data)
    if not test and before['shifts'][1]:
        raise SystemExit('Production shift is open; deployment not started.')
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup = pathlib.Path('/opt/backups') / f'v5-purchasing-{args.environment}-{stamp}'
    backup.mkdir(mode=0o700)
    shutil.copytree(target, backup / 'app', symlinks=True)
    db_backup(backup / 'pos.sqlite')
    prior_dashboard = dashboard_target.resolve() if dashboard_target.is_symlink() else None
    if prior_dashboard is None:
        shutil.copytree(dashboard_target, backup / 'dashboard-dist')
    (backup / 'before.json').write_text(json.dumps({'pos': git(POS, 'rev-parse', 'HEAD'), 'dashboard': git(dashboard, 'rev-parse', 'HEAD'), 'financial': before, 'priorDashboard': str(prior_dashboard) if prior_dashboard else None}, indent=2))
    pos_release = pathlib.Path('/opt/apps/releases') / f'v5-pos-purchasing-{args.environment}-{stamp}-{git(POS, "rev-parse", "--short", "HEAD")}'
    dash_release = pathlib.Path('/opt/apps/releases') / f'v5-dashboard-purchasing-{args.environment}-{stamp}-{git(dashboard, "rev-parse", "--short", "HEAD")}'
    shutil.copytree(pos_build, pos_release)
    shutil.copytree(dash_build, dash_release)
    # Migrate a separate copy using the exact release source before stopping the service.
    dry_dir = backup / 'migration-dry-run'
    dry_dir.mkdir()
    shutil.copy2(backup / 'pos.sqlite', dry_dir / 'pos.sqlite')
    migration = "import{DatabaseSync}from'node:sqlite';import{migrateFoodModel}from'./food-model.mjs';import{migratePurchasing}from'./purchasing.mjs';import{migrateRecipeCosting}from'./recipe-costing.mjs';const db=new DatabaseSync(process.argv[1]);db.exec('PRAGMA foreign_keys=ON');migrateFoodModel(db);migratePurchasing(db);migrateRecipeCosting(db);if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Foreign key failure');db.close()"
    run('node', '--input-type=module', '-e', migration, str(dry_dir / 'pos.sqlite'))
    stopped = False
    try:
        run('systemctl', 'stop', service)
        stopped = True
        if not test and snapshot(data)['shifts'][1]:
            raise RuntimeError('Production shift opened during backup')
        run('rsync', '-a', '--no-perms', '--exclude=node_modules', '--exclude=.git', '--exclude=/dist', '--exclude=/test-dist', '--exclude=/android-dist', '--exclude=/qa/release-results', str(POS) + '/', str(target) + '/')
        swap_link(target / 'dist', pos_release)
        swap_link(dashboard_target, dash_release)
        run('systemctl', 'start', service)
        ready = False
        for _ in range(40):
            try:
                urllib.request.urlopen(f'http://127.0.0.1:{port}{prefix}/api/health', timeout=2)
                ready = True
                break
            except urllib.error.HTTPError as error:
                if error.code == 401:
                    ready = True
                    break
            except OSError:
                pass
            time.sleep(.25)
        if not ready or snapshot(data) != before:
            raise RuntimeError('API health or financial records changed')
        with sqlite3.connect(data) as connection:
            assert connection.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
            assert not connection.execute('PRAGMA foreign_key_check').fetchall()
            for table in ('purchasing_suppliers', 'purchasing_price_history', 'recipe_cost_lines', 'recipe_menu_links'):
                assert connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone()
        (backup / 'after.json').write_text(json.dumps({'financial': snapshot(data)}, indent=2))
        (target / 'PURCHASING_RECIPE_RELEASE.json').write_text(json.dumps({'pos': git(POS, 'rev-parse', 'HEAD'), 'dashboard': git(dashboard, 'rev-parse', 'HEAD'), 'backup': str(backup)}, indent=2))
        print(json.dumps({'deployed': args.environment, 'backup': str(backup), 'pos': git(POS, 'rev-parse', 'HEAD'), 'dashboard': git(dashboard, 'rev-parse', 'HEAD'), 'financial': before}))
    except Exception:
        if stopped:
            run('systemctl', 'stop', service)
            run('rsync', '-a', '--delete', str(backup / 'app') + '/', str(target) + '/')
            if prior_dashboard:
                swap_link(dashboard_target, prior_dashboard)
            else:
                if dashboard_target.is_symlink(): dashboard_target.unlink()
                shutil.copytree(backup / 'dashboard-dist', dashboard_target, dirs_exist_ok=True)
            shutil.copy2(backup / 'pos.sqlite', data)
            for suffix in ('-wal', '-shm'):
                pathlib.Path(str(data) + suffix).unlink(missing_ok=True)
            run('systemctl', 'start', service)
        raise
