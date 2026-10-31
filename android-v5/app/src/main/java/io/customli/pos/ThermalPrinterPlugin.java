package io.customli.pos;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.BroadcastReceiver;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Handler;
import android.os.Looper;
import androidx.core.content.ContextCompat;
import android.content.pm.PackageManager;
import android.os.Build;
import android.speech.tts.TextToSpeech;
import android.util.Base64;
import androidx.core.app.ActivityCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.IOException;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

@CapacitorPlugin(name="ThermalPrinter", permissions={@Permission(alias="bluetooth", strings={Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN})})
public class ThermalPrinterPlugin extends Plugin {
  private static final UUID SPP_UUID=UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
  private static final byte[] ESC_POS_RESET=new byte[]{0x1B,0x40};
  private BluetoothSocket socket; private BluetoothDevice connectedDevice; private String connectionMethod=""; private TextToSpeech textToSpeech; private volatile boolean textToSpeechReady=false;
  @Override public void load(){super.load();textToSpeech=new TextToSpeech(getContext(),status->{if(status==TextToSpeech.SUCCESS){textToSpeechReady=true;textToSpeech.setLanguage(Locale.US);}});}
  private BluetoothAdapter adapter(){BluetoothManager m=(BluetoothManager)getContext().getSystemService(Context.BLUETOOTH_SERVICE);return m==null?null:m.getAdapter();}
  private boolean hasBluetoothPermission(){return Build.VERSION.SDK_INT<Build.VERSION_CODES.S||(ActivityCompat.checkSelfPermission(getContext(),Manifest.permission.BLUETOOTH_CONNECT)==PackageManager.PERMISSION_GRANTED&&ActivityCompat.checkSelfPermission(getContext(),Manifest.permission.BLUETOOTH_SCAN)==PackageManager.PERMISSION_GRANTED);}
  private BluetoothAdapter requireBluetooth(PluginCall call){BluetoothAdapter a=adapter();if(a==null){call.reject("Bluetooth is not supported on this tablet");return null;}if(!a.isEnabled()){call.reject("Bluetooth is turned off");return null;}return a;}
  @PluginMethod public void listPrinters(PluginCall call){BluetoothAdapter a=requireBluetooth(call);if(a==null)return;if(!hasBluetoothPermission()){requestPermissionForAlias("bluetooth",call,"listPermissionCallback");return;}listPrintersGranted(call,a);}
  @PermissionCallback private void listPermissionCallback(PluginCall call){BluetoothAdapter a=requireBluetooth(call);if(a==null)return;if(!hasBluetoothPermission()){call.reject("Nearby devices permission was not granted. Allow Nearby devices for Customli POS in Android Settings.");return;}listPrintersGranted(call,a);}
  private void listPrintersGranted(PluginCall call,BluetoothAdapter a){try{Set<BluetoothDevice> bonded=a.getBondedDevices();List<BluetoothDevice> devices=new ArrayList<>(bonded);devices.sort(Comparator.comparing(d->{String n=d.getName();return n==null?d.getAddress():n;}));JSArray result=new JSArray();for(BluetoothDevice d:devices){JSObject item=new JSObject();item.put("name",d.getName()==null?"Bluetooth printer":d.getName());item.put("address",d.getAddress());item.put("bonded",d.getBondState()==BluetoothDevice.BOND_BONDED);result.put(item);}JSObject ret=new JSObject();ret.put("printers",result);ret.put("permissionGranted",true);call.resolve(ret);}catch(Exception e){call.reject("Could not list paired Bluetooth devices",e);}}
  // Nearby Bluetooth Classic discovery. Android requires Nearby Devices permission;
  // previously paired devices are listed even when the printer is not discoverable.
  @PluginMethod public void scanPrinters(PluginCall call){
    BluetoothAdapter a=requireBluetooth(call);if(a==null)return;
    if(!hasBluetoothPermission()){requestPermissionForAlias("bluetooth",call,"scanPermissionCallback");return;}
    scanGranted(call,a);
  }
  @PermissionCallback private void scanPermissionCallback(PluginCall call){
    BluetoothAdapter a=requireBluetooth(call);if(a==null)return;
    if(!hasBluetoothPermission()){call.reject("Allow Nearby devices to find Bluetooth printers.");return;}
    scanGranted(call,a);
  }
  private void scanGranted(PluginCall call,BluetoothAdapter adapter){
    final java.util.Map<String,BluetoothDevice> found=new java.util.concurrent.ConcurrentHashMap<>();
    try{
      for(BluetoothDevice device:adapter.getBondedDevices())found.put(device.getAddress(),device);
      adapter.cancelDiscovery();
      final boolean[] completed={false};
      final BroadcastReceiver receiver=new BroadcastReceiver(){
        @Override public void onReceive(Context ctx,Intent intent){
          if(BluetoothDevice.ACTION_FOUND.equals(intent.getAction())){
            BluetoothDevice device=Build.VERSION.SDK_INT>=33?intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE,BluetoothDevice.class):intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
            if(device!=null)found.put(device.getAddress(),device);
          }else if(BluetoothAdapter.ACTION_DISCOVERY_FINISHED.equals(intent.getAction()))finish();
        }
        private void finish(){
          if(completed[0])return;completed[0]=true;
          try{getContext().unregisterReceiver(this);}catch(Exception ignored){}
          JSArray printers=new JSArray();
          java.util.List<BluetoothDevice> devices=new java.util.ArrayList<>(found.values());
          devices.sort(java.util.Comparator.comparing(BluetoothDevice::getAddress));
          for(BluetoothDevice device:devices){
            JSObject row=new JSObject();
            row.put("address",device.getAddress());row.put("name",device.getName()==null?"Bluetooth device":device.getName());
            row.put("bonded",device.getBondState()==BluetoothDevice.BOND_BONDED);printers.put(row);
          }
          JSObject result=new JSObject();result.put("printers",printers);call.resolve(result);
        }
      };
      IntentFilter filter=new IntentFilter();
      filter.addAction(BluetoothDevice.ACTION_FOUND);filter.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED);
      ContextCompat.registerReceiver(getContext(),receiver,filter,ContextCompat.RECEIVER_EXPORTED);
      if(!adapter.startDiscovery()){
        if(!completed[0]){completed[0]=true;getContext().unregisterReceiver(receiver);call.reject("Bluetooth scan could not start. Make the printer discoverable and try again.");}
        return;
      }
      new Handler(Looper.getMainLooper()).postDelayed(()->{
        if(completed[0])return;
        try{adapter.cancelDiscovery();}catch(Exception ignored){}
        // A discovery-finished broadcast may arrive later; this prevents indefinite spinner.
        // If the callback is not triggered, the UI will retry.
        new Handler(Looper.getMainLooper()).postDelayed(()->{
          if(completed[0])return;completed[0]=true;
          try{getContext().unregisterReceiver(receiver);}catch(Exception ignored){}
          JSArray printers=new JSArray();
          for(BluetoothDevice dev:found.values()){
            JSObject row=new JSObject();row.put("address",dev.getAddress());row.put("name",dev.getName()==null?"Bluetooth device":dev.getName());row.put("bonded",dev.getBondState()==BluetoothDevice.BOND_BONDED);printers.put(row);
          }
          JSObject result=new JSObject();result.put("printers",printers);call.resolve(result);
        },900);
      },9000);
    }catch(Exception e){call.reject("Could not scan Bluetooth devices: "+rootMessage(e),e);}
  }
  @PluginMethod public void pairPrinter(PluginCall call){
    BluetoothAdapter a=requireBluetooth(call);if(a==null)return;
    if(!hasBluetoothPermission()){requestPermissionForAlias("bluetooth",call,"pairPermissionCallback");return;}
    pairGranted(call,a);
  }
  @PermissionCallback private void pairPermissionCallback(PluginCall call){
    BluetoothAdapter a=requireBluetooth(call);if(a==null)return;
    if(!hasBluetoothPermission()){call.reject("Allow Nearby devices to pair with the printer.");return;}
    pairGranted(call,a);
  }
  private void pairGranted(PluginCall call,BluetoothAdapter adapter){
    final String address=call.getString("address");
    if(address==null||!android.bluetooth.BluetoothAdapter.checkBluetoothAddress(address)){call.reject("Choose a valid Bluetooth address.");return;}
    try{
      BluetoothDevice device=adapter.getRemoteDevice(address);
      if(device.getBondState()==BluetoothDevice.BOND_BONDED){JSObject r=new JSObject();r.put("bonded",true);call.resolve(r);return;}
      if(!device.createBond()){call.reject("Android did not start printer pairing.");return;}
      JSObject r=new JSObject();r.put("pairingStarted",true);call.resolve(r);
    }catch(Exception e){call.reject("Could not request Bluetooth pairing: "+rootMessage(e),e);}
  }
  @PluginMethod public void connect(PluginCall call){BluetoothAdapter a=requireBluetooth(call);if(a==null)return;if(!hasBluetoothPermission()){requestPermissionForAlias("bluetooth",call,"connectPermissionCallback");return;}connectGranted(call,a);}
  @PermissionCallback private void connectPermissionCallback(PluginCall call){BluetoothAdapter a=requireBluetooth(call);if(a==null)return;if(!hasBluetoothPermission()){call.reject("Nearby devices permission was not granted. Allow Nearby devices for Customli POS in Android Settings.");return;}connectGranted(call,a);}
  private void connectGranted(PluginCall call,BluetoothAdapter a){String address=call.getString("address");if(address==null||address.trim().isEmpty()){call.reject("Printer address is required");return;}new Thread(()->{try{disconnectInternal();BluetoothDevice d=a.getRemoteDevice(address.trim());if(d.getBondState()!=BluetoothDevice.BOND_BONDED){call.reject("The selected printer is not paired in Android Bluetooth settings");return;}a.cancelDiscovery();List<String> errors=new ArrayList<>();BluetoothSocket active=null;String activeMethod="";for(String methodName:new String[]{"secure SPP","insecure SPP","RFCOMM channel 1"}){BluetoothSocket candidate=null;try{if("secure SPP".equals(methodName))candidate=d.createRfcommSocketToServiceRecord(SPP_UUID);else if("insecure SPP".equals(methodName))candidate=d.createInsecureRfcommSocketToServiceRecord(SPP_UUID);else{Method method=d.getClass().getMethod("createRfcommSocket",int.class);method.setAccessible(true);candidate=(BluetoothSocket)method.invoke(d,1);}candidate.connect();try{Thread.sleep(180);}catch(InterruptedException ignored){Thread.currentThread().interrupt();}OutputStream probe=candidate.getOutputStream();probe.write(ESC_POS_RESET);probe.flush();active=candidate;activeMethod=methodName;break;}catch(Exception e){errors.add(methodName+": "+rootMessage(e));try{if(candidate!=null)candidate.close();}catch(Exception ignored){}}}if(active==null||!active.isConnected()){call.reject("Could not establish a writable Bluetooth printer connection. "+String.join(" | ",errors));return;}socket=active;connectedDevice=d;connectionMethod=activeMethod;JSObject ret=new JSObject();ret.put("connected",true);ret.put("name",d.getName()==null?"Bluetooth printer":d.getName());ret.put("address",d.getAddress());ret.put("connectionMethod",activeMethod);call.resolve(ret);}catch(Exception e){disconnectInternal();call.reject("Could not connect to Bluetooth printer: "+rootMessage(e),e);}}).start();}
  @PluginMethod public void disconnect(PluginCall call){disconnectInternal();JSObject ret=new JSObject();ret.put("connected",false);call.resolve(ret);}
  @PluginMethod public void getStatus(PluginCall call){JSObject ret=new JSObject();boolean active=socket!=null&&socket.isConnected();BluetoothAdapter a=adapter();ret.put("connected",active);ret.put("bridgeOpen",true);ret.put("bluetoothSupported",a!=null);ret.put("bluetoothEnabled",a!=null&&a.isEnabled());ret.put("permissionGranted",hasBluetoothPermission());ret.put("textToSpeechReady",textToSpeechReady);if(active&&connectedDevice!=null){ret.put("name",connectedDevice.getName()==null?"Bluetooth printer":connectedDevice.getName());ret.put("address",connectedDevice.getAddress());ret.put("connectionMethod",connectionMethod);}call.resolve(ret);}
  @PluginMethod public void speak(PluginCall call){String value=call.getString("text");if(value==null||value.trim().isEmpty()){call.reject("Speech text is required");return;}if(textToSpeech==null||!textToSpeechReady){call.reject("Android text to speech is not ready");return;}String language=call.getString("language","en-US");textToSpeech.setLanguage(language.toLowerCase().startsWith("th")?new Locale("th","TH"):Locale.US);int result=textToSpeech.speak(value,TextToSpeech.QUEUE_FLUSH,null,"customli-pos-order");if(result==TextToSpeech.ERROR){call.reject("Android text to speech could not start");return;}JSObject ret=new JSObject();ret.put("ok",true);call.resolve(ret);}
  @PluginMethod public void printRaw(PluginCall call){String encoded=call.getString("base64");if(encoded==null||encoded.isEmpty()){call.reject("Print data is required");return;}try{write(call,Base64.decode(encoded,Base64.DEFAULT));}catch(Exception e){call.reject("Print data is invalid",e);}}
  @PluginMethod public void printTest(PluginCall call){write(call,("\u001b@\u001ba\u0001CUSTOMLI POS\nBLUETOOTH PRINTER TEST\n\u001ba\u0000\nESC/POS DIRECT CONNECTION\n\n\n").getBytes(java.nio.charset.StandardCharsets.US_ASCII));}
  @PluginMethod public void openCashDrawer(PluginCall call){write(call,new byte[]{0x1B,0x70,0x00,0x32,(byte)0xFA});}
  private void write(PluginCall call,byte[] bytes){new Thread(()->{try{BluetoothSocket active=socket;if(active==null||!active.isConnected()){call.reject("Printer is not connected");return;}OutputStream output=active.getOutputStream();for(int offset=0;offset<bytes.length;offset+=512){output.write(bytes,offset,Math.min(512,bytes.length-offset));if(bytes.length>2048){try{Thread.sleep(4);}catch(InterruptedException ex){Thread.currentThread().interrupt();throw new IOException("Printer write interrupted");}}}output.flush();JSObject ret=new JSObject();ret.put("ok",true);ret.put("connectionMethod",connectionMethod);call.resolve(ret);}catch(IOException e){String method=connectionMethod;disconnectInternal();call.reject("Printer connection was lost using "+(method.isEmpty()?"Bluetooth":method)+": "+rootMessage(e),e);}catch(Exception e){disconnectInternal();call.reject("Printer command failed: "+rootMessage(e),e);}}).start();}
  private String rootMessage(Throwable error){Throwable current=error;while(current.getCause()!=null&&current.getCause()!=current)current=current.getCause();String message=current.getMessage();return message==null||message.trim().isEmpty()?current.getClass().getSimpleName():message;}
  private void disconnectInternal(){try{if(socket!=null)socket.close();}catch(Exception ignored){}socket=null;connectedDevice=null;connectionMethod="";}
  @Override protected void handleOnDestroy(){disconnectInternal();if(textToSpeech!=null){textToSpeech.stop();textToSpeech.shutdown();textToSpeech=null;}textToSpeechReady=false;super.handleOnDestroy();}
}
