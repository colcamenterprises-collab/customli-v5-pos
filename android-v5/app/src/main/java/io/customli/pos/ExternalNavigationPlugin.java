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
      String code = call.getString("handoffCode");
      if (code == null || !code.matches("[A-Za-z0-9_-]{40,64}")) { call.reject("A valid signed-in Dashboard handoff is required."); return; }
      Uri dashboard = Uri.parse(getContext().getString(R.string.customli_dashboard_url));
      Uri target = dashboard.buildUpon().appendQueryParameter("handoff", code).build();
      Intent intent = new Intent(Intent.ACTION_VIEW, target);
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
