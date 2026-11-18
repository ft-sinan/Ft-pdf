package studio.ftpdf.app;

import static org.junit.Assert.*;

import android.content.*;
import android.graphics.*;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.*;
import android.provider.MediaStore;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.*;
import java.io.*;
import java.util.regex.Pattern;
import java.util.zip.*;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class PhoneToolsTest {

  final android.app.Instrumentation inst = InstrumentationRegistry.getInstrumentation();
  final Context app = inst.getTargetContext();
  final UiDevice os = UiDevice.getInstance(inst);
  static String text = "[aria-label='Plain text content']";

  private UiObject2 nativeText(String s) {
    UiObject2 o = os.wait(Until.findObject(By.text(Pattern.compile(s))), 15000);
    assertNotNull("Android picker: " + s, o);
    return o;
  }

  private static String id(StudioScreen ui) throws Exception {
    return new JSONTokener(ui.js("location.hash.split('/edit/')[1]")).nextValue().toString();
  }

  // Produce a genuine shell-owned file in shared storage, not an app-private test fixture.
  private void shellText(String path, String value) throws Exception {
    ParcelFileDescriptor[] pipes = inst.getUiAutomation().executeShellCommandRw("tee " + path);
    try (InputStream result = new ParcelFileDescriptor.AutoCloseInputStream(pipes[0])) {
      try (OutputStream input = new ParcelFileDescriptor.AutoCloseOutputStream(pipes[1])) {
        input.write(value.getBytes("UTF-8"));
      }
      ByteArrayOutputStream read = new ByteArrayOutputStream();
      byte[] buf = new byte[512];
      int n;
      while ((n = result.read(buf)) != -1) read.write(buf, 0, n);
      assertEquals(value, read.toString("UTF-8"));
    }
  }

  @Test
  public void sharedFilesAppearOnHomeAndOriginalIsUntouched() throws Exception {
    assertTrue(Environment.isExternalStorageManager());
    String name = "FieldLog" + SystemClock.elapsedRealtime() + ".txt",
      path = "/sdcard/Documents/" + name;
    os.executeShellCommand("mkdir -p /sdcard/Documents");
    shellText(path, "shared-original");
    try (StudioScreen ui = new StudioScreen()) {
      ui.button("Scan my phone");
      ui.button("Open phone file " + name);
      ui.value(text, "shared-original");
      String copy = id(ui);
      ui.fill(text, "Private edits stay in Ft PDF");
      ui.save();
      ui.closeEditor();
      ui.button("Open phone file " + name);
      ui.value(text, "Private edits stay in Ft PDF");
      assertEquals("Reuse same working copy", copy, id(ui));
      assertEquals("shared-original", os.executeShellCommand("cat " + path).trim());
      ui.closeEditor();
      shellText(path, "New version from outside the app");
      ui.button("Open phone file " + name);
      ui.value(text, "New version from outside the app");
      assertNotEquals("Changed source opens as a new copy", copy, id(ui));
      ui.closeEditor();
      ui.button("Manage phone sources");
      ui.button("Stop phone scan");
      ui.await("source no longer visible", "!q('.phone-file') && !!btn('Scan my phone')");
    } finally {
      os.executeShellCommand("rm -f " + path);
    }
  }

  @Test
  public void folderGrantWorksWithoutAllFilesAccess() throws Exception {
    assertFalse(Environment.isExternalStorageManager());
    String dir = "FtFolder" + SystemClock.elapsedRealtime(),
      p = "/sdcard/Download/" + dir;
    os.executeShellCommand("mkdir -p " + p);
    shellText(p + "/Folder-note.txt", "folder-only");
    try (StudioScreen ui = new StudioScreen()) {
      ui.button("Choose folder");
      nativeText(Pattern.quote(dir)).click();
      nativeText("(?i)^use this folder$").click();
      nativeText("(?i)^allow$").click();
      ui.button("Open phone file Folder-note.txt");
      ui.value(text, "folder-only");
      ui.closeEditor();
      ui.reload();
      ui.visible("[aria-label='Open phone file Folder-note.txt']");
      ui.button("Manage phone sources");
      ui.button("Disconnect " + dir);
      ui.await("folder forgotten", "!q('.phone-file') && !!btn('Scan my phone')");
    } finally {
      os.executeShellCommand("rm -f " + p + "/Folder-note.txt");
      os.executeShellCommand("rmdir " + p);
    }
  }

  private Uri image(String name, int color) throws Exception {
    ContentValues v = new ContentValues();
    v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
    v.put(MediaStore.MediaColumns.MIME_TYPE, "image/png");
    v.put(MediaStore.MediaColumns.RELATIVE_PATH, "Download/");
    Uri u = app.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
    Bitmap b = Bitmap.createBitmap(180, 100, Bitmap.Config.ARGB_8888);
    try (OutputStream out = app.getContentResolver().openOutputStream(u)) {
      b.eraseColor(color);
      assertTrue(b.compress(Bitmap.CompressFormat.PNG, 100, out));
    } finally {
      b.recycle();
    }
    return u;
  }

  private void pickImage(StudioScreen ui, String name, int count) throws Exception {
    ui.touch(".dropzone");
    nativeText(Pattern.quote(name)).click();
    UiObject2 open = os.wait(Until.findObject(By.text(Pattern.compile("(?i)^open$"))), 900);
    if (open != null) open.click();
    ui.await(
      "selected image " + name,
      "document.querySelectorAll('.photo-list li').length===" + count
    );
  }

  @Test
  public void orderAndRotatePhotosFromAndroidFiles() throws Exception {
    String suffix = String.valueOf(SystemClock.elapsedRealtime()),
      red = "FtRed" + suffix + ".png",
      blue = "FtBlue" + suffix + ".png";
    Uri a = image(red, Color.RED),
      b = image(blue, Color.BLUE);
    try (StudioScreen ui = new StudioScreen()) {
      ui.button("New document");
      ui.button("Create from images");
      pickImage(ui, red, 1);
      pickImage(ui, blue, 2);
      ui.button("Move image 2 up");
      ui.button("Rotate image 2");
      ui.fill("input[placeholder='Photo document']", "Two photo pages");
      ui.button("Create PDF");
      ui.visible("canvas[aria-label='PDF page 1 of 2']");
      File temp = File.createTempFile("photos-", ".pdf", app.getCacheDir());
      try {
        try (
          InputStream in = DeviceLibrary.instance(app).read(id(ui), false).stream;
          OutputStream out = new FileOutputStream(temp)
        ) {
          byte[] bytes = new byte[8192];
          int n;
          while ((n = in.read(bytes)) != -1) out.write(bytes, 0, n);
        }
        try (
          PdfRenderer r = new PdfRenderer(
            ParcelFileDescriptor.open(temp, ParcelFileDescriptor.MODE_READ_ONLY)
          )
        ) {
          assertEquals(2, r.getPageCount());
          for (int i = 0; i < 2; i++) try (PdfRenderer.Page p = r.openPage(i)) {
            assertEquals("Rotation affects orientation", i == 0, p.getWidth() > p.getHeight());
            Bitmap rendered = Bitmap.createBitmap(
              p.getWidth(),
              p.getHeight(),
              Bitmap.Config.ARGB_8888
            );
            rendered.eraseColor(Color.WHITE);
            p.render(rendered, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
            int pixel = rendered.getPixel(p.getWidth() / 2, p.getHeight() / 2);
            assertTrue(
              "Photo color in requested order",
              i == 0
                ? Color.blue(pixel) > 230 && Color.red(pixel) < 30
                : Color.red(pixel) > 230 && Color.blue(pixel) < 30
            );
            rendered.recycle();
          }
        }
      } finally {
        temp.delete();
      }
    } finally {
      app.getContentResolver().delete(a, null, null);
      app.getContentResolver().delete(b, null, null);
    }
  }

  private void job(StudioScreen ui, String tool) throws Exception {
    ui.button("Open PDF toolbox");
    ui.button(tool);
  }

  private void choose(StudioScreen ui, String name, int count) throws Exception {
    String s = StudioScreen.str(name);
    ui.await(
      "choose library file " + name,
      "(()=>{const e=q('select[aria-label=\"Add a library file\"]');if(!e||e.matches(':disabled'))return false;const o=Array.from(e.options).find(o=>o.textContent===" +
        s +
        ");if(!o)return false;e.value=o.value;e.dispatchEvent(new Event('change',{bubbles:true}));return true})()"
    );
    ui.await(
      "file loaded",
      "document.querySelectorAll('.job-list li').length===" + count + " && !q('fieldset:disabled')"
    );
  }

  @Test
  public void mergeAndExportSplitZipViaFiles() throws Exception {
    try (StudioScreen ui = new StudioScreen()) {
      job(ui, "Merge PDFs");
      choose(ui, "Quarterly report.pdf", 1);
      choose(ui, "Studio brand guidelines.pdf", 2);
      ui.fill("input[placeholder='Name your new copy']", "Two reports");
      ui.button("Run tool");
      ui.visible("canvas[aria-label='PDF page 1 of 6']");
      ui.closeEditor();
      job(ui, "Split PDF");
      choose(ui, "Two reports.pdf", 1);
      ui.fill("[aria-label='Page ranges']", "1;2-3");
      String output = "FtParts" + SystemClock.elapsedRealtime(),
        path = "/sdcard/Download/" + output + ".zip";
      ui.fill("input[placeholder='Name your new copy']", output);
      ui.button("Run tool");
      nativeText("(?i)^save$");
      os.pressBack();
      if (!os.wait(Until.gone(By.text(Pattern.compile("(?i)^save$"))), 1500)) os.pressBack();
      ui.await("cancelled export", "document.body.innerText.includes('Export cancelled.')");
      assertEquals(
        "Cancelled export releases temporary copies",
        0,
        new File(app.getCacheDir(), "incoming-documents").list().length
      );
      ui.button("Run tool");
      nativeText("(?i)^save$").click();
      ui.await(
        "export completed",
        "document.body.innerText.includes('" + output + ".zip saved to Files.')"
      );
      try (
        ZipInputStream zip = new ZipInputStream(
          new ParcelFileDescriptor.AutoCloseInputStream(
            inst.getUiAutomation().executeShellCommand("cat " + path)
          )
        )
      ) {
        for (String filename : new String[] { "Part-001.pdf", "Part-002.pdf" }) {
          ZipEntry entry = zip.getNextEntry();
          assertNotNull(entry);
          assertEquals(filename, entry.getName());
          byte[] header = new byte[5];
          new DataInputStream(zip).readFully(header);
          assertEquals("%PDF-", new String(header, "US-ASCII"));
          zip.closeEntry();
        }
        assertNull(zip.getNextEntry());
      } finally {
        os.executeShellCommand("rm -f " + path);
      }
    }
  }

  @Test
  public void offlineOcrProducesSearchablePages() throws Exception {
    DeviceLibrary db = DeviceLibrary.instance(app);
    db.call("workspace", new JSONObject());
    db.call(
      "pdf.create",
      new JSONObject().put("name", "FIELD NOTES").put("text", "A quiet day at the studio.")
    );
    try (StudioScreen ui = new StudioScreen()) {
      job(ui, "OCR PDF");
      choose(ui, "FIELD NOTES.pdf", 1);
      ui.fill("input[placeholder='Name your new copy']", "Searchable scan");
      ui.button("Run tool");
      ui.visible("canvas[aria-label='PDF page 1 of 1']");
      ui.closeEditor();
      job(ui, "PDF to Word");
      choose(ui, "Searchable scan.pdf", 1);
      ui.button("Run tool");
      ui.await(
        "recognized text in editable output",
        "q(\"[aria-label='Word document content']\")?.innerText.toUpperCase().includes('FIELD NOTES')===true"
      );
    }
  }
}
