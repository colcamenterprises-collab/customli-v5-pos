#!/usr/bin/env python3
"""Extend the existing attested release with additive identity/KDS device support.

No database restore is automated. On failure restore source/configuration only,
preserving any writes made after the backup. Backups remain available for review.
"""
import argparse,datetime,json,os,fcntl,pathlib,shutil,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
p=argparse.ArgumentParser();p.add_argument('environment',choices=['test','production']);p.add_argument('--source',required=True);a=p.parse_args()
lock=open('/opt/backups/v5-universal-deployment.lock','w');fcntl.flock(lock,fcntl.LOCK_EX)
source=pathlib.Path(a.source).resolve();production=a.environment=='production';pos=source/'pos';dashboard=source/'dashboard';stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
def run(*args,**kwargs):return subprocess.run(args,check=True,**kwargs)
run('python3',str(pos/'scripts/release-gate.py'),'--verify')
if production:
 for root in [pos,dashboard]:
  run('git','-C',str(root),'fetch','origin','main')
  if subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'])!=subprocess.check_output(['git','-C',str(root),'rev-parse','origin/main']):raise SystemExit('Production requires both merged main commits')
if subprocess.check_output(['git','-C',str(dashboard),'status','--porcelain']):raise SystemExit('Dashboard source must be clean')
backup=pathlib.Path('/opt/backups')/('universal-'+a.environment+'-'+stamp);backup.mkdir(mode=0o700)
apiunit='customli-v5-api' if production else 'customli-v5-test';kdsunit='customli-v5-kds' if production else 'customli-v5-kds-test'
def environment(unit):
 pid=subprocess.check_output(['systemctl','show',unit,'-p','MainPID','--value'],text=True).strip()
 return dict(x.split('=',1) for x in pathlib.Path('/proc',pid,'environ').read_text().split('\0') if '=' in x)
apiEnv=environment(apiunit);authEnv=environment('customli-v5-auth');kdsEnv=environment(kdsunit)
tenant=apiEnv.get('PLATFORM_TENANT_ID');data=pathlib.Path(apiEnv['V5_DATA_DIR']);kddata=pathlib.Path(kdsEnv['KDS_DATA_DIR']);authdata=pathlib.Path(authEnv['PLATFORM_AUTH_DATA_DIR'])
if not tenant:raise SystemExit('Missing explicit tenant binding')
def dbcopy(src,dest):
 with sqlite3.connect('file:'+str(src)+'?mode=ro',uri=True) as c,sqlite3.connect(dest) as d:
  c.backup(d)
  if d.execute('pragma integrity_check').fetchone()[0]!='ok':raise RuntimeError('Backup integrity failed')
def financials():
 with sqlite3.connect('file:'+str(data/'pos.sqlite')+'?mode=ro',uri=True) as c:
  return {table:c.execute(query).fetchall() for table,query in {'orders':'select count(*),sum(total),sum(discount_total),sum(refund_total) from orders','refunds':'select count(*),sum(amount) from refunds','items':'select count(*),sum(price*quantity) from order_items'}.items()}
with sqlite3.connect('file:'+str(data/'pos.sqlite')+'?mode=ro',uri=True) as c:
 loc=c.execute('select id from print_location').fetchone()[0]
 if production and c.execute('select count(*) from shifts where closed_at is null').fetchone()[0]:raise SystemExit('Close the authorized test shift before production deployment')
with sqlite3.connect('file:'+str(authdata/'identity.sqlite')+'?mode=ro',uri=True) as c:
 name=c.execute('select name from tenants where id=?',(tenant,)).fetchone()
 if not name:raise SystemExit('Configured tenant is missing from authoritative identity service')
locations=[{'id':loc,'tenantId':tenant,'name':name[0]}]
for src,name in [(data/'pos.sqlite','pos.sqlite'),(kddata/'kds.sqlite','kds.sqlite'),(authdata/'identity.sqlite','identity.sqlite')]:dbcopy(src,backup/name)
before=financials();(backup/'before.json').write_text(json.dumps(before))
# Validate identity/KDS additive migrations against backup copies before service changes.
def validate(entry,env,port,dbfile):
 with tempfile.TemporaryDirectory(prefix='customli-migration-') as td:
  shutil.copy2(backup/dbfile,pathlib.Path(td)/dbfile)
  env={**env,'PLATFORM_AUTH_PORT':str(port),'PORT':str(port),'PLATFORM_AUTH_DATA_DIR':td,'KDS_DATA_DIR':td,'PLATFORM_LOCATIONS_JSON':json.dumps(locations)}
  with open(backup/('validation-'+dbfile+'.log'),'w') as log:
   child=subprocess.Popen(['node',str(entry)],env=env,stdout=log,stderr=log)
   try:
    ready=False
    for _ in range(60):
     if child.poll() is not None:raise RuntimeError('Migration startup failed; see protected validation log')
     try:urllib.request.urlopen('http://127.0.0.1:'+str(port)+'/health',timeout=1);ready=True;break
     except urllib.error.HTTPError as e:
      if e.code in [401,404]:ready=True;break
     except OSError:pass
     time.sleep(.1)
    if not ready:raise RuntimeError('Migration validation timed out')
   finally:child.terminate();child.wait(timeout=10)
  with sqlite3.connect(pathlib.Path(td)/dbfile) as c:
   if c.execute('pragma integrity_check').fetchone()[0]!='ok' or c.execute('pragma foreign_key_check').fetchall():raise RuntimeError('Migration integrity failed')
