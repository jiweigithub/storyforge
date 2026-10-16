package com.storyforge.client;

import android.app.Activity;
import android.content.Intent;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@CapacitorPlugin(name = "StoryForgeFiles")
public class StoryForgeFilesPlugin extends Plugin {
    private final Map<String, File> pending = new ConcurrentHashMap<>();
    private volatile boolean saving;
    private final java.util.concurrent.ExecutorService worker = java.util.concurrent.Executors.newSingleThreadExecutor();
    @PluginMethod public void begin(PluginCall call) {
        try {
            if (pending.size() >= 4) throw new Exception();
            String id = UUID.randomUUID().toString();
            File directory = new File(getContext().getCacheDir(), "exports"); directory.mkdirs();
            File file = File.createTempFile("export-", ".tmp", directory); pending.put(id, file);
            JSObject result = new JSObject(); result.put("id", id); call.resolve(result);
        } catch (Exception ignored) { call.reject("无法准备导出文件"); }
    }
    @PluginMethod public void append(PluginCall call) {
        File file = pending.get(call.getString("id", ""));
        try {
            if (file == null || file.length() > 1024L * 1024 * 1024) throw new Exception();
            String data = call.getString("data", "");
            if (data.length() > 65536) throw new Exception();
            try (FileOutputStream output = new FileOutputStream(file, true)) { output.write(Base64.decode(data, Base64.DEFAULT)); }
            call.resolve();
        } catch (Exception ignored) { call.reject("导出写入失败，原作品保留"); }
    }
    @PluginMethod public void save(PluginCall call) {
        if (saving || !pending.containsKey(call.getString("id", ""))) { call.reject("另一个文件正在保存"); return; }
        saving = true;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mime", "application/octet-stream"));
        intent.putExtra(Intent.EXTRA_TITLE, call.getString("filename", "StoryForge-backup.json").replaceAll("[/\\\\]", "_"));
        try { startActivityForResult(call, intent, "fileSelected"); }
        catch (Exception ignored) { saving = false; call.reject("无法打开系统文件保存窗口"); }
    }
    @ActivityCallback private void fileSelected(PluginCall call, ActivityResult result) {
        if (call == null) { saving = false; return; }
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) { saving = false; call.reject("已取消保存，备份尚未完成"); return; }
        File file = pending.get(call.getString("id", ""));
        worker.execute(() -> {
            try {
                try (FileInputStream input = new FileInputStream(file);
                     OutputStream output = getContext().getContentResolver().openOutputStream(result.getData().getData(), "wt")) {
                    if (output == null) throw new Exception();
                    byte[] buffer = new byte[65536]; int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                    output.flush();
                }
                call.resolve();
            } catch (Exception ignored) { call.reject("保存失败，请重新导出。目标文件可能不完整，原作品保留。"); }
            finally { saving = false; }
        });
    }
    @PluginMethod public void discard(PluginCall call) {
        File file = pending.remove(call.getString("id", "")); if (file != null) file.delete(); call.resolve();
    }
    @Override protected void handleOnDestroy() { worker.shutdownNow(); for (File file : pending.values()) file.delete(); pending.clear(); }
}
