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

  private String nativeScreen() {
    StringBuilder labels = new StringBuilder();
    for (UiObject2 e : os.findObjects(By.text(Pattern.compile(".+")))) {
      if (labels.length() > 600) break;
      labels.append(" | ").append(e.getText());
    }
    return " package=" + os.getCurrentPackageName() + " text=" + labels;
  }

  private UiObject2 nativeText(String s) {
    UiObject2 o = os.wait(Until.findObject(By.text(Pattern.compile(s))), 15000);
    if (o == null) throw new AssertionError("Android picker: " + s + nativeScreen());
    return o;
  }

  private UiObject2 imageInFiles(String name) {
    String stem = name.substring(0, name.lastIndexOf('.'));
    UiObject2 o = os.wait(Until.findObject(By.textContains(stem)), 6500);
    if (o == null) o = os.wait(Until.findObject(By.descContains(stem)), 2000);
    if (o == null) throw new AssertionError("Image missing: " + name + nativeScreen());
    // Photo grids may expose only a "Preview the file ..." child. Select the
    // enclosing item, not its magnifying-glass affordance.
    for (
      UiObject2 child = o, parent = o.getParent();
      parent != null;
      child = parent, parent = parent.getParent()
    ) {
      String cls = parent.getClassName(),
        id = parent.getResourceName();
      if (
        (cls != null && cls.contains("RecyclerView")) || (id != null && id.endsWith("/dir_list"))
      ) return child;
    }
    return o;
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
      String copy = ui.documentId();
      ui.edit();
      ui.fill(text, "Private edits stay in Ft PDF");
      ui.save();
      ui.closeDocument();
      ui.button("Open phone file " + name);
      ui.value(text, "Private edits stay in Ft PDF");
      assertEquals("Reuse same working copy", copy, ui.documentId());
      assertEquals("shared-original", os.executeShellCommand("cat " + path).trim());
      ui.closeDocument();
      shellText(path, "New version from outside the app");
      ui.button("Open phone file " + name);
      ui.value(text, "New version from outside the app");
      assertNotEquals("Changed source opens as a new copy", copy, ui.documentId());
      ui.reader();
      String changed = ui.documentId();
      ui.button("Delete document");
      ui.value(".dialog-copy", name);
      ui.button("Move to Trash");
      ui.visible(".main-content");
      assertTrue(
        "Reader deleted only the library copy",
        (
          (JSONObject) DeviceLibrary.instance(app).call(
            "document.info",
            new JSONObject().put("id", changed)
          )
        ).getBoolean("trashed")
      );
      assertEquals(
        "New version from outside the app",
        os.executeShellCommand("cat " + path).trim()
      );
      ui.button("Undo");
      ui.value(".toast", "Document restored");
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
      ui.closeDocument();
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
    v.put(MediaStore.MediaColumns.IS_PENDING, 1);
    Uri u = app.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
    Bitmap b = Bitmap.createBitmap(180, 100, Bitmap.Config.ARGB_8888);
    try (OutputStream out = app.getContentResolver().openOutputStream(u)) {
      b.eraseColor(color);
      assertTrue(b.compress(Bitmap.CompressFormat.PNG, 100, out));
    } finally {
      b.recycle();
    }
    v.clear();
    v.put(MediaStore.MediaColumns.IS_PENDING, 0);
    assertEquals(1, app.getContentResolver().update(u, v, null, null));
    String path = "/sdcard/Download/" + name;
    assertEquals(
      "Published image visible in Downloads",
      path,
      os.executeShellCommand("ls " + path).trim()
    );
    return u;
  }

  private boolean pickPair(StudioScreen ui, String red, String blue) throws Exception {
    ui.js(
      "(()=>{window.__photoNames=[];document.addEventListener('change',e=>{if(e.target.type==='file')window.__photoNames=Array.from(e.target.files,f=>[f.name,f.size]);},true);return true})()"
    );
    ui.touch(".dropzone");
    UiObject2 list = os.wait(Until.findObject(By.desc("List view")), 1000);
    if (list != null) list.click();
    imageInFiles(red).longClick();
    imageInFiles(blue).click();
    // ACTION_OPEN_DOCUMENT in multi-selection mode uses action_menu_select
    // ("Select", not necessarily "Open"). A tap on a preview is not a pick.
    UiObject2 confirm = os.wait(
      Until.findObject(By.res(Pattern.compile(".*:id/action_menu_select"))),
      4000
    );
    if (confirm == null) confirm = os.wait(
      Until.findObject(By.text(Pattern.compile("(?i)^(select|open|add)( .*)?$"))),
      3000
    );
    if (confirm == null) throw new AssertionError("Confirm both images in Files:" + nativeScreen());
    confirm.click();
    try {
      ui.await(
        "both selected images loaded",
        "document.querySelectorAll('.photo-list li').length===2"
      );
    } catch (AssertionError ignored) {
      throw new AssertionError(
        "Image chooser result=" +
          ui.js("JSON.stringify(window.__photoNames)") +
          " state=" +
          ui.js("q('.modal')?.innerText.slice(-900)") +
          nativeScreen()
      );
    }
    String first = new JSONTokener(ui.js("q('.photo-list li strong')?.textContent"))
      .nextValue()
      .toString();
    assertTrue("One of the two selected images", red.equals(first) || blue.equals(first));
    return red.equals(first);
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
      boolean redInitiallyFirst = pickPair(ui, red, blue);
      ui.button("Move image 2 up");
      ui.button("Rotate image 2");
      ui.fill("input[placeholder='Photo document']", "Two photo pages");
      ui.button("Create PDF");
      ui.visible("canvas[aria-label='PDF page 1 of 2']");
      File temp = File.createTempFile("photos-", ".pdf", app.getCacheDir());
      try {
        try (
          InputStream in = DeviceLibrary.instance(app).read(ui.documentId(), false).stream;
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
              (i == 0) == redInitiallyFirst
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
    TestFiles.libraryPdf("Merge left");
    TestFiles.libraryPdf("Merge right");
    try (StudioScreen ui = new StudioScreen()) {
      job(ui, "Merge PDFs");
      choose(ui, "Merge left.pdf", 1);
      choose(ui, "Merge right.pdf", 2);
      ui.fill("input[placeholder='Name your new copy']", "Two reports");
      ui.button("Run tool");
      ui.visible("canvas[aria-label='PDF page 1 of 6']");
      ui.closeDocument();
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
  public void passwordProtectedCopyRoundTrip() throws Exception {
    TestFiles.libraryPdf("Protection input");
    try (StudioScreen ui = new StudioScreen()) {
      String pw = "[role='dialog'] input[type='password']";
      job(ui, "Protect PDF");
      choose(ui, "Protection input.pdf", 1);
      ui.fill(pw, "local-example-pass");
      ui.fill("input[placeholder='Name your new copy']", "Protected report");
      ui.button("Run tool");
      ui.await("password required to view protected PDF", "!!btn('Unlock document')");
      ui.fill(pw, "local-example-pass");
      ui.button("Unlock document");
      ui.visible("canvas[aria-label='PDF page 1 of 3']");
      ui.reader();
      assertEquals("Protected copy stays read-only", "false", ui.js("!!q('.read-edit-btn')"));
      ui.closeDocument();
      job(ui, "Unlock PDF");
      choose(ui, "Protected report.pdf", 1);
      ui.fill(pw, "local-example-pass");
      ui.fill("input[placeholder='Name your new copy']", "Readable report");
      ui.button("Run tool");
      ui.visible("canvas[aria-label='PDF page 1 of 3']");
      ui.edit();
      ui.await("unlocked output can be edited", "!!btn('Text')");
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
      ui.closeDocument();
      job(ui, "PDF to Word");
      choose(ui, "Searchable scan.pdf", 1);
      ui.button("Run tool");
      ui.await(
        "recognized text in the Word reader",
        "q(\"[aria-label='Word document content']\")?.innerText.toUpperCase().includes('FIELD NOTES')===true"
      );
    }
  }
}
