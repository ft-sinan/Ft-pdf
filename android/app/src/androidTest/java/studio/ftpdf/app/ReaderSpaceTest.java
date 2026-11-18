package studio.ftpdf.app;

import static org.junit.Assert.*;

import android.app.Instrumentation;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.PatternMatcher;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.UiDevice;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class ReaderSpaceTest {

  @Test
  public void scrollPdfThenEditAndReadAgain() throws Exception {
    try (StudioScreen ui = new StudioScreen()) {
      ui.button("Open Quarterly report.pdf");
      ui.reader();
      ui.visible("canvas[data-rendered='true'][aria-label='PDF page 1 of 3']");
      ui.await(
        "continuous pages",
        "q('.read-pdf-scroll').scrollHeight>q('.read-pdf-scroll').clientHeight"
      );
      ui.js("q('.read-pdf-scroll').scrollTo(0,q('.read-pdf-scroll').scrollHeight)");
      ui.visible("canvas[data-rendered='true'][aria-label='PDF page 3 of 3']");
      ui.value(".reader-page-count", "Page 3 of 3");
      ui.edit();
      ui.visible(".pdf-sheet canvas[aria-label='PDF page 3 of 3']");
      UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
      device.pressBack();
      ui.reader();
      ui.value(".reader-page-count", "Page 3 of 3");
      device.pressBack();
      ui.visible(".main-content");
    }
  }

  @Test
  public void creatorCardOpensOnlyTheSelectedContactOutsideStudio() throws Exception {
    try (StudioScreen ui = new StudioScreen()) {
      if ("true".equals(ui.js("!!btn('Open navigation')"))) ui.button("Open navigation");
      ui.button("Settings");
      ui.button("Creator Space");
      ui.value(".maker-card h3", "Sinan");
      ui.button("Flip creator emblem");
      ui.value(".maker-card h3", "Read first.");
      ui.value(".maker-card h3", "Sinan");
      ui.button("Offline");
      ui.value(".badge-detail", "airplane mode");
      ui.value(".maker-stats", BuildConfig.VERSION_NAME);
      ui.touch("[aria-label='Copy Telegram contact']");
      ui.value(".copy-feedback", "Telegram contact copied.");
      // Observe the real outbound Intent, without starting a network-capable browser in CI.
      Instrumentation inst = InstrumentationRegistry.getInstrumentation();
      IntentFilter filter = new IntentFilter(Intent.ACTION_VIEW);
      filter.addDataScheme("https");
      filter.addDataAuthority("github.com", null);
      filter.addDataPath("/ft-sinan", PatternMatcher.PATTERN_LITERAL);
      Instrumentation.ActivityMonitor monitor = inst.addMonitor(filter, null, true);
      try {
        ui.touch("[aria-label='Open GitHub']");
        long end = android.os.SystemClock.elapsedRealtime() + 8000;
        while (monitor.getHits() == 0 && android.os.SystemClock.elapsedRealtime() < end)
          android.os.SystemClock.sleep(100);
        assertEquals("Public profile handed to an external app", 1, monitor.getHits());
        ui.await(
          "studio stayed in its local Settings",
          "location.host==='appassets.androidplatform.net' && !!q('.creator-space')"
        );
      } finally {
        inst.removeMonitor(monitor);
      }
    }
  }
}
