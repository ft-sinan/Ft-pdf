package studio.ftpdf.updatecheck;

import static org.junit.Assert.*;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Targets the probe's own UID. No run-as, WebView debugging, access to private app data,
 * production-signed instrumentation or code inside the shipping app. */
@RunWith(AndroidJUnit4.class)
public class UpgradeTest {
  private static final String PKG = "studio.ftpdf.app";
  private final Context probe = InstrumentationRegistry.getInstrumentation().getTargetContext();
  private final UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());

  private String arg(String key) {
    return InstrumentationRegistry.getArguments().getString(key);
  }

  private String body() { return "Saved before Android update " + arg("nonce"); }

  private void openInstalledRelease() throws Exception {
    PackageInfo info = probe.getPackageManager().getPackageInfo(PKG, PackageManager.GET_SIGNING_CERTIFICATES);
    assertNotEquals("Independent test UID", probe.getApplicationInfo().uid, info.applicationInfo.uid);
    assertEquals(0, info.applicationInfo.flags & (ApplicationInfo.FLAG_DEBUGGABLE | ApplicationInfo.FLAG_TEST_ONLY));
    assertEquals(Long.parseLong(arg("code")), info.getLongVersionCode());
    Signature[] signers = info.signingInfo.getApkContentsSigners();
    assertEquals(1, signers.length);
    StringBuilder cert = new StringBuilder();
    for (byte b : MessageDigest.getInstance("SHA-256").digest(signers[0].toByteArray())) {
      cert.append(String.format(Locale.ROOT, "%02x", b & 255));
    }
    assertEquals(arg("signer"), cert.toString());
    device.executeShellCommand("am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n " + PKG + "/.MainActivity");
  }

  private UiObject2 named(String name) {
    long end = SystemClock.elapsedRealtime() + 20000;
    do {
      UiObject2 node = device.findObject(By.pkg(PKG).text(name).enabled(true));
      if (node == null) node = device.findObject(By.pkg(PKG).desc(name).enabled(true));
      if (node != null && !node.getVisibleBounds().isEmpty()) return node;
      SystemClock.sleep(120);
    } while (SystemClock.elapsedRealtime() < end);
    List<String> labels = new ArrayList<>();
    for (UiObject2 node : device.findObjects(By.pkg(PKG))) {
      String label = node.getText() != null ? node.getText() : node.getContentDescription();
      if (label != null && labels.size() < 60) labels.add(label);
    }
    throw new AssertionError("Missing UI: " + name + "; foreground=" + device.getCurrentPackageName() + "; labels=" + labels);
  }

  private UiObject2 field() {
    UiObject2 node = device.wait(Until.findObject(By.pkg(PKG).clazz("android.widget.EditText").enabled(true)), 15000);
    assertNotNull("Expected editable field", node);
    return node;
  }

  @Test public void saveBeforeUpdate() throws Exception {
    openInstalledRelease();
    named("Skip tour").click();
    field().setText("Upgrade reader");
    named("Open my library").click();
    named("New document").click();
    named("Text").click();
    field().setText("Update " + arg("nonce"));
    named("Create document").click();
    named("Edit").click();
    field().setText(body());
    named("Save changes").click();
    named("Saved");
    named("Back to reader").click();
    named(body());
  }

  @Test public void reopenAfterUpdate() throws Exception {
    openInstalledRelease();
    named("Workspace overview"); // Not a new profile or onboarding screen.
    named("Continue reading").click();
    named("Edit").click();
    assertEquals("Actual private document content survived install -r", body(), field().getText());
  }
}
