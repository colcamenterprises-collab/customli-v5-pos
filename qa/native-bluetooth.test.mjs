import assert from 'node:assert/strict';
const storage=new Map();
globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
let calls=[],connected=false,throwPrint=false;
const plugin={
 async scanPrinters(){calls.push('scan');return {printers:[{address:'AA:BB:CC:DD:EE:FF',name:'Kitchen Bluetooth Printer',bonded:true}]}},
 async listPrinters(){return {printers:[{address:'AA:BB:CC:DD:EE:FF',name:'Kitchen Bluetooth Printer',bonded:true}]}},
 async connect(x){calls.push('connect:'+x.address);connected=true;return {connected:true}},
 async disconnect(){calls.push('disconnect');connected=false;return {connected:false}},
 async printTest(){assert(connected);calls.push('test');return {ok:true}},
 async printRaw(x){assert(connected);if(throwPrint)throw Error('Bluetooth write failed');assert.equal(x.base64,'G0BA');calls.push('raster');return {ok:true}}
};
globalThis.window={Capacitor:{isNativePlatform:()=>true,Plugins:{ThermalPrinter:plugin}}};
const mod=await import('../native-bluetooth.mjs');
assert(mod.bluetoothAvailable());
const printers=await mod.scanPrinters();assert.equal(printers.length,1);
assert.throws(()=>mod.savePrinter({address:'invalid',width:80}));
assert.throws(()=>mod.savePrinter({address:'AA:BB:CC:DD:EE:FF',width:72}));
mod.savePrinter({address:printers[0].address,name:printers[0].name,width:80});
assert.equal(mod.readPrinter().width,80);
const result=await mod.sendTestPrint();assert.equal(result.sent,true);assert.equal(result.printed,false);assert.equal(connected,false);
const request=async(path,method,body)=>{assert.equal(path,'/print/native-receipt');assert.equal(method,'POST');assert.equal(body.orderId,'receipt-id');return {format:'escpos',base64:'G0BA',receiptNumber:12}};
const paid=await mod.printPaidReceipt(request,{id:'receipt-id'});assert.equal(paid.sent,true);assert.equal(paid.printed,false);
throwPrint=true;
await assert.rejects(()=>mod.printPaidReceipt(request,{id:'receipt-id'}),/Bluetooth write failed/);
assert.equal(connected,false,'The Bluetooth socket must be released even after an error');
assert.equal(calls.filter(x=>x==='disconnect').length,3);
globalThis.window={Capacitor:{isNativePlatform:()=>false,Plugins:{ThermalPrinter:plugin}}};
assert.equal(mod.bluetoothAvailable(),false);
await assert.rejects(()=>mod.sendTestPrint(),/Android app/);
console.log('PASS: native discovery, saved connection, 80mm, direct Receipt Studio raster, socket released after success/failure; no browser fallback');
