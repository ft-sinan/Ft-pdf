package studio.ftpdf.app;

import static org.junit.Assert.*;

import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.SystemClock;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.UiDevice;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Real Android intent resolution and content-provider reads with airplane mode enabled. */
@RunWith(AndroidJUnit4.class)
public class OpenWithTest {

  final Context app = TestFiles.app;
  final UiDevice os = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());

  private Uri file(String name, String fixture) throws Exception {
    return TestFiles.external(name, "application/pdf", TestFiles.input(fixture));
  }

  private Intent view(Uri uri) {
    Intent i = new Intent(Intent.ACTION_VIEW)
      .setPackage(app.getPackageName())
      .setDataAndType(uri, "application/pdf")
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
    assertEquals(
      "exactly one PDF handler",
      1,
      app.getPackageManager().queryIntentActivities(i, PackageManager.MATCH_DEFAULT_ONLY).size()
    );
    ComponentName handler = i.resolveActivity(app.getPackageManager());
    assertEquals(OpenPdfActivity.class.getName(), handler.getClassName());
    return i.setComponent(handler);
  }

  private JSONObject workspace() throws Exception {
    return (JSONObject) DeviceLibrary.instance(app).call("workspace", new JSONObject());
  }

  private StudioScreen open(Uri u) {
    return new StudioScreen(ActivityScenario.<OpenPdfActivity>launch(view(u)));
  }

  private void reading(StudioScreen reader, String name) throws Exception {
    // Crucially: no click, no import helper, no automatic completion of the welcome tour.
    reader.visible("canvas[data-rendered='true'][aria-label='PDF page 1 of 3']");
    reader.value(".editor-title", name);
    assertEquals(
      "read only, without import, onboarding, or library delete",
      "true",
      reader.js(
        "!!q('.editor-shell.reading')&&!q('.first-run,.app-shell,[role=dialog],.editor-tools,.annotation-layer')&&!btn('Delete document')"
      )
    );
  }

  @Test
  public void firstOpenReadsWithoutSetupOrImport() throws Exception {
    String name = "FtCold" + SystemClock.elapsedRealtime() + ".pdf";
    Uri u = file(name, "field-sheets.pdf");
    try {
      try (StudioScreen reader = open(u)) {
        reading(reader, name);
        reader.activity.recreate();
        reading(reader, name);
        reader.js("q('.read-pdf-scroll').scrollTop=q('.read-pdf-scroll').scrollHeight");
        reader.visible("canvas[data-rendered='true'][aria-label='PDF page 3 of 3']");
        os.pressBack();
      }
      // A separate icon launch still offers setup. Viewing alone never adds a private copy.
      try (StudioScreen ui = new StudioScreen(ActivityScenario.launch(MainActivity.class))) {
        ui.value("h1", "Welcome to Ft PDF.");
        JSONObject w = workspace();
        assertTrue(w.getJSONObject("user").getBoolean("needsSetup"));
        assertEquals(0, w.getJSONArray("documents").length());
        assertEquals(0, w.getJSONArray("activity").length());
      }
    } finally {
      app.getContentResolver().delete(u, null, null);
    }
  }

  @Test
  public void warmOpenPreservesDraftAndSavesOnlyEditedCopy() throws Exception {
    String name = "FtWarm" + SystemClock.elapsedRealtime() + ".pdf";
    Uri u = file(name, "field-sheets.pdf");
    byte[] original = TestFiles.bytes(app.getContentResolver().openInputStream(u));
    try (StudioScreen ui = new StudioScreen()) {
      ui.newDoc("Text", "In progress");
      ui.button("Create document");
      ui.edit();
      ui.fill("textarea.text-page", "Unsaved draft behind the reader");
      int before = workspace().getJSONArray("documents").length();
      try (StudioScreen reader = open(u)) {
        reading(reader, name);
        assertEquals(before, workspace().getJSONArray("documents").length());
        reader.button("Edit");
        reader.button("PDF tools");
        reader.button("Add blank page");
        reader.button("Save a library copy");
        reader.visible("canvas[aria-label='PDF page 1 of 4']");
        reader.button("Back to reader");
        reader.reader();
        reader.button("Close PDF");
      }
      ui.value("textarea.text-page", "Unsaved draft behind the reader");
      ui.save();
      ui.closeDocument();
      ui.button("Open " + name);
      ui.visible("canvas[data-rendered='true'][aria-label='PDF page 1 of 4']");
      assertEquals(before + 1, workspace().getJSONArray("documents").length());
      assertArrayEquals(
        "Never write the source URI",
        original,
        TestFiles.bytes(app.getContentResolver().openInputStream(u))
      );
    } finally {
      app.getContentResolver().delete(u, null, null);
    }
  }

  @Test
  public void protectedPdfRequestsOnlyItsOwnPassword() throws Exception {
    String name = "FtLocked" + SystemClock.elapsedRealtime() + ".pdf";
    Uri u = file(name, "locked-sheets.pdf");
    try (StudioScreen reader = open(u)) {
      reader.visible("[role=dialog] input[type=password]");
      assertEquals("false", reader.js("!!q('.first-run,.app-shell')||!!btn('Import 1 file')"));
      reader.fill("[role=dialog] input[type=password]", "fixture-only");
      reader.button("Unlock document");
      reading(reader, name);
      assertEquals("protected means read-only", "false", reader.js("!!q('.read-edit-btn')"));
    } finally {
      app.getContentResolver().delete(u, null, null);
    }
  }

  @Test
  public void shareStillRequiresIntentionalImport() throws Exception {
    String name = "FtShared" + SystemClock.elapsedRealtime() + ".pdf";
    Uri u = file(name, "field-sheets.pdf");
    try (StudioScreen ui = new StudioScreen()) {
      int before = workspace().getJSONArray("documents").length();
      Intent share = new Intent(Intent.ACTION_SEND)
        .setPackage(app.getPackageName())
        .setType("application/pdf")
        .putExtra(Intent.EXTRA_STREAM, u)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
      share.setClipData(ClipData.newRawUri("PDF", u));
      assertEquals(
        MainActivity.class.getName(),
        share.resolveActivity(app.getPackageManager()).getClassName()
      );
      app.startActivity(share);
      ui.value("[role=dialog]", name);
      assertEquals(before, workspace().getJSONArray("documents").length());
      ui.button("Import 1 file");
      ui.reader();
      ui.value(".editor-title", name);
      assertEquals(before + 1, workspace().getJSONArray("documents").length());
    } finally {
      app.getContentResolver().delete(u, null, null);
    }
  }
}
