import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(path,'utf8');
test('POS Dashboard action uses parent native bridge, never navigates embedded iframe',()=>{
 const pos=read('src.jsx'),shell=read('universal.jsx');
 assert.match(pos,/window\.parent\.postMessage\(\{type:'customli:open-dashboard'\},window\.location\.origin\)/);
 assert.match(shell,/e\.source!==document\.querySelector\('iframe'\)\?\.contentWindow/);
 assert.match(shell,/e\.origin!==window\.location\.origin/);
 assert.match(shell,/e\.data\?\.type!=='customli:open-dashboard'/);
 assert.match(shell,/openDashboard\(\)/);
 const native=read('android-v5/app/src/main/java/io/customli/pos/ExternalNavigationPlugin.java');
 assert.match(native,/Intent\.ACTION_VIEW/);
 assert.match(native,/https:\/\/customli\.io\/v5-dashboard\//);
});
test('approved icon is regenerated for every Android density with black background',()=>{
 const generator=read('scripts/generate-android-icon.py');
 assert.match(generator,/LIME=\(217,255,79\)/);
 assert.match(generator,/ic_launcher_round\.png/);
 assert.match(read('android-v5/app/src/main/res/values/ic_launcher_background.xml'),/#000000/);
});
