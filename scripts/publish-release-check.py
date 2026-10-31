#!/usr/bin/env python3
"""Publish a required status only after checking a passing exact-artifact attestation."""
import json,os,pathlib,subprocess
root=pathlib.Path(__file__).resolve().parents[1];os.chdir(root)
subprocess.run(['python3','scripts/release-gate.py','--verify'],check=True)
sha=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
payload={'state':'success','context':'POS release guard','description':'Exact source/builds passed visual and backend release checks'}
subprocess.run(['gh','api','--method','POST','repos/colcamenterprises-collab/customli-v5-pos/statuses/'+sha,'--input','-'],input=json.dumps(payload),text=True,check=True,stdout=subprocess.DEVNULL)
print('Published POS release guard PASS for '+sha)
