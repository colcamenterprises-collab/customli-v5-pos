#!/usr/bin/env python3
"""Test the exact source and both built POS artifacts; fail closed before deployment."""
import argparse,datetime,fcntl,hashlib,json,pathlib,subprocess,os,sys
ROOT=pathlib.Path(__file__).resolve().parents[1];os.chdir(ROOT)
def run(*args,env=None):subprocess.run(args,check=True,env=env)
def git(*args):return subprocess.check_output(['git',*args],text=True).strip()
def digest_files(files,base):
 h=hashlib.sha256()
 for f in sorted(files):
  h.update(str(f).encode()+b'\0');h.update((base/f).read_bytes());h.update(b'\0')
 return h.hexdigest()
def state():
 files=[pathlib.Path(p) for p in git('ls-files').splitlines() if (ROOT/p).is_file()]
 return {'commit':git('rev-parse','HEAD'),'source':digest_files(files,ROOT),'builds':{name:digest_files([p.relative_to(ROOT/name) for p in (ROOT/name).rglob('*') if p.is_file()],ROOT/name) for name in ['dist','test-dist']}}
p=argparse.ArgumentParser();p.add_argument('--verify',action='store_true');a=p.parse_args();result=ROOT/'qa/release-results/attestation.json';result.parent.mkdir(parents=True,exist_ok=True)
with open(ROOT/'.git/v5-release-gate.lock','w') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX)
 if a.verify:
  if git('status','--porcelain'):sys.exit('BLOCKED: release checkout is not clean; commit and rerun the gate.')
  if not result.exists():sys.exit('BLOCKED: no passing release attestation. Run npm run release:gate.')
  recorded=json.loads(result.read_text())
  if recorded.get('status')!='PASS' or recorded.get('state')!=state():sys.exit('BLOCKED: source or built assets changed after testing. Rerun npm run release:gate.')
  print('PASS: exact commit, source and both built artifacts verified');sys.exit(0)
 result.unlink(missing_ok=True)
 started=state()
 run('node','qa/css-contract.mjs')
 run('npm','run','build');run('node','node_modules/vite/bin/vite.js','build','--base=/v5-test/','--outDir','test-dist',env={**os.environ,'VITE_API_BASE':'/v5-test/api'})
 tested=state()
 if any(started[k]!=tested[k] for k in ['commit','source']):sys.exit('BLOCKED: source changed during build.')
 for test in ['qa/menu-costs.test.mjs','qa/shift-food.test.mjs','qa/onboarding.test.mjs','qa/onboarding.http.test.mjs','qa/expenses.test.mjs','qa/expenses.http.test.mjs','qa/phase1.integration.mjs','qa/print-studio.test.mjs','qa/print-contracts.test.mjs','qa/sales-channels.test.mjs'] :run('node',test)
 run('node','qa/discount-rules.e2e.mjs')
 for dist,base in [('dist','/v5/'),('test-dist','/v5-test/')]:run('node','qa/ui-release.mjs',env={**os.environ,'UI_DIST':dist,'UI_BASE':base,'ALLOW_VISUAL_BASELINE_UPDATE':''})
 if state()!=tested:sys.exit('BLOCKED: source or built artifacts changed while tests were running.')
 result.write_text(json.dumps({'status':'PASS','testedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'state':state()},indent=2)+'\n')
 print('PASS: release gate; attestation saved for exact source and build bytes')
