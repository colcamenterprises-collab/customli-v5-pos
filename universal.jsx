import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import DashboardLogin from './dashboard-login.jsx';
import Select from './select.jsx';
import './design-system.css';
import styles from './universal.module.css';

const ORIGIN=import.meta.env.VITE_PLATFORM_ORIGIN||'https://customli.io';
const AUTH=import.meta.env.VITE_AUTH_API_BASE||ORIGIN+'/v5-auth/api/auth';
const POS_API=import.meta.env.VITE_API_BASE||ORIGIN+'/v5/api';
const environment=import.meta.env.VITE_ANDROID_ENV||'production';
const VERSION='1.2.7';
const deviceStore=()=>window.Capacitor?.Plugins?.DeviceIdentity;
const currency=n=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'THB'}).format(Number(n||0)/100);
async function request(url,token='',body,device){
 const headers={'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(device?{'X-Customli-Location':device.locationId,'X-Customli-Installation':device.installationId,'X-Customli-Mode':device.mode,...(device.posDeviceId?{'X-Customli-Pos-Device':device.posDeviceId}:{})}:{})};
 const method=body===undefined?'GET':'POST';
 let status,data;
 const native=window.Capacitor?.Plugins?.CapacitorHttp;
 if(native){const response=await native.request({url,method,headers,...(body===undefined?{}:{data:body}),connectTimeout:8000,readTimeout:12000});status=response.status;data=response.data;}
 else{const response=await fetch(url,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)});status=response.status;data=await response.json();}
 if(status<200||status>=300)throw Object.assign(new Error(data?.message||'Customli could not connect. Please try again.'),{status});
 return data;
}
function CustomerDisplay({token,device}){
 const [display,setDisplay]=useState(null),[offline,setOffline]=useState(false);
 useEffect(()=>{let active=true;const update=async()=>{try{const next=await request(POS_API+'/display?posDeviceId='+encodeURIComponent(device.posDeviceId||''),token,undefined,device);if(active){setDisplay(next);setOffline(next.stale===true);}}catch{if(active)setOffline(true);}};update();const timer=setInterval(update,1000);return()=>{active=false;clearInterval(timer);};},[token,device.posDeviceId]);
 const waiting=!display||display.state==='waiting';
 const safeLogo=display?.branding?.logo&&/^(?:https:\/\/customli\.io\/|data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$)/.test(display.branding.logo)?display.branding.logo:null;
 return <main className={styles.customer}>
  <header>{safeLogo&&<img src={safeLogo} alt=""/>}<h1>{display?.branding?.name||'Welcome'}</h1></header>
  {offline?<div className={styles.waiting}><h2>Reconnecting</h2><p>Your cashier can help with your order.</p></div>:waiting?<div className={styles.waiting}><h2>Ready when you are</h2><p>Your order will appear here.</p></div>:<>
   <div className={styles.items}>{(display.items||[]).map((item,index)=><article key={index}><span>{item.quantity} × {item.name}</span><strong>{currency(item.unitPrice*item.quantity)}</strong></article>)}</div>
   <footer><div><span>Subtotal</span><strong>{currency(display.subtotal)}</strong></div>{Number(display.discount)>0&&<div><span>Discount</span><strong>−{currency(display.discount)}</strong></div>}<div className={styles.total}><span>Total</span><strong>{currency(display.total)}</strong></div><p>{display.state==='recorded'?'Thank you. Your order has been recorded.':'Please complete payment with your cashier.'}</p></footer>
  </>}
 </main>;
}
function dashboardAllowed(identity){
 if(Array.isArray(identity.staffAccess))return identity.staffAccess.some(g=>g?.permissions.includes('applications.dashboard'));
 return identity.memberships?.some(m=>['Owner','Manager'].includes(m.role))||false;
}
const appModes=['POS','KDS','CDS'];
const modesFor=location=>Array.isArray(location?.modes)?appModes.filter(mode=>location.modes.includes(mode))
 : appModes.filter(mode=>mode!=='KDS'||['Owner','Manager'].includes(location?.role));
