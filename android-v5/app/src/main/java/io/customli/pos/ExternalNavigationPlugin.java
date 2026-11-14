package io.customli.pos;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ExternalNavigation")
public class ExternalNavigationPlugin extends Plugin {
  @PluginMethod
  public void openDashboard(PluginCall call) {
    try {
      Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("https://customli.io/v5-dashboard/"));
      intent.addCategory(Intent.CATEGORY_BROWSABLE);
      getActivity().startActivity(intent);
      call.resolve();
    } catch (Exception e) { call.reject("No browser is available to open the dashboard."); }
  }
  @PluginMethod
  public void openSupport(PluginCall call) {
    try {
      Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("https://customli.io/"));
      intent.addCategory(Intent.CATEGORY_BROWSABLE);
      getActivity().startActivity(intent);
      call.resolve();
    } catch (Exception e) { call.reject("No browser is available to open support."); }
  }
}
