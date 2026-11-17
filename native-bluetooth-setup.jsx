import React,{useEffect,useState} from 'react';
import {bluetoothAvailable,readPrinter,savePrinter,scanPrinters,listPairedPrinters,pairPrinter,sendTestPrint,nativePrintJobs,syncPrinter} from './native-bluetooth.mjs';
import styles from './native-bluetooth.module.css';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export default function NativeBluetoothSetup({onClose,request}){
 const [syncing,setSyncing]=useState(false);
 const [devices,setDevices]=useState([]),[saved,setSaved]=useState(readPrinter),[chosen,setChosen]=useState(readPrinter()?.address||''),[width,setWidth]=useState(readPrinter()?.width||80),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[draft,setDraft]=useState(null),[tested,setTested]=useState(false),[paperConfirmed,setPaperConfirmed]=useState(false),[attentionJobs,setAttentionJobs]=useState([]);
 const native=bluetoothAvailable();
 const find=async()=>{setBusy(true);setError('');setMessage('Searching for nearby and paired Bluetooth printers…');try{const found=await scanPrinters();setDevices(found);setMessage(found.length?found.length+' Bluetooth device(s) found. Select your printer.':'No devices found. Make sure the printer is on and discoverable.')}catch(e){setError(e.message)}finally{setBusy(false)}};
 useEffect(()=>{if(native){void find();try{setAttentionJobs(nativePrintJobs().filter(j=>j.status==='uncertain'))}catch(e){setError(e.message)}}},[]);
 const connect=async()=>{const device=devices.find(x=>x.address===chosen)||saved;if(!device?.address)return setError('Select your printer first.');setBusy(true);setError('');try{
  if(!device.bonded){setMessage('Confirm the Android Bluetooth pairing request on your tablet.');await pairPrinter(device.address);let ready=false;for(let i=0;i<20;i++){const paired=await listPairedPrinters();if(paired.find(p=>p.address===device.address&&p.bonded)){ready=true;break}await wait(1000)}if(!ready)throw Error('Android pairing was not completed. Confirm the pairing prompt and try again.')}
  const printer={address:device.address,name:device.name,width};
  setDraft(printer);setTested(false);setPaperConfirmed(false);
  setMessage('Sending test print…');await sendTestPrint(printer);
  setTested(true);setMessage('Test sent. Check the paper, then save.');
  setDevices(a=>a.map(x=>x.address===device.address?{...x,bonded:true}:x));
 }catch(e){setError(e.message);setMessage('')}finally{setBusy(false)}};
 const save=async()=>{setError('');try{
  const result=savePrinter({...draft,width});setSaved(result);
  if(request){setSyncing(true);try{await syncPrinter(request,result);setMessage('Printer saved.')}catch{setMessage('Saved on this tablet. Reopen printer settings online to update the Dashboard.')}finally{setSyncing(false)}}
  else setMessage('Printer saved.');
 }catch(e){setError(e.message)}};
 useEffect(()=>{if(saved&&request){syncPrinter(request,saved).catch(()=>{})}},[]);
 return <div className={styles.backdrop} onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className={styles.modal} role="dialog" aria-modal="true" aria-label="Bluetooth printer"><header><div><h2>Connect Bluetooth printer</h2></div><button type="button" onClick={onClose} aria-label="Close Bluetooth setup">×</button></header>
 {!native?<div className={styles.notice}><strong>Open the Customli V5 POS Android app on the tablet.</strong><p>Chrome cannot connect to a standard Bluetooth Classic receipt printer. Install the V5 Android app to search and connect directly. There is no gateway or pairing code to enter.</p></div>:<>
  {attentionJobs.length>0&&<div className={styles.notice}><strong>Check previous prints</strong>{attentionJobs.slice(-3).map(j=><span key={j.id}>{j.receiptNumber?'Receipt #'+j.receiptNumber:j.purpose==='test'?'Test print':'Receipt'} · output uncertain. Check the paper before printing again.</span>)}</div>}
  {saved&&<div className={styles.saved}><strong>Saved printer</strong><span>{saved.name} · {saved.width} mm</span></div>}
  <div className={styles.step}><strong>Printer</strong><button type="button" onClick={find} disabled={busy} className={styles.secondary}>{busy?'Searching / connecting…':'Find printers'}</button></div>
  <div className={styles.devices}>{devices.map(device=><button type="button" key={device.address} className={chosen===device.address?styles.selected:styles.device} onClick={()=>{setChosen(device.address);setDraft(null);setTested(false);setPaperConfirmed(false)}} disabled={busy}><span><strong>{device.name||'Bluetooth printer'}</strong><small>{device.bonded?'Paired with Android':'Tap to pair'} · {device.address}</small></span><span aria-hidden="true">{chosen===device.address?'●':'○'}</span></button>)}</div>
  <div className={styles.step}><strong>Paper width</strong><div className={styles.widths}>{[58,80].map(n=><button type="button" key={n} aria-pressed={width===n} className={width===n?styles.active:''} disabled={busy} onClick={()=>{setWidth(n);setDraft(null);setTested(false);setPaperConfirmed(false)}}>{n} mm</button>)}</div></div>
  <div className={styles.step}><strong>Test printer</strong><div className={styles.actions}><button type="button" className={styles.primary} disabled={busy||!chosen} onClick={connect}>Connect and test</button></div></div>
  {tested&&<div className={styles.step}><strong>Confirm test</strong><label><input type="checkbox" checked={paperConfirmed} onChange={e=>setPaperConfirmed(e.target.checked)}/> Paper printed correctly</label><button type="button" className={styles.primary} disabled={busy||syncing||!paperConfirmed||!tested||!draft} onClick={save}>Save printer</button></div>}
 </>}
 {message&&<p className={styles.message} role="status">{message}</p>}{error&&<p className={styles.error} role="alert">{error}</p>}<button type="button" className={styles.done} onClick={onClose}>Done</button>
 </section></div>;
}
