package io.customli.pos;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  protected void onNewIntent(android.content.Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    if (getBridge() != null) getBridge().triggerWindowJSEvent("customli:launch", "{}");
  }

  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(ThermalPrinterPlugin.class);
    registerPlugin(DeviceIdentityPlugin.class);
    registerPlugin(DeviceDiscoveryPlugin.class);
    registerPlugin(ExternalNavigationPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
