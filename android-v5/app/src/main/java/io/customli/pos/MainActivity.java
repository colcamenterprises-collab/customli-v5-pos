package io.customli.pos;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(ThermalPrinterPlugin.class);
    registerPlugin(DeviceIdentityPlugin.class);
    registerPlugin(DeviceDiscoveryPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