const clearKitchenCache=()=>{for(const key of Object.keys(localStorage))if(/^customli-kds-(?:production|test)-.*(?:board-cache|pending-actions|event-cursor)$/.test(key))localStorage.removeItem(key);};
function App(){
 const [staffSession,setStaffSession]=useState(false);
 const [firstLogin,setFirstLogin]=useState(null),[newPin,setNewPin]=useState(''),[confirmPin,setConfirmPin]=useState(''),[pinError,setPinError]=useState(''),[oldPin,setOldPin]=useState('');
 const [screen,setScreen]=useState('loading'),[saved,setSaved]=useState(null),[locations,setLocations]=useState([]),[locationId,setLocationId]=useState(''),[mode,setMode]=useState('POS'),[devices,setDevices]=useState([]),[posDeviceId,setPosDeviceId]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[reconnecting,setReconnecting]=useState(false),[nearby,setNearby]=useState([]);
 const selectedLocation=locations.find(x=>x.id===locationId);
 const availableModes=selectedLocation?modesFor(selectedLocation):appModes;
 const changeLocation=id=>{setLocationId(id);setPosDeviceId('');const modes=modesFor(locations.find(x=>x.id===id));setMode(current=>modes.includes(current)?current:modes[0]||'POS');};
 const [printerAction,setPrinterAction]=useState(false);
 useEffect(()=>{
  const readAction=async()=>{const action=await deviceStore()?.consumeLaunchAction?.();if(action?.action==='printers')setPrinterAction(true)};
  readAction().catch(()=>{});
  window.addEventListener('customli:launch',readAction);
  return()=>window.removeEventListener('customli:launch',readAction);
 },[]);
 useEffect(()=>{
  if(printerAction&&screen==='mode'&&saved?.device.mode==='POS'){
   const frame=document.querySelector('iframe[title="Point of sale"]');
   const send=()=>frame?.contentWindow?.postMessage({type:'customli:printer-setup'},window.location.origin);
   const ready=e=>{if(e.source===frame?.contentWindow&&e.origin===window.location.origin&&e.data?.type==='customli:printer-ready')send()};
   window.addEventListener('message',ready);send();
   return()=>window.removeEventListener('message',ready);
  }
 },[printerAction,screen,saved?.device.mode]);
 const [showDeviceMenu,setShowDeviceMenu]=useState(false);
 const [launcherTab,setLauncherTab]=useState('home');
 const openDashboard=async()=>{if(staffSession){setError('Dashboard is not available for staff PIN sessions.');return;}setError('');try{const handoff=await request(AUTH+'/browser-handoff',saved?.token||accountToken.current,{});await window.Capacitor.Plugins.ExternalNavigation.openDashboard({handoffCode:handoff.code})}catch(e){setError(e.message||'Could not open dashboard in your browser.')}};
 const openSupport=async()=>{setError('');try{await window.Capacitor.Plugins.ExternalNavigation.openSupport()}catch(e){setError(e.message||'Could not open support in your browser.')}};
 useEffect(()=>{const handler=e=>{if(e.source!==document.querySelector('iframe')?.contentWindow||e.origin!==window.location.origin||e.data?.type!=='customli:open-dashboard')return;openDashboard()};window.addEventListener('message',handler);return()=>window.removeEventListener('message',handler)},[saved?.token,staffSession]);
 const accountToken=useRef(''),accountId=useRef(''),sessionExpiresAt=useRef(''),installationId=useRef('');
 const persist=async next=>{await deviceStore().save({credential:JSON.stringify(next)});setSaved(next);};
 const registerDevice=async next=>{const result=await request(AUTH+'/devices/register',next.token,{installationId:installationId.current,name:next.device.name||'POS tablet',mode:next.device.mode,locationId:next.device.locationId,station:next.device.station||'Expo',posDeviceId:next.device.posDeviceId||undefined,version:VERSION});return{...next,deviceToken:result.token,device:{...result.device,installationId:installationId.current}}};
 const open=async next=>{if(saved?.device&&['id','tenantId','locationId','mode','station'].some(key=>saved.device[key]!==next.device[key]))clearKitchenCache();await persist(next);sessionStorage.setItem('customli-platform-session',next.token);sessionStorage.setItem('v5_token',next.token);sessionStorage.setItem('customli-device-id',next.device.id);sessionStorage.setItem('customli-location-id',next.device.locationId);sessionStorage.setItem('customli-installation-id',installationId.current);sessionStorage.setItem('customli-mode',next.device.mode);if(next.deviceToken)sessionStorage.setItem('customli-device-token',next.deviceToken);sessionStorage.setItem('customli-kds-'+environment+'-device-token',next.token);sessionStorage.setItem('customli-native-scope',[next.device.tenantId,next.device.locationId,next.device.id].join(':'));setScreen('mode');};
 const revoke=async message=>{const discovery=window.Capacitor?.Plugins?.DeviceDiscovery;if(discovery)await discovery.stop().catch(()=>{});clearKitchenCache();await deviceStore()?.clear();sessionStorage.clear();setSaved(null);setScreen('login');setError(message);};
 useEffect(()=>{let active=true;(async()=>{try{
  if(!window.Capacitor?.isNativePlatform?.()||!deviceStore())throw Error('Install the Customli Android application.');
  const state=await deviceStore().read();installationId.current=state.installationId;
  if(!state.credential){if(active)setScreen('login');return;}
  const next=JSON.parse(state.credential);
  try{const me=await request(AUTH+'/me',next.token);if(active){if(me.mustChangeCredential){await revoke('Sign in to change your temporary credential.');return}setStaffSession(me.operationalOnly===true||!dashboardAllowed(me));const registered=next.deviceToken?next:await registerDevice(next);await open(registered);}}
  catch(error){if(!active)return;if(error.status===401){try{if(next.deviceToken)await request(AUTH+'/devices/self',next.deviceToken);const resumable={...next,token:''};await deviceStore().save({credential:JSON.stringify(resumable)});setSaved(resumable);setScreen('login');setError('Your account session expired. Sign in again; this device setup is saved.');}catch{await revoke('This device registration has ended. Sign in again to set it up.');}}
   else if(error.status===403)await revoke('Your session has ended. Sign in again.');
   else if(Date.parse(next.expiresAt)>Date.now()&&next.device?.mode==='POS'){await open(next);setReconnecting(true)}else{setSaved(next);setScreen('connection');setError('Connect to verify your account.');}}
 }catch(error){if(active){setError(error.message);setScreen('unavailable');}}})();return()=>{active=false};},[]);
 useEffect(()=>{if(screen!=='mode'||!saved)return;const timer=setInterval(async()=>{
  if(Date.parse(saved.expiresAt)<=Date.now()){await revoke('Your session has expired. Sign in again.');return;}
  try{const me=await request(AUTH+'/me',saved.token);if(me.mustChangeCredential){await revoke('Sign in to change your temporary credential.');return}if(saved.deviceToken)await request(AUTH+'/devices/heartbeat',saved.deviceToken,{version:VERSION});setStaffSession(me.operationalOnly===true||!dashboardAllowed(me));setReconnecting(false);}
  catch(error){if(error.status===401||error.status===403)await revoke('Your session has ended. Sign in again.');else setReconnecting(true);}
 },15000);return()=>clearInterval(timer);},[screen,saved]);
  useEffect(()=>{if(screen!=='setup'||mode!=='CDS'||!locationId||!accountToken.current)return;
  const location=locations.find(x=>x.id===locationId);if(!location)return;
  let active=true;
  request(POS_API+'/display/terminals',accountToken.current,undefined,
   {locationId,installationId:installationId.current,mode:'CDS'}).then(rows=>{
    if(active){setDevices(rows);setPosDeviceId(rows.length===1?rows[0].id:'');}
   }).catch(error=>{if(active)setError(error.message)});
  return()=>{active=false};
 },[screen,mode,locationId,locations]);
 const signIn=async (login,credential)=>{

  if(login.mustChangeCredential){setFirstLogin(login);setOldPin(credential||'');setNewPin('');setConfirmPin('');setPinError('');setScreen('first-login');return;}
  const identity=await request(AUTH+'/me',login.token);
  setStaffSession(identity.operationalOnly===true||!dashboardAllowed(identity));
  const choices=await request(AUTH+'/locations',login.token);
  accountToken.current=login.token;
  accountId.current=login.user.id;
  sessionExpiresAt.current=login.expiresAt;
  setLocations(choices);
  setLocationId(choices.length===1?choices[0].id:'');
  if(choices.length===1)setMode(modesFor(choices[0])[0]||'POS');
  if(saved?.accountId===login.user.id&&saved.device&&choices.some(x=>x.id===saved.device.locationId)){
   try{if(saved.deviceToken)await request(AUTH+'/devices/self',saved.deviceToken);const resumed=await registerDevice({...saved,token:login.token,expiresAt:login.expiresAt});await open(resumed);setError('');return;}catch(error){setError('Saved tablet assignment needs review. '+error.message);}
  }
  setError('');
  setScreen('setup');
 };
 const choose=async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{
  const location=locations.find(x=>x.id===locationId);
  if(!location)throw Error('Choose a restaurant');
  if(!modesFor(location).includes(mode))throw Error('This app is not assigned to you at this restaurant');
  if(mode==='CDS'&&!devices.some(x=>x.id===posDeviceId))throw Error('Choose a point of sale');
  const device={installationId:installationId.current,tenantId:location.tenantId,locationId,mode,station:'Expo',posDeviceId:mode==='CDS'?posDeviceId:null};
  const registered=await registerDevice({token:accountToken.current,accountId:accountId.current,expiresAt:sessionExpiresAt.current,device});await open(registered);accountToken.current='';
 }catch(e){setError(e.message);}finally{setBusy(false);}};
 const switchApp=async()=>{setShowDeviceMenu(false);setBusy(true);setError('');try{
  const choices=await request(AUTH+'/locations',saved.token);
  accountToken.current=saved.token;accountId.current=saved.accountId;
  sessionExpiresAt.current=saved.expiresAt;setLocations(choices);
  const location=choices.find(x=>x.id===saved.device.locationId)||(choices.length===1?choices[0]:null);
  const modes=modesFor(location);setLocationId(location?.id||'');setMode(modes.includes(saved.device.mode)?saved.device.mode:modes[0]||'POS');setScreen('setup');
 }catch(error){if(error.status===401||error.status===403)await revoke('Your session has ended. Sign in again.');else setError(error.message);}finally{setBusy(false);}};
 const logout=async()=>{setBusy(true);setError('');try{await request(AUTH+'/logout',saved.token,{});await revoke('Signed out.');}catch(error){setError('Connect to sign out of your account.');}finally{setBusy(false);}};
 const retry=async()=>{setBusy(true);setError('');try{const me=await request(AUTH+'/me',saved.token);if(me.mustChangeCredential){await revoke('Sign in to change your temporary credential.');return}setStaffSession(me.operationalOnly===true||!dashboardAllowed(me));await open(saved);setReconnecting(false);}catch(e){if(e.status===401||e.status===403)await revoke('Your session has ended. Sign in again.');else setError('Customli is still reconnecting.');}finally{setBusy(false);}};
 if(screen==='mode'&&saved){const device=saved.device;return <div className={styles.operating}><div className={styles.deviceMenu}><button type="button" aria-label="Device settings" aria-expanded={showDeviceMenu} onClick={()=>setShowDeviceMenu(v=>!v)}>⚙</button>{showDeviceMenu&&<nav aria-label="Device settings">{device.mode==='POS'&&<button onClick={()=>{setPrinterAction(true);setShowDeviceMenu(false);document.querySelector('iframe[title="Point of sale"]')?.contentWindow?.postMessage({type:'customli:printer-setup'},window.location.origin)}}>Printer settings</button>}<button onClick={switchApp} disabled={busy}>Home / Switch app</button><button onClick={openDashboard} disabled={busy}>Dashboard ↗</button><button onClick={logout} disabled={busy}>Sign out</button></nav>}</div>{printerAction&&device.mode!=='POS'&&<div className={styles.connection}><button onClick={switchApp}>Choose POS for printer setup</button></div>}{nearby.length>0&&device.mode!=='CDS'&&<div className={styles.discovery}>{nearby.length} nearby registered {nearby.length===1?'device':'devices'}</div>}{reconnecting&&device.mode!=='CDS'&&<div className={styles.connection}>Reconnecting to Customli</div>}{device.mode==='CDS'?<CustomerDisplay token={saved.token} device={device}/>:<iframe key={device.mode+':'+(device.station||'')} title={device.mode==='POS'?'Point of sale':'Kitchen display'} src={device.mode==='POS'?'./pos/index.html':'./kds/index.html'} className={styles.frame}/>}</div>;}
 if(screen==='first-login'&&firstLogin){
  const isPin=firstLogin.credentialType==='pin';
  const label=isPin?'PIN':'password';
  const rotate=async e=>{
   e.preventDefault();
   if(newPin!==confirmPin||newPin===oldPin){setPinError('Choose a new '+label+' and confirm it.');return}
   setBusy(true);setPinError('');
   try{
    await request(AUTH+(isPin?'/profile/pin':'/profile/password'),firstLogin.token,isPin?{currentPin:oldPin,pin:newPin}:{currentPassword:oldPin,password:newPin});
    setOldPin('');setNewPin('');setConfirmPin('');setFirstLogin(null);
    try{await signIn({...firstLogin,mustChangeCredential:false});}
    catch(error){setError(error.message);setScreen('login');}
   }catch(error){setPinError(error.message)}finally{setBusy(false)}
  };
  return <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-label={'Set your '+label}><div className={styles.modalCard}>
   <h2>Set your {label}</h2><p>{isPin?'Enter a new six-digit PIN to continue.':'Set a new password to continue.'}</p>
   <form onSubmit={rotate}><label>New {label}<input type="password" autoComplete="new-password" required inputMode={isPin?'numeric':undefined} pattern={isPin?'[0-9]{6}':undefined} maxLength={isPin?6:128} value={newPin} onChange={e=>setNewPin(e.target.value)}/></label>
   <label>Confirm {label}<input type="password" autoComplete="new-password" required maxLength={isPin?6:128} value={confirmPin} onChange={e=>setConfirmPin(e.target.value)}/></label>
   {pinError&&<p role="alert">{pinError}</p>}<button type="submit" disabled={busy}>{busy?'Saving…':'Save '+label}</button></form></div></div>;
 }
 if(screen==='login')return <DashboardLogin onLogin={signIn} call={(path,body)=>request(AUTH+path,'',body)} sessionMessage={error}/>;
 if(screen==='setup')return <main className={styles.launcher}>
 <aside className={styles.launchSidebar}><div className={styles.launchBrand}><img src="./brand/customli-login-logo.svg" alt="Customli"/><strong>Customli</strong></div><nav aria-label="Application navigation"><button className={launcherTab==='home'?styles.selected:''} onClick={()=>setLauncherTab('home')}>Home</button>{!staffSession&&<button onClick={openDashboard}>Dashboard <span>↗</span></button>}<button className={launcherTab==='printer'?styles.selected:''} onClick={()=>setLauncherTab('printer')}>Printer setup</button><button onClick={openSupport}>Support <span>↗</span></button></nav><div className={styles.launchFooter}><button onClick={logout} disabled={busy}>Sign out</button><small>Customli {VERSION}</small></div></aside>
 <section className={styles.launchContent}><header className={styles.launchHeader}><div><span className={styles.eyebrow}>YOUR WORKSPACE</span><h1>{launcherTab==='home'?'Welcome to Customli':'Printer setup'}</h1><p>{launcherTab==='home'?'Select a restaurant and open the application for this device.':'Connect and manage your receipt printers from the POS settings.'}</p></div><img src="./brand/customli-login-logo.svg" alt=""/></header>
 {launcherTab==='home'?<><div className={styles.launchTiles}>{!staffSession&&<button type="button" onClick={openDashboard}><strong>Dashboard</strong><span>Reporting, menus and restaurant settings</span><em>Open in browser ↗</em></button>}<button type="button" disabled={!availableModes.includes('POS')} onClick={()=>setMode('POS')} className={mode==='POS'?styles.activeTile:''}><strong>Point of sale</strong><span>Orders, payments and receipts</span><em>Choose POS</em></button><button type="button" disabled={!availableModes.includes('KDS')} onClick={()=>setMode('KDS')} className={mode==='KDS'?styles.activeTile:''}><strong>Kitchen display</strong><span>Live kitchen order management</span><em>Choose KDS</em></button><button type="button" disabled={!availableModes.includes('CDS')} onClick={()=>setMode('CDS')} className={mode==='CDS'?styles.activeTile:''}><strong>Customer display</strong><span>Customer-facing order status</span><em>Choose CDS</em></button></div>
 <form className={styles.launchForm} onSubmit={choose}><h2>Open on this device</h2><div className={styles.launchFields}><label>Restaurant<Select aria-label="Restaurant" value={locationId} onChange={e=>changeLocation(e.target.value)} required><option value="">Choose restaurant</option>{locations.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</Select></label><label>Application<Select aria-label="Use this device for" value={mode} onChange={e=>setMode(e.target.value)}><option value="POS" disabled={!availableModes.includes('POS')}>Point of sale</option><option value="KDS" disabled={!availableModes.includes('KDS')}>Kitchen display</option><option value="CDS" disabled={!availableModes.includes('CDS')}>Customer display</option></Select></label>{mode==='CDS'&&<label>Point of sale<Select aria-label="Point of sale" value={posDeviceId} onChange={e=>setPosDeviceId(e.target.value)} required><option value="">Choose point of sale</option>{devices.map(x=><option key={x.id} value={x.id}>{x.id}</option>)}</Select></label>}</div><button className={styles.launchPrimary} disabled={busy||!locationId||!availableModes.includes(mode)||(mode==='CDS'&&!posDeviceId)}>{busy?'Opening…':'Open application →'}</button></form></>:<div className={styles.launchForm}><h2>Receipt printers</h2><p>Open Point of sale, then choose Settings → Bluetooth printer to discover, test and assign a printer.</p><button className={styles.launchPrimary} onClick={()=>{setLauncherTab('home');setMode('POS')}}>Set up POS printer →</button></div>}
 {error&&<p className={styles.error} role="alert">{error}</p>}</section></main>;
 return <main className={styles.setup}><section className={styles.card}><img className={styles.logo} src="./brand/customli-login-logo.svg" alt="Customli"/>{screen==='loading'?<p>Opening Customli…</p>:screen==='connection'?<><h1>Connect to continue</h1><button disabled={busy} onClick={retry}>{busy?'Reconnecting…':'Try again'}</button></>:<h1>Android setup required</h1>}{error&&<p className={styles.error} role="alert">{error}</p>}<small>Customli {VERSION}</small></section></main>;
}
createRoot(document.querySelector('#app')).render(<App/>);
