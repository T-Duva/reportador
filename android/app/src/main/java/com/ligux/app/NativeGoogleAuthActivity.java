package com.ligux.app;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;
import com.google.android.gms.tasks.Task;

/**
 * Native Google account picker + server auth code (no browser / Custom Tabs).
 */
public class NativeGoogleAuthActivity extends Activity {
    private static final int RC_SIGN_IN = 9002;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        String webClientId = getIntent().getStringExtra("webClientId");
        String[] scopes = getIntent().getStringArrayExtra("scopes");
        if (webClientId == null || webClientId.isEmpty()) {
            finishWith(null, null, "Falta webClientId");
            return;
        }

        GoogleSignInOptions.Builder builder = new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                .requestEmail()
                .requestServerAuthCode(webClientId, true);

        if (scopes != null) {
            for (String scope : scopes) {
                if (scope != null && !scope.isEmpty()) {
                    builder.requestScopes(new Scope(scope));
                }
            }
        }

        GoogleSignInClient client = GoogleSignIn.getClient(this, builder.build());
        client.signOut().addOnCompleteListener(this, task ->
                startActivityForResult(client.getSignInIntent(), RC_SIGN_IN));
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != RC_SIGN_IN) return;

        Task<GoogleSignInAccount> task = GoogleSignIn.getSignedInAccountFromIntent(data);
        try {
            GoogleSignInAccount account = task.getResult(ApiException.class);
            String code = account.getServerAuthCode();
            if (code == null || code.isEmpty()) {
                finishWith(null, account.getEmail(), "No se recibió código de Google");
                return;
            }
            finishWith(code, account.getEmail(), null);
        } catch (ApiException e) {
            String msg;
            if (e.getStatusCode() == 12501) {
                msg = "cancelado";
            } else if (e.getStatusCode() == 10) {
                msg = "Error 10: falta cliente OAuth Android en Cloud (com.ligux.app + SHA-1 del APK)";
            } else {
                msg = "Error " + e.getStatusCode() + ": " + e.getMessage();
            }
            finishWith(null, null, msg);
        }
    }

    private void finishWith(String code, String email, String error) {
        Intent data = new Intent();
        if (code != null) data.putExtra("code", code);
        if (email != null) data.putExtra("email", email);
        if (error != null) data.putExtra("error", error);
        data.putExtra("redirectUri", "");
        setResult(code != null ? RESULT_OK : RESULT_CANCELED, data);
        finish();
    }
}
