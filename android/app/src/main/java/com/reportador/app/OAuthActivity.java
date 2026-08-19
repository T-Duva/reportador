package com.reportador.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import androidx.browser.customtabs.CustomTabsIntent;

import java.io.IOException;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Opens Google OAuth in Chrome Custom Tabs with a loopback redirect.
 * A tiny HTTP server on localhost captures the auth code.
 * Requires an OAuth client of type "Desktop" (allows loopback automatically).
 */
public class OAuthActivity extends Activity {
    private ServerSocket server;
    private final AtomicBoolean done = new AtomicBoolean(false);
    private String usedRedirectUri;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        String url = getIntent().getStringExtra("url");
        if (url == null || url.isEmpty()) {
            finishWith(null, "Falta url");
            return;
        }

        try {
            server = new ServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress());
            int port = server.getLocalPort();

            usedRedirectUri = "http://127.0.0.1:" + port;
            String authUrl = replaceRedirect(url, usedRedirectUri);

            new Thread(this::waitForCode).start();

            CustomTabsIntent ct = new CustomTabsIntent.Builder().build();
            ct.launchUrl(this, Uri.parse(authUrl));
        } catch (IOException e) {
            finishWith(null, "No se abrió el login: " + e.getMessage());
        }
    }

    private String replaceRedirect(String url, String newRedirect) {
        String encoded = Uri.encode(newRedirect);
        return url.replaceFirst("redirect_uri=[^&]+", "redirect_uri=" + encoded);
    }

    private void waitForCode() {
        try {
            server.setSoTimeout(300_000);
            Socket sock = server.accept();
            byte[] buf = new byte[4096];
            int n = sock.getInputStream().read(buf);
            String req = new String(buf, 0, n, StandardCharsets.UTF_8);

            String code = null;
            String error = null;
            String firstLine = req.split("\r?\n")[0];
            String path = firstLine.split(" ")[1];
            if (path.contains("?")) {
                String query = path.substring(path.indexOf('?') + 1);
                for (String param : query.split("&")) {
                    String[] kv = param.split("=", 2);
                    String key = kv[0];
                    String val = kv.length > 1 ? URLDecoder.decode(kv[1], "UTF-8") : "";
                    if ("code".equals(key)) code = val;
                    if ("error".equals(key)) error = val;
                }
            }

            String html;
            if (code != null) {
                html = "<html><body style='font-family:sans-serif;text-align:center;padding:40px'>"
                        + "<h2>&#10004; Listo</h2><p>Ya podés cerrar esta pestaña y volver a LIGUX.</p></body></html>";
            } else {
                html = "<html><body style='font-family:sans-serif;text-align:center;padding:40px'>"
                        + "<h2>&#10008; Error</h2><p>" + (error != null ? error : "No se recibió el código") + "</p></body></html>";
            }

            String response = "HTTP/1.1 200 OK\r\n"
                    + "Content-Type: text/html; charset=utf-8\r\n"
                    + "Connection: close\r\n"
                    + "\r\n" + html;
            OutputStream out = sock.getOutputStream();
            out.write(response.getBytes(StandardCharsets.UTF_8));
            out.flush();
            sock.close();

            final String c = code;
            final String e = error;
            runOnUiThread(() -> finishWith(c, e));
        } catch (Exception e) {
            if (!done.get()) {
                runOnUiThread(() -> finishWith(null, "Timeout o error: " + e.getMessage()));
            }
        } finally {
            closeServer();
        }
    }

    private void closeServer() {
        try {
            if (server != null && !server.isClosed()) server.close();
        } catch (IOException ignored) {}
    }

    private void finishWith(String code, String error) {
        if (!done.compareAndSet(false, true)) return;
        closeServer();
        Intent data = new Intent();
        if (code != null) data.putExtra("code", code);
        if (error != null) data.putExtra("error", error);
        if (usedRedirectUri != null) data.putExtra("redirectUri", usedRedirectUri);
        setResult(code != null ? RESULT_OK : RESULT_CANCELED, data);
        finish();
    }

    private boolean launched = false;

    @Override
    protected void onResume() {
        super.onResume();
        if (launched && !done.get()) {
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                if (!done.get()) finishWith(null, "cancelado");
            }, 1500);
        }
        launched = true;
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        closeServer();
    }
}
