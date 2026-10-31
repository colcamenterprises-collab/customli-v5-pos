import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import postcss from 'postcss';
const shared=postcss.parse(readFileSync('design-system.css','utf8'));
const rules=new Map();shared.walkRules(r=>rules.set(r.selector,Object.fromEntries(r.nodes.filter(n=>n.type==='decl').map(n=>[n.prop,n.value]))));
assert.equal(rules.get('.logo')?.width,'58px');assert.equal(rules.get('.logo')?.overflow,'hidden');assert.equal(rules.get('.logo img')?.width,'100%');assert.equal(rules.get('.logo img')?.['object-fit'],'contain');assert.equal(rules.get(':root')?.['--green'],'#0cae8b');
const globals=new Set(['design-system.css','style.css','select.css','modifier-picker.css']);
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard'],{encoding:'utf8'}).trim().split('\n');
for(const file of new Set(files.filter(f=>f.endsWith('.css')&&existsSync(f)))){
 const css=postcss.parse(readFileSync(file,'utf8'));
 if(file!=='design-system.css')css.walkRules(rule=>{assert(!rule.selector.split(',').some(s=>s.trim()===':root'),'Global tokens belong only in design-system.css: '+file);rule.walkDecls(d=>assert(!d.prop.startsWith('--control-'),'Shared control tokens cannot be overridden by feature CSS: '+file))});
 if(!globals.has(file)){
  assert(file.endsWith('.module.css'),'New feature CSS must use CSS Modules: '+file);
  css.walkRules(rule=>{if(rule.parent.type==='atrule'&&/keyframes$/.test(rule.parent.name))return;for(const selector of rule.selector.split(',')){assert(!selector.includes(':global')&&!/(^|[\s>+~])(html|body|:root)(?=\W|$)/.test(selector),'Feature CSS cannot escape module scope: '+file);assert(/\.[a-zA-Z_]/.test(selector),'Feature selector needs a local class: '+file)}});
 }
}
const src=readFileSync('src.jsx','utf8');assert(src.indexOf("import './design-system.css'")<src.indexOf("import './style.css'"),'Import design foundation before responsive styles');
console.log('PASS: protected branding/tokens and feature CSS boundaries');
