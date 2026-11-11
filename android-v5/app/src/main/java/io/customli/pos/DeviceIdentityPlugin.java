package io.customli.pos;

import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Device credentials remain encrypted at rest and are excluded from Android backups. */
@CapacitorPlugin(name = "DeviceIdentity")
public class DeviceIdentityPlugin extends Plugin {
    private static final String ALIAS = "customli.v5.device.identity.v1";
    private SharedPreferences preferences() {
        return getContext().getSharedPreferences("customli_device", android.content.Context.MODE_PRIVATE);
    }
    private synchronized SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(ALIAS, null);
    }
    @PluginMethod
    public synchronized void read(PluginCall call) {
        try {
            SharedPreferences prefs = preferences();
            String installationId = prefs.getString("installationId", null);
            if (installationId == null) {
                installationId = UUID.randomUUID().toString();
                if (!prefs.edit().putString("installationId", installationId).commit()) throw new Exception("Storage unavailable");
            }
            JSObject result = new JSObject();
            result.put("installationId", installationId);
            String ciphertext = prefs.getString("credential", null);
            if (ciphertext != null) {
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(prefs.getString("iv", ""), Base64.NO_WRAP)));
                result.put("credential", new String(cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP)), StandardCharsets.UTF_8));
            }
            call.resolve(result);
        } catch (Exception error) {
            call.reject("This device could not read its saved setup. Contact Customli support.", "DEVICE_STORAGE_READ");
        }
    }
    @PluginMethod
    public synchronized void save(PluginCall call) {
        String credential = call.getString("credential");
        if (credential == null || credential.length() > 16384) {
            call.reject("Device setup could not be saved.", "DEVICE_STORAGE_INVALID");
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            String ciphertext = Base64.encodeToString(cipher.doFinal(credential.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
            if (!preferences().edit().putString("credential", ciphertext).putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)).commit()) throw new Exception("Storage unavailable");
            call.resolve();
        } catch (Exception error) {
            call.reject("Device setup could not be saved. Please try again.", "DEVICE_STORAGE_WRITE");
        }
    }
    @PluginMethod
    public synchronized void clear(PluginCall call) {
        if (!preferences().edit().remove("credential").remove("iv").commit()) {
            call.reject("Saved setup could not be removed.", "DEVICE_STORAGE_CLEAR");
            return;
        }
        call.resolve();
    }
}
