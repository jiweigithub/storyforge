package com.storyforge.client;
import org.junit.Test;
import static org.junit.Assert.*;
public class ReleasePolicyTest {
    @Test public void stableVersionsAreStrictlyOrdered() {
        assertTrue(ReleasePolicy.versionCode("4.10.0") > ReleasePolicy.versionCode("4.9.999"));
        assertEquals(4000001, ReleasePolicy.versionCode("4.0.1"));
        for (String bad : new String[]{"4.0.1-beta.1", "4.0.01", "4.1000.0", "v4.0.0", "../4.0.0"}) {
            try { ReleasePolicy.versionCode(bad); fail(bad); } catch (IllegalArgumentException expected) { }
        }
    }
    @Test public void installerDownloadsStayOnTheFixedHttpsChannel() {
        assertTrue(ReleasePolicy.allowedDownload(ReleasePolicy.assetUrl("4.0.1")));
        assertTrue(ReleasePolicy.allowedDownload("https://release-assets.githubusercontent.com/test"));
        for (String bad : new String[]{"http://github.com/yuanbw2025/storyforge/releases/download/v4.0.1/a.apk", "https://github.com/other/repo/releases/download/a.apk", "https://github.com.evil.com/a.apk", "file:///a.apk", "https://user@objects.githubusercontent.com/a"}) assertFalse(bad, ReleasePolicy.allowedDownload(bad));
    }
}
