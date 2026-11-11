import React,{useEffect,useState} from 'react';
import {bluetoothAvailable,readPrinter,savePrinter,scanPrinters,listPairedPrinters,pairPrinter,sendTestPrint,nativePrintJobs} from './native-bluetooth.mjs';
import styles from './native-bluetooth.module.css';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export default function NativeBluetoothSetup({onClose}){
 const [devices,setDevices]=useState([]),[saved,setSaved]=useState(readPrinter),[chosen,setChosen]=useState(readPrinter()?.address||''),[width,setWidth]=useState(readPrinter()?.width||80),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[draft,setDraft]=useState(null),[tested,setTested]=useState(false),[paperConfirmed,setPaperConfirmed]=useState(false),[attentionJobs,setAttentionJobs]=useState([]);
 const native=bluetoothAvailable();
 const find=async()=>{setBusy(true);setError('');setMessage('Searching for nearby and paired Bluetooth printers…');try{const found=await scanPrinters();setDevices(found);setMessage(found.length?found.length+' Bluetooth device(s) found. Select your printer.':'No devices found. Make sure the printer is on and discoverable.')}catch(e){setError(e.message)}finally{setBusy(false)}};
 useEffect(()=>{if(native){void find();try{setAttentionJobs(nativePrintJobs().filter(j=>j.status==='uncertain'))}catch(e){setError(e.message)}}},[]);
 const connect=async()=>{const device=devices.find(x=>x.address===chosen)||saved;if(!device?.address)return setError('Select your printer first.');setBusy(true);setError('');try{
  if(!device.bonded){setMessage('Confirm the Android Bluetooth pairing request on your tablet.');await pairPrinter(device.address);let ready=false;for(let i=0;i<20;i++){const paired=await listPairedPrinters();if(paired.find(p=>p.address===device.address&&p.bonded)){ready=true;break}await wait(1000)}if(!ready)throw Error('Android pairing was not completed. Confirm the pairing prompt and try again.')}
  setMessage('Connecting to '+device.name+'…');
  const p=window.Capacitor.Plugins.ThermalPrinter;
  await p.connect({address:device.address});
  await p.disconnect(); // Never monopolize the shared Bluetooth printer.
  setDraft({address:device.address,name:device.name,width});setTested(false);setPaperConfirmed(false);setMessage('Printer connected. Send a test print before saving.');setDevices(a=>a.map(x=>x.address===device.address?{...x,bonded:true}:x));
 }catch(e){setError(e.message);setMessage('')}finally{setBusy(false)}};
 const test=async()=>{setBusy(true);setError('');setMessage('Sending test print…');try{await sendTestPrint({...draft,width});setTested(true);setPaperConfirmed(false);setMessage('Test sent. Check the printed paper, then confirm and save the printer.')}catch(e){setMessage('');setError(e.message)}finally{setBusy(false)}};
 const save=()=>{try{const result=savePrinter({...draft,width});setSaved(result);setMessage('Printer saved.')}catch(e){setError(e.message)}};
 return <div className={styles.backdrop} onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className={styles.modal} role="dialog" aria-modal="true" aria-label="Bluetooth printer"><header><div><h2>Connect Bluetooth printer</h2><p>Find → Connect → Test → Save. No gateway needed.</p></div><button type="button" onClick={onClose} aria-label="Close Bluetooth setup">×</button></header>
 {!native?<div className={styles.notice}><strong>Open the Customli V5 POS Android app on the tablet.</strong><p>Chrome cannot connect to a standard Bluetooth Classic receipt printer. Install the V5 Android app to search and connect directly. There is no gateway or pairing code to enter.</p></div>:<>
  {attentionJobs.length>0&&<div className={styles.notice}><strong>Check previous prints</strong>{attentionJobs.slice(-3).map(j=><span key={j.id}>{j.receiptNumber?'Receipt #'+j.receiptNumber:j.purpose==='test'?'Test print':'Receipt'} · output uncertain. Check the paper before printing again.</span>)}</div>}
  {saved&&<div className={styles.saved}><strong>Saved printer</strong><span>{saved.name} · {saved.width} mm</span><small>Saved on this tablet. Connection is opened only while printing so Loyverse or other apps can use the same printer.</small></div>}
  <div className={styles.step}><strong>1. Find your printer</strong><button type="button" onClick={find} disabled={busy} className={styles.secondary}>{busy?'Searching / connecting…':'Find printers'}</button></div>
  <div className={styles.devices}>{devices.map(device=><button type="button" key={device.address} className={chosen===device.address?styles.selected:styles.device} onClick={()=>{setChosen(device.address);setDraft(null);setTested(false);setPaperConfirmed(false)}} disabled={busy}><span><strong>{device.name||'Bluetooth printer'}</strong><small>{device.bonded?'Paired with Android':'Tap to pair'} · {device.address}</small></span><span aria-hidden="true">{chosen===device.address?'●':'○'}</span></button>)}</div>
  <div className={styles.step}><strong>2. Paper width</strong><div className={styles.widths}>{[58,80].map(n=><button type="button" key={n} aria-pressed={width===n} className={width===n?styles.active:''} onClick={()=>{setWidth(n);setTested(false);setPaperConfirmed(false)}}>{n} mm</button>)}</div></div>
  <div className={styles.step}><strong>3. Connect and test</strong><div className={styles.actions}><button type="button" className={styles.primary} disabled={busy||!chosen} onClick={connect}>Connect</button><button type="button" className={styles.secondary} disabled={busy||!draft} onClick={test}>Test print</button></div></div>
  {tested&&<div className={styles.step}><strong>4. Save printer</strong><label><input type="checkbox" checked={paperConfirmed} onChange={e=>setPaperConfirmed(e.target.checked)}/> Paper printed correctly</label><button type="button" className={styles.primary} disabled={busy||!paperConfirmed} onClick={save}>Save printer</button></div>}
 </>}
 {message&&<p className={styles.message} role="status">{message}</p>}{error&&<p className={styles.error} role="alert">{error}</p>}<button type="button" className={styles.done} onClick={onClose}>Done</button>
 </section></div>;
}
