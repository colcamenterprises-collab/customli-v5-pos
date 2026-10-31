import React,{useEffect,useState} from 'react';
import {bluetoothAvailable,readPrinter,savePrinter,scanPrinters,listPairedPrinters,pairPrinter,sendTestPrint} from './native-bluetooth.mjs';
import styles from './native-bluetooth.module.css';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export default function NativeBluetoothSetup({onClose}){
 const [devices,setDevices]=useState([]),[saved,setSaved]=useState(readPrinter),[chosen,setChosen]=useState(readPrinter()?.address||''),[width,setWidth]=useState(readPrinter()?.width||80),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const native=bluetoothAvailable();
 const find=async()=>{setBusy(true);setError('');setMessage('Searching for nearby and paired Bluetooth printers…');try{const found=await scanPrinters();setDevices(found);setMessage(found.length?found.length+' Bluetooth device(s) found. Select your printer.':'No devices found. Make sure the printer is on and discoverable.')}catch(e){setError(e.message)}finally{setBusy(false)}};
 useEffect(()=>{if(native)void find()},[]);
 const connect=async()=>{const device=devices.find(x=>x.address===chosen)||saved;if(!device?.address)return setError('Select your printer first.');setBusy(true);setError('');try{
  if(!device.bonded){setMessage('Confirm the Android Bluetooth pairing request on your tablet.');await pairPrinter(device.address);let ready=false;for(let i=0;i<20;i++){const paired=await listPairedPrinters();if(paired.find(p=>p.address===device.address&&p.bonded)){ready=true;break}await wait(1000)}if(!ready)throw Error('Android pairing was not completed. Confirm the pairing prompt and try again.')}
  setMessage('Connecting to '+device.name+'…');
  const p=window.Capacitor.Plugins.ThermalPrinter;
  await p.connect({address:device.address});
  await p.disconnect(); // Never monopolize the shared Bluetooth printer.
  const savedPrinter=savePrinter({address:device.address,name:device.name,width});
  setSaved(savedPrinter);setMessage('Printer saved. You can now test it or print a receipt.');setDevices(a=>a.map(x=>x.address===device.address?{...x,bonded:true}:x));
 }catch(e){setError(e.message);setMessage('')}finally{setBusy(false)}};
 const test=async()=>{setBusy(true);setError('');setMessage('Sending test print…');try{await sendTestPrint({...saved,width});setMessage('Test sent. Check that paper actually printed. The printer is released so other systems can use it.')}catch(e){setMessage('');setError(e.message)}finally{setBusy(false)}};
 return <div className={styles.backdrop} onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className={styles.modal} role="dialog" aria-modal="true" aria-label="Bluetooth printer"><header><div><h2>Connect Bluetooth printer</h2><p>Find → Connect → Test. No gateway needed.</p></div><button type="button" onClick={onClose} aria-label="Close Bluetooth setup">×</button></header>
 {!native?<div className={styles.notice}><strong>Open the Customli V5 POS Android app on the tablet.</strong><p>Chrome cannot connect to a standard Bluetooth Classic receipt printer. Install the V5 Android app to search and connect directly. There is no gateway or pairing code to enter.</p></div>:<>
  {saved&&<div className={styles.saved}><strong>Saved printer</strong><span>{saved.name} · {saved.width} mm</span><small>Saved on this tablet. Connection is opened only while printing so Loyverse or other apps can use the same printer.</small></div>}
  <div className={styles.step}><strong>1. Find your printer</strong><button type="button" onClick={find} disabled={busy} className={styles.secondary}>{busy?'Searching / connecting…':'Find printers'}</button></div>
  <div className={styles.devices}>{devices.map(device=><button type="button" key={device.address} className={chosen===device.address?styles.selected:styles.device} onClick={()=>setChosen(device.address)} disabled={busy}><span><strong>{device.name||'Bluetooth printer'}</strong><small>{device.bonded?'Paired with Android':'Tap to pair'} · {device.address}</small></span><span aria-hidden="true">{chosen===device.address?'●':'○'}</span></button>)}</div>
  <div className={styles.step}><strong>2. Paper width</strong><div className={styles.widths}>{[58,80].map(n=><button type="button" key={n} aria-pressed={width===n} className={width===n?styles.active:''} onClick={()=>setWidth(n)}>{n} mm</button>)}</div></div>
  <div className={styles.step}><strong>3. Connect and test</strong><div className={styles.actions}><button type="button" className={styles.primary} disabled={busy||!chosen} onClick={connect}>Connect & save</button><button type="button" className={styles.secondary} disabled={busy||!saved} onClick={test}>Test print</button></div></div>
 </>}
 {message&&<p className={styles.message} role="status">{message}</p>}{error&&<p className={styles.error} role="alert">{error}</p>}<button type="button" className={styles.done} onClick={onClose}>Done</button>
 </section></div>;
}
