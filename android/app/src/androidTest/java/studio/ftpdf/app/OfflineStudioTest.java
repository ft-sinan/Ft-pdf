package studio.ftpdf.app;

import static org.junit.Assert.*;

import android.content.*;
import android.content.pm.PackageManager;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.*;
import java.io.*;
import java.util.regex.Pattern;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class OfflineStudioTest {

  private StudioScreen ui;
  private final String text = "[aria-label='Plain text content']",
    html = "[aria-label='HTML source code']";
  private final Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();

  @Before
  public void launch() throws Exception {
    assertEquals(
      "No internet permission in installed APK",
      PackageManager.PERMISSION_DENIED,
      app.checkSelfPermission("android.permission.INTERNET")
    );
    ui = new StudioScreen();
  }

  @After
  public void close() {
    if (ui != null) ui.close();
  }

  private DeviceLibrary db() {
    return DeviceLibrary.instance(app);
  }

  private static void copy(InputStream in, OutputStream out) throws Exception {
    byte[] b = new byte[8192];
    int n;
    while ((n = in.read(b)) != -1) out.write(b, 0, n);
  }

  private static String read(InputStream in) throws Exception {
    try (InputStream src = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
      copy(src, out);
      return out.toString("UTF-8");
    }
  }

  @Test
  public void createEditAndReopenPDF() throws Exception {
    ui.newDoc("PDF", "Offline pages");
    ui.fill(".pdf-draft", "A report created with no network.");
    ui.button("Create PDF");
    ui.visible("canvas[aria-label='PDF page 1 of 1']");
    ui.edit();
    ui.button("Text");
    ui.await("ready to annotate", "q('.annotation-layer')?.style.pointerEvents==='auto'");
    ui.touch(".pdf-sheet");
    ui.fill(".pdf-text-field", "Reviewed offline");
    ui.button("Place text");
    ui.save();
    ui.button("PDF tools");
    ui.button("Add blank page");
    ui.button("Save PDF changes");
    ui.visible("canvas[aria-label='PDF page 1 of 2']");
    ui.reload();
    ui.visible("canvas[aria-label='PDF page 1 of 2']");
    File f = File.createTempFile("ft-saved-", ".pdf", app.getCacheDir());
    try {
      try (
        InputStream in = db().read(ui.documentId(), false).stream;
        OutputStream out = new FileOutputStream(f)
      ) {
        copy(in, out);
      }
      try (
        android.graphics.pdf.PdfRenderer pdf = new android.graphics.pdf.PdfRenderer(
          android.os.ParcelFileDescriptor.open(f, android.os.ParcelFileDescriptor.MODE_READ_ONLY)
        )
      ) {
        assertEquals("Real saved PDF", 2, pdf.getPageCount());
      }
    } finally {
      f.delete();
    }
  }

  @Test
  public void htmlSourceIsEditableAndPreviewIsSandboxed() throws Exception {
    ui.newDoc("HTML", "Offline page");
    ui.button("Create document");
    ui.visible("iframe[sandbox='']");
    ui.edit();
    ui.fill(html, "<h1>Offline field guide</h1>");
    ui.button("Preview");
    ui.visible("iframe[sandbox='']");
    ui.button("Save changes");
    ui.await("stored HTML", "q('.save-status')?.textContent==='Saved'");
    ui.reload();
    ui.reader();
    ui.await(
      "saved page opens as a sandboxed preview",
      "q('iframe[sandbox]')?.srcdoc.includes('Offline field guide')===true"
    );
    assertEquals("<h1>Offline field guide</h1>", read(db().read(ui.documentId(), false).stream));
  }

  @Test
  public void textRoundTripsThroughTheSystemFilesPicker() throws Exception {
    String title = "FtQA" + SystemClock.elapsedRealtime(),
      data = "Notes from the installed Android app.";
    ui.newDoc("Text", title);
    ui.button("Create document");
    ui.edit();
    ui.fill(text, data);
    ui.save();
    ui.reload();
    ui.value(text, data);
    ui.button("Save a copy to Files");
    UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
    UiObject2 save = device.wait(Until.findObject(By.text(Pattern.compile("(?i)^save$"))), 15000);
    assertNotNull("Android Files save dialog", save);
    save.click();
    String path = "/sdcard/Download/" + title + ".txt";
    try {
      long until = SystemClock.elapsedRealtime() + 15000;
      String bytes = "";
      while (SystemClock.elapsedRealtime() < until) {
        bytes = device.executeShellCommand("cat " + path).trim();
        if (data.equals(bytes)) break;
        SystemClock.sleep(150);
      }
      assertEquals("Exported copy in Downloads", data, bytes);
      ui.closeDocument();
      ui.button("Import files");
      ui.touch(".dropzone");
      UiObject2 item = device.wait(Until.findObject(By.text(title + ".txt")), 15000);
      assertNotNull("Exported note available in Android Files", item);
      item.click();
      // Some versions of DocumentsUI stage the selection for a multi-select picker.
      UiObject2 open = device.wait(Until.findObject(By.text(Pattern.compile("(?i)^open$"))), 1000);
      if (open != null) open.click();
      ui.button("Import 1 file");
      ui.value(text, data);
    } finally {
      device.executeShellCommand("rm -f " + path);
    }
  }
}
