#!/usr/bin/env python3
"""Deploy tested static POS assets, verify the public UI, restore prior assets on failure."""
import argparse,datetime,fcntl,json,os,pathlib,shutil,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[1];os.chdir(ROOT)
p=argparse.ArgumentParser();p.add_argument('environment',choices=['test','production']);a=p.parse_args();test=a.environment=='test'
def run(*args):subprocess.run(args,check=True)
with open('/opt/backups/v5-pos-static-release.lock','w') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX)
 run('python3','scripts/release-gate.py','--verify')
 if not test:
  run('git','fetch','origin','main')
  assert subprocess.check_output(['git','rev-parse','HEAD'])==subprocess.check_output(['git','rev-parse','origin/main']),'Production requires current merged main'
 src=ROOT/('test-dist' if test else 'dist');dest=pathlib.Path('/opt/apps/customli-v5-test' if test else '/opt/apps/customli-v5-pos')/'dist'
 backup=pathlib.Path('/opt/backups')/('v5-pos-static-'+a.environment+'-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'));shutil.copytree(dest,backup)
 def copy(build):
  run('rsync','-a','--exclude=index.html',str(build)+'/',str(dest)+'/');shutil.copy2(build/'index.html',dest/'index.html.new');(dest/'index.html.new').replace(dest/'index.html')
 try:
  copy(src);run('node','qa/pos-layout-deployed.mjs',a.environment)
 except Exception:
  copy(backup);print('ROLLED BACK static release; no database changes');raise
 shutil.copy2(ROOT/'qa/release-results/attestation.json',dest.parent/'POS_STATIC_RELEASE.json')
 print(json.dumps({'deployed':a.environment,'backup':str(backup),'databaseChanges':False}))
