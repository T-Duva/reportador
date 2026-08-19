package com.ligux.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(name = "PhoneOpen")
public class PhoneOpenPlugin extends Plugin {

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("Falta url");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()));
        }
    }

    @PluginMethod
    public void openAuth(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("Falta url");
            return;
        }
        Intent i = new Intent(getContext(), OAuthActivity.class);
        i.putExtra("url", url);
        startActivityForResult(call, i, "onAuthResult");
    }

    @PluginMethod
    public void openNativeGoogleAuth(PluginCall call) {
        String webClientId = call.getString("webClientId");
        if (webClientId == null || webClientId.isEmpty()) {
            call.reject("Falta webClientId");
            return;
        }
        String[] scopes = null;
        JSArray scopesArr = call.getArray("scopes");
        if (scopesArr != null) {
            scopes = new String[scopesArr.length()];
            for (int i = 0; i < scopesArr.length(); i++) {
                scopes[i] = scopesArr.optString(i, "");
            }
        }
        Intent i = new Intent(getContext(), NativeGoogleAuthActivity.class);
        i.putExtra("webClientId", webClientId);
        if (scopes != null) i.putExtra("scopes", scopes);
        startActivityForResult(call, i, "onNativeAuthResult");
    }

    @ActivityCallback
    private void onNativeAuthResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() == Activity.RESULT_OK && data != null) {
            String code = data.getStringExtra("code");
            String redirectUri = data.getStringExtra("redirectUri");
            String email = data.getStringExtra("email");
            JSObject ret = new JSObject();
            ret.put("code", code);
            if (redirectUri != null) ret.put("redirectUri", redirectUri);
            if (email != null) ret.put("email", email);
            call.resolve(ret);
            return;
        }
        String err = data != null ? data.getStringExtra("error") : "cancelado";
        call.reject(err == null ? "cancelado" : err);
    }

    @ActivityCallback
    private void onAuthResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() == Activity.RESULT_OK && data != null) {
            String code = data.getStringExtra("code");
            String redirectUri = data.getStringExtra("redirectUri");
            JSObject ret = new JSObject();
            ret.put("code", code);
            if (redirectUri != null) ret.put("redirectUri", redirectUri);
            call.resolve(ret);
            return;
        }
        String err = data != null ? data.getStringExtra("error") : "cancelado";
        call.reject(err == null ? "cancelado" : err);
    }

    @PluginMethod
    public void installApk(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("Falta url");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getContext().getPackageManager().canRequestPackageInstalls()) {
            try {
                Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                s.setData(Uri.parse("package:" + getContext().getPackageName()));
                s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(s);
            } catch (Exception ignored) {
                /* seguir igual */
            }
        }
        new Thread(() -> {
            File out = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "ligux-update.apk");
            try {
                File dir = out.getParentFile();
                if (dir != null) dir.mkdirs();
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setInstanceFollowRedirects(true);
                c.setConnectTimeout(20000);
                c.setReadTimeout(60000);
                c.connect();
                int code = c.getResponseCode();
                if (code >= 400) {
                    call.reject("No se bajó el APK (" + code + ")");
                    return;
                }
                try (InputStream in = c.getInputStream(); FileOutputStream fos = new FileOutputStream(out)) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) > 0) fos.write(buf, 0, n);
                }
                Uri uri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    out
                );
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(uri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                call.resolve();
            } catch (Exception e) {
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(intent);
                    call.resolve();
                } catch (Exception e2) {
                    call.reject(String.valueOf(e.getMessage()));
                }
            }
        }).start();
    }
}
