package com.storyforge.client;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(android.os.Bundle savedInstanceState) {
        ClientDiagnosticsPlugin.monitor(this);
        registerPlugin(ClientDiagnosticsPlugin.class);
        registerPlugin(StoryForgeHttpPlugin.class);
        registerPlugin(ClientUpdatePlugin.class);
        registerPlugin(StoryForgeFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
