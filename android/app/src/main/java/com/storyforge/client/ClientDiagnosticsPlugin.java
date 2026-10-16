package com.storyforge.client;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/** Bounded technical summaries only: no exception text, traces, files or minidumps. */
@CapacitorPlugin(name = "ClientDiagnostics")
public class ClientDiagnosticsPlugin extends Plugin {
    private static boolean monitoring = false;
    static synchronized void monitor(Context context) {
        if (monitoring) return;
        monitoring = true;
        SharedPreferences preferences = context.getApplicationContext().getSharedPreferences("client-diagnostics", Context.MODE_PRIVATE);
        Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            try { preferences.edit().putLong("javaCrashAt", System.currentTimeMillis()).putString("javaCrashBuild", "v" + BuildConfig.VERSION_NAME + "+local").commit(); }
            finally {
                if (previous != null) previous.uncaughtException(thread, error);
                else android.os.Process.killProcess(android.os.Process.myPid());
            }
        });
    }
    private JSObject event(long time, String name, String build) {
        JSObject row = new JSObject();
        SimpleDateFormat date = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        date.setTimeZone(TimeZone.getTimeZone("UTC"));
        row.put("occurredAt", date.format(new Date(time)));
        row.put("source", "native"); row.put("name", name); row.put("build", build); row.put("frames", new JSArray());
        return row;
    }
    @PluginMethod public void read(PluginCall call) {
        long cutoff = System.currentTimeMillis() - 7L * 86400000;
        JSArray errors = new JSArray();
        SharedPreferences preferences = getContext().getSharedPreferences("client-diagnostics", Context.MODE_PRIVATE);
        long javaCrashAt = preferences.getLong("javaCrashAt", 0);
        if (javaCrashAt >= cutoff) errors.put(event(javaCrashAt, "NativeCrash", preferences.getString("javaCrashBuild", "unknown")));
        if (Build.VERSION.SDK_INT >= 30) {
            ActivityManager manager = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
            try {
                for (ApplicationExitInfo info : manager.getHistoricalProcessExitReasons(getContext().getPackageName(), 0, 5)) {
                    if (info.getTimestamp() < cutoff || Math.abs(info.getTimestamp() - javaCrashAt) < 3000) continue;
                    String name;
                    switch (info.getReason()) {
                        case ApplicationExitInfo.REASON_CRASH:
                        case ApplicationExitInfo.REASON_CRASH_NATIVE: name = "NativeCrash"; break;
                        case ApplicationExitInfo.REASON_ANR: name = "NativeUnresponsive"; break;
                        case ApplicationExitInfo.REASON_LOW_MEMORY: name = "NativeOutOfMemory"; break;
                        default: continue;
                    }
                    errors.put(event(info.getTimestamp(), name, "unknown"));
                }
            } catch (SecurityException ignored) { /* Java crash summary remains available. */ }
        }
        JSObject result = new JSObject(); result.put("errors", errors); call.resolve(result);
    }
    @PluginMethod public void allowed(PluginCall call) {
        JSObject result = new JSObject(); result.put("allowed", !BuildConfig.DEBUG); call.resolve(result);
    }
}
