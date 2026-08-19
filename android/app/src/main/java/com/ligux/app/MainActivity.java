package com.ligux.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PhoneOpenPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
