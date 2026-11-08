package io.customli.pos;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.LinkedHashMap;
import java.util.Map;

/** Presence metadata only. NSD never authenticates peers or carries orders/payments. */
@CapacitorPlugin(name = "DeviceDiscovery")
public class DeviceDiscoveryPlugin extends Plugin {
    private static final String TYPE = "_customli._tcp.";
    private NsdManager manager;
    private NsdManager.RegistrationListener registration;
    private NsdManager.DiscoveryListener discovery;
    private ServerSocket presence;
    private PluginCall pending;
    private final Map<String, JSObject> found = new LinkedHashMap<>();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private String deviceId;
    private NsdManager manager() {
        if (manager == null) manager = (NsdManager) getContext().getSystemService(Context.NSD_SERVICE);
        return manager;
    }
    @PluginMethod
    public void start(PluginCall call) {
        String requestedId = call.getString("deviceId", "");
        if (!requestedId.matches("[a-zA-Z0-9_-]{1,100}")) {
            call.reject("Device identity is required.", "DISCOVERY_ID");
            return;
        }
        if (requestedId.equals(deviceId) && registration != null) { call.resolve(); return; }
        stopAdvertising();
        try {
            deviceId = requestedId;
            // The presence socket intentionally accepts no application commands.
            presence = new ServerSocket(0);
            final ServerSocket socket = presence;
            Thread responder = new Thread(() -> {
                while (!socket.isClosed()) {
                    try (Socket ignored = socket.accept()) { } catch (Exception ignored) { break; }
                }
            }, "customli-presence");
            responder.setDaemon(true);
            responder.start();
            NsdServiceInfo service = new NsdServiceInfo();
            service.setServiceName("customli-" + deviceId);
            service.setServiceType(TYPE);
            service.setPort(presence.getLocalPort());
            service.setAttribute("deviceId", deviceId);
            registration = new NsdManager.RegistrationListener() {
                public void onServiceRegistered(NsdServiceInfo info) { }
                public void onRegistrationFailed(NsdServiceInfo info, int code) { if (registration == this) stopAdvertising(); }
                public void onServiceUnregistered(NsdServiceInfo info) { }
                public void onUnregistrationFailed(NsdServiceInfo info, int code) { }
            };
            manager().registerService(service, NsdManager.PROTOCOL_DNS_SD, registration);
            call.resolve();
        } catch (Exception error) {
            stopAdvertising();
            call.reject("Local device discovery is unavailable on this network.", "DISCOVERY_UNAVAILABLE");
        }
    }
    @PluginMethod
    public void discover(PluginCall call) {
        if (pending != null) { call.reject("Device discovery is already running.", "DISCOVERY_BUSY"); return; }
        pending = call;
        found.clear();
        discovery = new NsdManager.DiscoveryListener() {
            public void onDiscoveryStarted(String type) { }
            public void onDiscoveryStopped(String type) { }
            public void onStartDiscoveryFailed(String type, int code) { finish(false); }
            public void onStopDiscoveryFailed(String type, int code) { }
            public void onServiceLost(NsdServiceInfo info) { }
            public void onServiceFound(NsdServiceInfo info) {
                if (!info.getServiceName().startsWith("customli-")) return;
                manager().resolveService(info, new NsdManager.ResolveListener() {
                    public void onResolveFailed(NsdServiceInfo service, int code) { }
                    public void onServiceResolved(NsdServiceInfo service) {
                        byte[] raw = service.getAttributes().get("deviceId");
                        if (raw == null) return;
                        String id = new String(raw, java.nio.charset.StandardCharsets.UTF_8);
                        if (id.equals(deviceId) || !id.matches("[a-zA-Z0-9_-]{1,100}")) return;
                        JSObject candidate = new JSObject();
                        candidate.put("id", id);
                        candidate.put("authenticated", false);
                        synchronized (found) { found.put(id, candidate); }
                    }
                });
            }
        };
        try {
            manager().discoverServices(TYPE, NsdManager.PROTOCOL_DNS_SD, discovery);
            handler.postDelayed(() -> { if (pending == call) finish(true); }, 7000);
        } catch (Exception error) { finish(false); }
    }
    private void finish(boolean ok) {
        PluginCall call = pending;
        if (call == null) return;
        pending = null;
        try { manager().stopServiceDiscovery(discovery); } catch (Exception ignored) { }
        discovery = null;
        if (!ok) { call.reject("Local discovery is unavailable. Cloud connections can still be used.", "DISCOVERY_NETWORK"); return; }
        JSArray peers = new JSArray();
        synchronized (found) { for (JSObject item : found.values()) peers.put(item); }
        JSObject result = new JSObject();
        result.put("peers", peers);
        call.resolve(result);
    }
    private void stopAdvertising() {
        if (registration != null) { try { manager().unregisterService(registration); } catch (Exception ignored) { } registration = null; }
        if (presence != null) { try { presence.close(); } catch (Exception ignored) { } presence = null; }
        deviceId = null;
    }
    @PluginMethod
    public void stop(PluginCall call) { finish(false); stopAdvertising(); call.resolve(); }
    @Override
    protected void handleOnDestroy() { finish(false); stopAdvertising(); }
}
