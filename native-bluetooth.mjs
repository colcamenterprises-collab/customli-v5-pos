import {createNativePrintQueue} from './native-print-queue.mjs';
let queue;
const printQueue=()=>queue||=createNativePrintQueue();
export const nativePrintJobs=()=>printQueue().jobs();
// Android Classic Bluetooth ESC/POS is available only inside the native Customli V5 POS app.
// The browser cannot use Bluetooth RFCOMM. Never replace the device API with a fake print queue.
const plugin=()=>{const cap=typeof window!=='undefined'?window.Capacitor:null;return cap?.isNativePlatform?.()&&cap?.Plugins?.ThermalPrinter||null};
export function bluetoothAvailable(){return Boolean(plugin())}
const printerKey=()=>{try{const id=sessionStorage.getItem('customli-device-id'),loc=sessionStorage.getItem('customli-location-id');return 'customli.v5.bluetooth.printer'+(id&&loc?'.'+id+'@'+loc:'')}catch{return 'customli.v5.bluetooth.printer'}};
export const readPrinter=()=>{try{const value=JSON.parse(localStorage.getItem(printerKey())||'null');return value?.address?value:null}catch{return null}};
export function savePrinter(printer){if(!printer?.address||!/^[A-F0-9:]{17}$/i.test(printer.address)||![58,80].includes(printer.width))throw Error('Choose a Bluetooth printer and 58 or 80 mm paper.');const safe={address:printer.address.toUpperCase(),name:String(printer.name||'Bluetooth printer').slice(0,90),width:printer.width};localStorage.setItem(printerKey(),JSON.stringify(safe));return safe}
export async function scanPrinters(){if(!plugin())throw Error('Open Customli V5 POS Android app to find Bluetooth printers.');const r=await (plugin().scanPrinters?plugin().scanPrinters():plugin().listPrinters());return r.printers||[]}
export async function pairPrinter(address){if(!plugin())throw Error('Open Customli V5 POS Android app to pair printers.');if(!plugin().pairPrinter)throw Error('The V5 Android app needs an update to pair new devices.');return plugin().pairPrinter({address})}
export async function listPairedPrinters(){if(!plugin())return [];return (await plugin().listPrinters()).printers||[]}
export async function sendTestPrint(printer=readPrinter()){if(!plugin())throw Error('Bluetooth printing requires the Customli V5 Android app.');if(!printer)throw Error('Find and connect a Bluetooth printer first.');return printQueue().run({receiptId:'test',printer,purpose:'test'},async()=>{try{await plugin().connect({address:printer.address});await plugin().printTest()}finally{await plugin().disconnect().catch(()=>{})}})}
export async function printPaidReceipt(request,receipt,printer=readPrinter()){
 if(!plugin())throw Error('Bluetooth printing requires the Customli V5 Android app.');
 if(!printer)throw Error('Connect a Bluetooth printer first.');
 if(!receipt?.id)throw Error('Choose a saved paid receipt.');
 // Server renders exactly the saved Receipt Studio raster; no second text-only receipt layout.
 const payload=await request('/print/native-receipt','POST',{orderId:receipt.id,paperWidth:printer.width});
 if(payload.format!=='escpos'||!payload.base64)throw Error('The receipt could not be prepared.');
 const result=await printQueue().run({receiptId:receipt.id,receiptNumber:payload.receiptNumber,printer},async()=>{
  try{await plugin().connect({address:printer.address});await plugin().printRaw({base64:payload.base64})}finally{await plugin().disconnect().catch(()=>{})}
 });
 return {...result,receiptNumber:payload.receiptNumber};
}
