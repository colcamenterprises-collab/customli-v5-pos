#!/usr/bin/env python3
"""Deploy the verified V5 print candidate without changing financial records."""
import argparse, pathlib, subprocess, sqlite3, json, time, urllib.request, urllib.error, datetime, shutil
p=argparse.ArgumentParser();p.add_argument('environment',choices=['test','production']);p.add_argument('--source',default='/opt/work/receipt-studio');a=p.parse_args();test=a.environment=='test';source=pathlib.Path(a.source);target=pathlib.Path('/opt/apps/customli-v5-test' if test else '/opt/apps/customli-v5-pos');data=pathlib.Path('/var/lib/customli-v5-test' if test else '/var/lib/customli-v5');kds=pathlib.Path('/opt/apps/customli-v5-kds-test' if test else '/opt/apps/customli-v5-kds');kdsdata=pathlib.Path('/var/lib/customli-v5-kds-test' if test else '/var/lib/customli-v5-kds');service='customli-v5-test' if test else 'customli-v5-api';publisher='customli-v5-kds-test-publisher' if test else 'customli-v5-kds-publisher';dash=pathlib.Path('/opt/apps/customli-v5-dashboard');stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ');backup=pathlib.Path('/opt/backups')/('v5-print-'+a.environment+'-'+stamp);backup.mkdir(mode=0o700)
def run(*args):subprocess.run(args,check=True)
def stats():
 with sqlite3.connect('file:'+str(data/'pos.sqlite')+'?mode=ro',uri=True) as c:
  return {'orders':c.execute('select count(*),coalesce(sum(total),0),coalesce(sum(discount_total),0),coalesce(sum(refund_total),0) from orders').fetchone(),'lines':c.execute('select count(*),coalesce(sum(price*quantity),0),coalesce(sum(quantity),0) from order_items').fetchone(),'shifts':c.execute('select count(*),sum(closed_at is null) from shifts').fetchone(),'refunds':c.execute('select count(*),coalesce(sum(amount),0) from refunds').fetchone()}
def backup_db(src,name):
 with sqlite3.connect('file:'+str(src)+'?mode=ro',uri=True) as c,sqlite3.connect(backup/name) as dest:
  c.backup(dest);assert dest.execute('pragma integrity_check').fetchone()[0]=='ok'
# Gate must pass before backups, database access for deployment, or stopping services.
run('python3',str(source/'pos/scripts/release-gate.py'),'--verify')
before=stats();
if not test and before['shifts'][1]:raise SystemExit('Production shift is open. Deployment not started.')
run('rsync','-a','--exclude=node_modules','--exclude=.git',str(target)+'/',str(backup/'pos-source')+'/');run('rsync','-a',str(dash/('dist' if test else 'prod-dist'))+'/',str(backup/'dashboard-dist')+'/');shutil.copy2(kds/'kds-order-bridge.mjs',backup/'kds-order-bridge.mjs')
dropin=pathlib.Path('/etc/systemd/system')/(service+'.service.d')/'print-studio.conf';dropin.parent.mkdir(exist_ok=True);old_dropin=dropin.read_text() if dropin.exists() else None
run('systemctl','stop',publisher,service)
try:
 before=stats()
 if not test and before['shifts'][1]:raise RuntimeError('Production shift opened; release cancelled.')
 backup_db(data/'pos.sqlite','pos.sqlite');backup_db(kdsdata/'kds.sqlite','kds.sqlite');(backup/'before.json').write_text(json.dumps(before,indent=2))
 run('rsync','-a','--exclude=.git','--exclude=/dist','--exclude=/qa/print-results',str(source/'pos')+'/',str(target)+'/')
 build=source/'pos'/('test-dist' if test else 'dist');run('rsync','-a','--exclude=index.html',str(build)+'/',str(target/'dist')+'/');shutil.copy2(build/'index.html',target/'dist'/'index.html')
 dashbuild=source/'dashboard'/'customli-v5-dashboard'/('dist' if test else 'prod-dist');dashdest=dash/('dist' if test else 'prod-dist');run('rsync','-a','--exclude=index.html',str(dashbuild)+'/',str(dashdest)+'/');shutil.copy2(dashbuild/'index.html',dashdest/'index.html')
 shutil.copy2(source/'dashboard'/'customli-v5-kds'/'kds-order-bridge.mjs',kds/'kds-order-bridge.mjs')
 dropin.write_text('[Service]\nEnvironment=V5_DATA_DIR='+str(data)+'\nEnvironment=V5_API_PREFIX='+('/v5-test/api' if test else '/v5/api')+'\nEnvironment=V5_PRINT_KDS_DB='+str(kdsdata/'kds.sqlite')+'\nEnvironment=V5_PRINT_KDS_TENANT='+('customli-v5-test' if test else 'customli-v5-prod')+'\n')
 run('systemctl','daemon-reload');run('systemctl','start',service,publisher)
 url='http://127.0.0.1:'+('4396/v5-test' if test else '4395/v5')+'/api/health';ready=False
 for _ in range(40):
  try:urllib.request.urlopen(url,timeout=2);ready=True;break
  except urllib.error.HTTPError as e:
   if e.code==401:ready=True;break
  except OSError:pass
  time.sleep(.25)
 if not ready:raise RuntimeError('API did not restart')
 after=stats()
 if before!=after:raise RuntimeError('Financial record counts changed during release')
 with sqlite3.connect(data/'pos.sqlite') as c:assert c.execute('pragma integrity_check').fetchone()[0]=='ok';assert c.execute('select count(*) from receipt_templates').fetchone()[0]>=7
 (backup/'after.json').write_text(json.dumps(after,indent=2));print(json.dumps({'deployed':a.environment,'backup':str(backup),'preserved':after}))
except Exception:
 run('systemctl','stop',service,publisher);run('rsync','-a',str(backup/'pos-source')+'/',str(target)+'/');run('rsync','-a',str(backup/'dashboard-dist')+'/',str(dash/('dist' if test else 'prod-dist'))+'/');shutil.copy2(backup/'kds-order-bridge.mjs',kds/'kds-order-bridge.mjs')
 if old_dropin is None:dropin.unlink(missing_ok=True)
 else:dropin.write_text(old_dropin)
 run('systemctl','daemon-reload');run('systemctl','start',service,publisher);raise