validate(dashboard/'customli-v5-dashboard/auth-server.mjs',authEnv,4488,'identity.sqlite')
validate(dashboard/'customli-v5-kds/server.mjs',kdsEnv,4489,'kds.sqlite')
targets={'auth':pathlib.Path('/opt/apps/customli-v5-auth'),'kds':pathlib.Path('/opt/apps')/kdsunit}
for name,target in targets.items():run('rsync','-a','--exclude=node_modules','--exclude=.git',str(target)+'/',str(backup/name)+'/')
configs=[]
def config(unit,content):
 directory=pathlib.Path('/etc/systemd/system')/(unit+'.service.d');directory.mkdir(exist_ok=True)
 file=directory/'universal.conf';configs.append((file,file.read_bytes() if file.exists() else None));file.write_text('[Service]\n'+content)
try:
 # Existing release program performs its own verified backups and rollback.
 run('python3',str(pos/'scripts/deploy-print-studio.py'),a.environment,'--source',str(source))
 run('python3',str(pos/'scripts/deploy-pos-static.py'),a.environment)
 config(apiunit,'Environment=PLATFORM_LOCATION_ID='+loc+'\n')
 # Reuse the already configured introspection service secret without logging it.
 envfile=pathlib.Path('/etc')/('customli-'+kdsunit+'-universal.env');configs.append((envfile,envfile.read_bytes() if envfile.exists() else None))
 envfile.write_text('PLATFORM_AUTH_SERVICE_SECRET='+json.dumps(apiEnv['PLATFORM_AUTH_SERVICE_SECRET'])+'\n');envfile.chmod(0o600)
 config(kdsunit,'EnvironmentFile='+str(envfile)+'\nEnvironment=PLATFORM_AUTH_INTROSPECT_URL='+apiEnv['PLATFORM_AUTH_INTROSPECT_URL']+'\nEnvironment=PLATFORM_TENANT_ID='+tenant+'\nEnvironment=PLATFORM_LOCATION_ID='+loc+'\nEnvironment=KDS_OPERATIONAL_TENANT_ID='+('customli-v5-prod' if production else 'customli-v5-test')+'\n')
 services=[apiunit,kdsunit]
 if production:
  config('customli-v5-auth','Environment='+json.dumps('PLATFORM_LOCATIONS_JSON='+json.dumps(locations,separators=(',',':')))+'\n');services.append('customli-v5-auth')
 run('systemctl','stop',*services)
 if production:
  for file in ['auth-server.mjs','device-registry.mjs']:shutil.copy2(dashboard/'customli-v5-dashboard'/file,targets['auth']/file)
 shutil.copy2(dashboard/'customli-v5-kds/server.mjs',targets['kds']/'server.mjs');shutil.copy2(dashboard/'customli-v5-kds/public/app.js',targets['kds']/'public/app.js')
 run('systemctl','daemon-reload');run('systemctl','start',*services)
 for unit in services:
  run('systemctl','is-active','--quiet',unit)
 after=financials()
 if before!=after:raise RuntimeError('Financial records changed unexpectedly during release')
 for file in [data/'pos.sqlite',kddata/'kds.sqlite',authdata/'identity.sqlite']:
  with sqlite3.connect('file:'+str(file)+'?mode=ro',uri=True) as c:
   if c.execute('pragma integrity_check').fetchone()[0]!='ok' or c.execute('pragma foreign_key_check').fetchall():raise RuntimeError('Post-release database integrity failed')
 evidence={'environment':a.environment,'backup':str(backup),'posCommit':subprocess.check_output(['git','-C',str(pos),'rev-parse','HEAD'],text=True).strip(),'platformCommit':subprocess.check_output(['git','-C',str(dashboard),'rev-parse','HEAD'],text=True).strip(),'before':before,'after':after,'locationId':loc,'services':services,'hardwareValidated':False,'playPublished':False}
 (backup/'release.json').write_text(json.dumps(evidence,indent=2));shutil.copy2(backup/'release.json',data/'UNIVERSAL_RELEASE.json');print(json.dumps(evidence))
except Exception:
 for name,target in targets.items():run('rsync','-a',str(backup/name)+'/',str(target)+'/')
 for file,old in reversed(configs):
  if old is None:file.unlink(missing_ok=True)
  else:file.write_bytes(old)
 run('systemctl','daemon-reload');run('systemctl','restart',apiunit,kdsunit,*(['customli-v5-auth'] if production else []));raise
