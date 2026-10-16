package com.storyforge.client;

import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "StoryForgeHttp")
public class StoryForgeHttpPlugin extends Plugin {
    private static class Transfer {
        volatile HttpURLConnection connection;
        volatile InputStream input;
        volatile boolean cancelled;
        void close() {
            cancelled = true;
            if (connection != null) connection.disconnect();
            try { if (input != null) input.close(); } catch (Exception ignored) { }
        }
    }
    private final Map<String, Transfer> active = new ConcurrentHashMap<>();
    private final ExecutorService workers = Executors.newFixedThreadPool(8);

    @PluginMethod public void open(PluginCall call) {
        String id = call.getString("id", "");
        if (!id.matches("[a-f0-9-]{36}") || active.size() >= 16 || active.containsKey(id)) { call.reject("Invalid or busy transfer"); return; }
        Transfer transfer = new Transfer();
        active.put(id, transfer);
        workers.execute(() -> {
            try {
                URL url = new URL(call.getString("url", ""));
                if (!url.getProtocol().equals("https") || url.getUserInfo() != null) throw new Exception();
                HttpURLConnection connection = (HttpURLConnection) url.openConnection();
                transfer.connection = connection;
                if (transfer.cancelled) throw new Exception();
                connection.setConnectTimeout(30000);
                connection.setReadTimeout(600000);
                // Never follow redirects carrying a user's provider credentials.
                connection.setInstanceFollowRedirects(false);
                connection.setRequestMethod(call.getString("method", "GET"));
                JSObject headers = call.getObject("headers", new JSObject());
                for (java.util.Iterator<String> keys = headers.keys(); keys.hasNext();) {
                    String key = keys.next();
                    if (!key.equalsIgnoreCase("host") && !key.equalsIgnoreCase("cookie") && !key.equalsIgnoreCase("content-length"))
                        connection.setRequestProperty(key, headers.getString(key));
                }
                String body = call.getString("body");
                if (body != null) {
                    byte[] bytes = Base64.decode(body, Base64.DEFAULT);
                    if (bytes.length > 32 * 1024 * 1024) throw new Exception();
                    connection.setDoOutput(true);
                    connection.setFixedLengthStreamingMode(bytes.length);
                    try (java.io.OutputStream output = connection.getOutputStream()) { output.write(bytes); }
                }
                int status = connection.getResponseCode();
                transfer.input = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                if (transfer.cancelled) throw new Exception();
                JSObject resultHeaders = new JSObject();
                for (Map.Entry<String, List<String>> header : connection.getHeaderFields().entrySet())
                    if (header.getKey() != null && !header.getKey().equalsIgnoreCase("set-cookie"))
                        resultHeaders.put(header.getKey(), String.join(", ", header.getValue()));
                JSObject result = new JSObject();
                result.put("status", status); result.put("headers", resultHeaders);
                call.resolve(result);
            } catch (Exception ignored) {
                active.remove(id); transfer.close();
                call.reject("Native request failed or cancelled; delivery may be unknown. No automatic retry.");
            }
        });
    }
    @PluginMethod public void read(PluginCall call) {
        String id = call.getString("id", "");
        Transfer transfer = active.get(id);
        if (transfer == null) { call.reject("Transfer closed"); return; }
        workers.execute(() -> {
            try {
                byte[] buffer = new byte[32768];
                int count = transfer.input == null ? -1 : transfer.input.read(buffer);
                if (transfer.cancelled) throw new Exception();
                JSObject result = new JSObject();
                result.put("done", count < 0);
                if (count >= 0) result.put("data", Base64.encodeToString(buffer, 0, count, Base64.NO_WRAP));
                else { active.remove(id); transfer.close(); }
                call.resolve(result);
            } catch (Exception ignored) { active.remove(id); transfer.close(); call.reject("Native stream interrupted"); }
        });
    }
    @PluginMethod public void cancel(PluginCall call) {
        Transfer transfer = active.remove(call.getString("id", ""));
        if (transfer != null) transfer.close();
        call.resolve();
    }
    @Override protected void handleOnDestroy() {
        for (Transfer transfer : active.values()) transfer.close();
        active.clear(); workers.shutdownNow();
    }
}
