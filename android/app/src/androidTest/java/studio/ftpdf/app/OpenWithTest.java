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
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.zip.*;
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

  private Intent view(Uri uri, String type) {
    Intent i = new Intent(Intent.ACTION_VIEW)
      .setPackage(app.getPackageName())
      .setDataAndType(uri, type)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
    assertEquals(
      "exactly one direct reader",
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
    return open(u, "application/pdf");
  }

  private StudioScreen open(Uri u, String type) {
    return new StudioScreen(ActivityScenario.<OpenPdfActivity>launch(view(u, type)));
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
      // Back from a document returns to its caller (often Files), not necessarily
      // the studio task. ActivityScenario.onActivity also works on a stopped activity;
      // an offscreen WebView can answer DOM queries but won't paint PDF.js frames.
      // Re-select the app icon, without starting a new scenario or clearing its task.
      String launch = os.executeShellCommand(
        "am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n " +
          app.getPackageName() +
          "/.MainActivity"
      );
      assertFalse(launch, launch.contains("Error:"));
      ui.await(
        "original workspace visible after icon launch",
        "document.visibilityState==='visible' && !!q('.editor-shell.editing')"
      );
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
  public void wordTextAndHtmlReadBeforeSetup() throws Exception {
    String[][] formats = {
      {
        "sinan (1).docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "brief.docx",
        "Timeline",
      },
      { "legacy-word.doc", "application/msword", "legacy-word.doc", "second test" },
      { "Local note.txt", "text/plain", "", "Notes from Files" },
      { "Preview.htm", "text/html", "", "<h1>Local page</h1>" },
    };
    for (String[] f : formats) {
      byte[] bytes = f[2].isEmpty()
        ? f[3].getBytes(StandardCharsets.UTF_8)
        : TestFiles.bytes(TestFiles.input(f[2]));
      Uri u = TestFiles.external(f[0], f[1], new ByteArrayInputStream(bytes));
      try (StudioScreen reader = open(u, f[1])) {
        reader.value(".editor-title", f[0].substring(0, f[0].lastIndexOf('.')));
        if (f[1].equals("text/html")) reader.await(
          "sandboxed file preview",
          "q('iframe[sandbox]')?.srcdoc.includes('Local page')===true"
        );
        else reader.value(f[1].equals("text/plain") ? ".reader-text" : "article.rich-page", f[3]);
        assertEquals(
          "false",
          reader.js(
            "!!q('.app-shell,.first-run,[role=dialog],.editor-tools,[contenteditable=true]')"
          )
        );
        assertTrue(workspace().getJSONObject("user").getBoolean("needsSetup"));
        assertEquals(0, workspace().getJSONArray("documents").length());
      } finally {
        app.getContentResolver().delete(u, null, null);
      }
    }
  }

  @Test
  public void wordEditsSaveAsSeparateDocxWithoutDisturbingDraft() throws Exception {
    try (StudioScreen studio = new StudioScreen()) {
      studio.newDoc("Text", "Draft behind Word");
      studio.button("Create document");
      studio.edit();
      studio.fill("textarea.text-page", "Unfinished studio notes");
      for (boolean legacy : new boolean[] { false, true }) {
        String mime = legacy
            ? "application/msword"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          name = legacy ? "Binary brief.doc" : "sinan (1).docx",
          mark = legacy ? "Converted field notes" : "Edited local proposal";
        byte[] original = TestFiles.bytes(
          TestFiles.input(legacy ? "legacy-word.doc" : "brief.docx")
        );
        Uri u = TestFiles.external(name, mime, new ByteArrayInputStream(original));
        int before = workspace().getJSONArray("documents").length();
        try (StudioScreen reader = open(u, mime)) {
          reader.value("article.rich-page", legacy ? "second test" : "Timeline");
          assertEquals(before, workspace().getJSONArray("documents").length());
          reader.button("Edit");
          reader.fill("[contenteditable=true]", mark);
          assertEquals(before, workspace().getJSONArray("documents").length());
          reader.button("Save a copy");
          reader.button("Back to reader");
          reader.reader();
          reader.value("article.rich-page", mark);
          JSONArray docs = workspace().getJSONArray("documents");
          assertEquals(before + 1, docs.length());
          String id = null;
          for (int i = 0; i < docs.length(); i++) {
            JSONObject doc = docs.getJSONObject(i);
            if (
              doc.getString("name").equals(name.substring(0, name.lastIndexOf('.'))) &&
              doc.getString("type").equals("docx")
            ) id = doc.getString("id");
          }
          assertNotNull("A new Word copy", id);
          try (
            ZipInputStream zip = new ZipInputStream(
              DeviceLibrary.instance(app).read(id, false).stream
            )
          ) {
            boolean found = false;
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null)
              if (entry.getName().equals("word/document.xml")) {
                found = new String(TestFiles.bytes(zip), StandardCharsets.UTF_8).contains(mark);
                break;
              }
            assertTrue("Saved DOCX contains edit", found);
          }
          assertArrayEquals(original, TestFiles.bytes(app.getContentResolver().openInputStream(u)));
        } finally {
          app.getContentResolver().delete(u, null, null);
        }
      }
      os.executeShellCommand(
        "am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n " +
          app.getPackageName() +
          "/.MainActivity"
      );
      studio.value("textarea.text-page", "Unfinished studio notes");
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
