package com.storyforge.client;

import java.net.URI;

/** Fixed GitHub channel; neither JavaScript nor release notes can supply install commands. */
public final class ReleasePolicy {
    public static final String REPOSITORY = "https://github.com/yuanbw2025/storyforge";
    public static final String API = "https://api.github.com/repos/yuanbw2025/storyforge/releases/latest";
    public static long versionCode(String version) {
        if (!version.matches("(0|[1-9][0-9]{0,2})\\.(0|[1-9][0-9]{0,2})\\.(0|[1-9][0-9]{0,2})")) throw new IllegalArgumentException("Invalid stable version");
        String[] parts = version.split("\\.");
        return Long.parseLong(parts[0]) * 1000000 + Long.parseLong(parts[1]) * 1000 + Long.parseLong(parts[2]);
    }
    public static String assetName(String version) { versionCode(version); return "StoryForge-" + version + "-android.apk"; }
    public static String assetUrl(String version) { return REPOSITORY + "/releases/download/v" + version + "/" + assetName(version); }
    public static boolean allowedDownload(String raw) {
        try {
            URI url = new URI(raw);
            if (!"https".equals(url.getScheme()) || url.getUserInfo() != null || url.getPort() != -1) return false;
            return ("github.com".equals(url.getHost()) && url.getPath().startsWith("/yuanbw2025/storyforge/releases/download/"))
                || "release-assets.githubusercontent.com".equals(url.getHost()) || "objects.githubusercontent.com".equals(url.getHost());
        } catch (Exception ignored) { return false; }
    }
    private ReleasePolicy() { }
}
