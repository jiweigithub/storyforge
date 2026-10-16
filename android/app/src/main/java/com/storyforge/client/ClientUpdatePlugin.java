package com.storyforge.client;

import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "ClientUpdate")
public class ClientUpdatePlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile String status = "idle", version, error;
    private String downloadUrl, digest;
    private volatile int progress;
    private File downloaded;
    private JSObject state() {
        JSObject state = new JSObject();
        state.put("platform", "android"); state.put("currentVersion", BuildConfig.VERSION_NAME);
        state.put("status", status); state.put("progress", progress);
        if (version != null) state.put("version", version);
        if (error != null) state.put("error", error);
        return state;
    }
    private void changed(String next) { status = next; error = null; notifyListeners("state", state()); }
    private void failed(String message) { status = "error"; error = message; notifyListeners("state", state()); }
    @PluginMethod public void getState(PluginCall call) { call.resolve(state()); }
    private HttpURLConnection connection(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(20000); c.setReadTimeout(60000); c.setInstanceFollowRedirects(false);
        c.setRequestProperty("User-Agent", "StoryForge-Android");
        return c;
    }
    @PluginMethod public synchronized void check(PluginCall call) {
        if (BuildConfig.DEBUG) { failed("测试包不接收正式更新。覆盖升级验证需使用相同签名的正式构建。"); call.resolve(state()); return; }
        if (Arrays.asList("checking", "downloading", "downloaded").contains(status)) { call.resolve(state()); return; }
        changed("checking");
        worker.execute(() -> {
            HttpURLConnection c = null;
            try {
                c = connection(ReleasePolicy.API);
                if (c.getResponseCode() != 200) throw new Exception();
                java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
                try (InputStream input = c.getInputStream()) {
                    byte[] buffer = new byte[8192]; int count;
                    while ((count = input.read(buffer)) != -1) { bytes.write(buffer, 0, count); if (bytes.size() > 2000000) throw new Exception(); }
                }
                JSONObject release = new JSONObject(bytes.toString("UTF-8"));
                String tag = release.getString("tag_name");
                if (release.getBoolean("draft") || release.getBoolean("prerelease") || !tag.startsWith("v")) throw new Exception();
                String next = tag.substring(1);
                if (ReleasePolicy.versionCode(next) <= ReleasePolicy.versionCode(BuildConfig.VERSION_NAME)) { changed("current"); call.resolve(state()); return; }
                JSONArray assets = release.getJSONArray("assets");
                JSONObject apk = null;
                for (int i = 0; i < assets.length(); i++)
                    if (ReleasePolicy.assetName(next).equals(assets.getJSONObject(i).getString("name"))) apk = assets.getJSONObject(i);
                if (apk == null) { changed("current"); call.resolve(state()); return; }
                String url = apk.getString("browser_download_url");
                String hash = apk.getString("digest");
                if (!url.equals(ReleasePolicy.assetUrl(next)) || !hash.matches("sha256:[a-f0-9]{64}")) throw new Exception();
                version = next; downloadUrl = url; digest = hash.substring(7); changed("available");
            } catch (Exception ignored) { failed("无法检查 GitHub 更新，请检查网络后重试。当前版本仍可使用。"); }
            finally { if (c != null) c.disconnect(); }
            call.resolve(state());
        });
    }
    @PluginMethod public void download(PluginCall call) {
        if (!status.equals("available")) { call.resolve(state()); return; }
        getActivity().runOnUiThread(() -> new AlertDialog.Builder(getActivity())
            .setTitle("下载 StoryForge " + version + "？")
            .setMessage("从项目 GitHub Release 下载，完成后还需系统确认安装。")
            .setNegativeButton("取消", (dialog, which) -> call.resolve(state()))
            .setOnCancelListener(dialog -> call.resolve(state()))
            .setPositiveButton("下载", (dialog, which) -> {
                if (!status.equals("available")) { call.resolve(state()); return; }
                changed("downloading"); progress = 0;
                worker.execute(() -> downloadPackage(call));
            }).show());
    }
    private void downloadPackage(PluginCall call) {
        HttpURLConnection c = null;
        File directory = new File(getContext().getCacheDir(), "updates");
        directory.mkdirs();
        File partial = new File(directory, "update.part");
        try {
            String url = downloadUrl;
            for (int redirects = 0; redirects <= 5; redirects++) {
                if (!ReleasePolicy.allowedDownload(url)) throw new Exception();
                c = connection(url);
                int code = c.getResponseCode();
                if (code == 200) break;
                if (!Arrays.asList(301, 302, 303, 307, 308).contains(code)) throw new Exception();
                url = new URL(new URL(url), c.getHeaderField("Location")).toString();
                c.disconnect(); c = null;
            }
            if (c == null || c.getResponseCode() != 200) throw new Exception();
            long expected = c.getContentLengthLong(), total = 0;
            MessageDigest sha = MessageDigest.getInstance("SHA-256");
            try (InputStream input = c.getInputStream(); FileOutputStream output = new FileOutputStream(partial)) {
                byte[] buffer = new byte[65536]; int count;
                while ((count = input.read(buffer)) != -1) {
                    total += count;
                    if (total > 1024L * 1024 * 1024) throw new Exception();
                    output.write(buffer, 0, count); sha.update(buffer, 0, count);
                    int next = expected > 0 ? (int) Math.min(99, total * 100 / expected) : 0;
                    if (next != progress) { progress = next; notifyListeners("state", state()); }
                }
                output.getFD().sync();
            }
            StringBuilder actual = new StringBuilder();
            for (byte value : sha.digest()) actual.append(String.format("%02x", value & 0xff));
            if (!digest.equals(actual.toString()) || (expected > 0 && total != expected)) throw new Exception();
            verifyPackage(partial);
            File ready = new File(directory, "update.apk");
            if (ready.exists() && !ready.delete()) throw new Exception();
            if (!partial.renameTo(ready)) throw new Exception();
            downloaded = ready; progress = 100; changed("downloaded");
        } catch (Exception ignored) { partial.delete(); failed("更新包下载或校验失败（网络、完整性、版本或签名）。未安装任何更新，可重新检查后重试。"); }
        finally { if (c != null) c.disconnect(); }
        call.resolve(state());
    }
    @SuppressWarnings("deprecation") private void verifyPackage(File apk) throws Exception {
        PackageManager pm = getContext().getPackageManager();
        PackageInfo candidate = pm.getPackageArchiveInfo(apk.getPath(), PackageManager.GET_SIGNATURES);
        PackageInfo current = pm.getPackageInfo(getContext().getPackageName(), PackageManager.GET_SIGNATURES);
        if (candidate == null || !candidate.packageName.equals(current.packageName)
            || candidate.versionCode <= current.versionCode || !version.equals(candidate.versionName)
            || candidate.versionCode != ReleasePolicy.versionCode(version)
            || candidate.signatures == null || !Arrays.equals(candidate.signatures, current.signatures)) throw new Exception();
    }
    @PluginMethod public void install(PluginCall call) {
        if (!status.equals("downloaded") || downloaded == null) { call.resolve(state()); return; }
        getActivity().runOnUiThread(() -> new AlertDialog.Builder(getActivity())
            .setTitle("保存完成后安装更新？")
            .setMessage("请先保存编辑、结束生成任务，并为重要作品导出完整备份。系统确认后覆盖安装，不要卸载旧版。若系统要求允许安装，授权后返回此处再次点安装。")
            .setNegativeButton("稍后", (dialog, which) -> call.resolve(state()))
            .setOnCancelListener(dialog -> call.resolve(state()))
            .setPositiveButton("继续", (dialog, which) -> {
                try {
                    verifyPackage(downloaded);
                    if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
                        getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName())));
                    } else {
                        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", downloaded);
                        Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive");
                        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        getActivity().startActivity(intent);
                    }
                } catch (Exception ignored) { failed("无法打开安装程序，请重新检查更新。未清除任何作品数据。"); }
                call.resolve(state());
            }).show());
    }
    @Override protected void handleOnDestroy() { worker.shutdownNow(); }
}
