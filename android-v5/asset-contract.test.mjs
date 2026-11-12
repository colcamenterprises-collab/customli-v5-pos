import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const read=file=>readFileSync(path.join(root,file),'utf8');
test('upgrade retains package identity and universal branding',()=>{
 assert.match(read('android-v5/app/build.gradle'),/applicationId "io.customli.v5pos"/);
 assert.match(read('android-v5/app/src/main/res/values/strings.xml'),/<string name="app_name">Customli<\/string>/);
 assert.match(read('android-v5/app/build.gradle'),/versionCode 10002/);
});
test('credentials use authenticated encryption and backups are disabled',()=>{
 const native=read('android-v5/app/src/main/java/io/customli/pos/DeviceIdentityPlugin.java');
 assert.match(native,/AndroidKeyStore/);assert.match(native,/AES\/GCM\/NoPadding/);
 const manifest=read('android-v5/app/src/main/AndroidManifest.xml');
 assert.match(manifest,/android:allowBackup="false"/);assert.match(manifest,/android:usesCleartextTraffic="false"/);
 assert.doesNotMatch(read('universal.jsx'),/localStorage\.setItem/);
});
test('all three modes ship local assets and native transport bridge',()=>{
 for(const file of ['android-dist/index.html','android-dist/pos/index.html','android-dist/kds/index.html','android-dist/kds/styles.css','android-dist/kds/app.js'])assert.ok(existsSync(path.join(root,file)),file);
 const config=JSON.parse(read('android-v5/app/src/main/assets/capacitor.config.json'));
 assert.equal(config.server.url,undefined);assert.equal(config.plugins.CapacitorHttp.enabled,true);
 assert.match(read('android-dist/pos/index.html'),/window.fetch=\(input,options/);
 assert.match(read('android-dist/pos/index.html'),/window.Capacitor=parent.Capacitor/);
 for(const match of read('android-dist/kds/index.html').matchAll(/(?:src|href)=\"(\.[^\"]+)\"/g))assert.ok(existsSync(path.join(root,'android-dist/kds',match[1])),match[1]);
});
test('native KDS never persists its credential in localStorage or shows code pairing',()=>{
 const kds=read('android-dist/kds/app.js');assert.doesNotMatch(kds,/localStorage\.(?:getItem|setItem|removeItem)\(tokenKey/);
 assert.doesNotMatch(kds,/Enter the eight-digit code/);assert.match(kds,/sessionStorage.getItem\(tokenKey\)/);
 assert.match(kds,/https:\/\/customli\.io\/v5-kds/);
 assert.doesNotMatch(kds,/navigator.serviceWorker.register/);
});
test('offline authorization expires and online revocation closes mode',()=>{
 const shell=read('universal.jsx');assert.match(shell,/request\(AUTH\+'\/me'/);assert.match(shell,/error.status===401\|\|error.status===403/);
 assert.match(shell,/deviceStore\(\)\?\.clear\(\)/);assert.match(shell,/customli-device-id/);assert.match(shell,/customli-location-id/);
});
test('discovery metadata is untrusted and intersected with authorized same-location peers',()=>{
 const native=read('android-v5/app/src/main/java/io/customli/pos/DeviceDiscoveryPlugin.java');
 assert.match(native,/candidate.put\("authenticated", false\)/);
 const shell=read('universal.jsx');assert.doesNotMatch(shell,/devices\/register/);assert.match(shell,/locations.find\(x=>x.id===locationId\)/);
});
