package studio.ftpdf.app;

import static org.junit.Assert.*;

import android.content.*;
import android.os.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;

/** CI force-stops the installed package between these two cases. */
@RunWith(AndroidJUnit4.class)
public class IndexRestartTest {

  final Context app = TestFiles.app;
  final SharedPreferences qa = app.getSharedPreferences("checkpoint-test", 0);
  final DeviceLibrary library = DeviceLibrary.instance(app);

  private File create(File dir, String name, String content) throws Exception {
    File f = new File(dir, name);
    try (FileOutputStream out = new FileOutputStream(f)) {
      out.write(content.getBytes(StandardCharsets.UTF_8));
    }
    return f;
  }

  @Test
  public void rememberFirstScan() throws Exception {
    File dir = new File(
      Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS),
      "FtIndexQA" + SystemClock.elapsedRealtime()
    );
    assertTrue(dir.mkdirs());
    File known = create(dir, "Remember.txt", "first");
    create(dir, "Removed.txt", "remove later");
    PhoneFiles index = new PhoneFiles(app, library);
    String owner = library.currentOwner();
    index.enable(owner, true);
    index.scan(owner, true);
    JSONObject page = index.page(owner, dir.getName(), 0, false, false);
    assertEquals(2, page.getInt("total"));
    String id = index
      .page(owner, known.getName(), 0, false, false)
      .getJSONArray("files")
      .getJSONObject(0)
      .getString("id");
    assertTrue(
      qa
        .edit()
        .putString("dir", dir.getPath())
        .putString("id", id)
        .putLong("checked", page.getLong("checked"))
        .commit()
    );
  }

  @Test
  public void coldListThenOnlyNewFiles() throws Exception {
    File dir = new File(qa.getString("dir", ""));
    assertTrue(dir.getName().startsWith("FtIndexQA"));
    String owner = library.currentOwner();
    PhoneFiles index = new PhoneFiles(app, library);
    String id = qa.getString("id", "");
    try {
      JSONObject page = index.page(owner, dir.getName(), 0, false, false);
      assertEquals(qa.getLong("checked", -1), page.getLong("checked"));
      assertTrue("Android all-files grant must still be present", page.getBoolean("allowed"));
      assertTrue(
        "An acknowledged source opt-in must survive force-stop",
        page.getBoolean("enabled")
      );
      assertEquals(
        "Cold page before rescanning, synthetic folder=" + dir.getName() + "; " + page,
        2,
        page.getInt("total")
      );
      assertEquals("first", new String(TestFiles.bytes(index.open(id)), StandardCharsets.UTF_8));
      try (StudioScreen ui = new StudioScreen()) {
        ui.fill("[aria-label='Search phone files']", dir.getName());
        ui.visible("[aria-label='Open phone file Remember.txt']");
        ui.await("initial refresh settled", "!!btn('Refresh phone documents')");
        create(dir, "Remember.txt", "changed outside");
        create(dir, "Discovered.txt", "second scan");
        assertTrue(new File(dir, "Removed.txt").delete());
        ui.button("Refresh phone documents");
        ui.button("1 new document · View");
        ui.visible("[aria-label='Open phone file Discovered.txt']");
        ui.await("only additions in filter", "!btn('Open phone file Remember.txt')");
        ui.button("Show all files");
        ui.fill("[aria-label='Search phone files']", dir.getName());
        ui.visible("[aria-label='Open phone file Remember.txt']");
        PhoneFiles fresh = new PhoneFiles(app, library);
        JSONObject refreshed = fresh.page(owner, dir.getName(), 0, false, false);
        assertEquals("Reopened metadata after delta: " + refreshed, 2, refreshed.getInt("total"));
        assertEquals(
          "changed outside",
          new String(TestFiles.bytes(fresh.open(id)), StandardCharsets.UTF_8)
        );
        ui.button("Refresh phone documents");
        ui.await(
          "unchanged scan has no additions",
          "!!btn('Refresh phone documents')&&!btn('1 new document · View')"
        );
        ui.button("Manage phone sources");
        ui.button("Stop phone scan");
        ui.await("revoked source not listed", "!q('.phone-file')");
        try {
          new PhoneFiles(app, library).open(id);
          fail("disconnected id still readable");
        } catch (IOException expected) {}
      }
    } finally {
      for (String n : new String[] { "Remember.txt", "Removed.txt", "Discovered.txt" })
        new File(dir, n).delete();
      dir.delete();
      qa.edit().clear().commit();
    }
  }
}
