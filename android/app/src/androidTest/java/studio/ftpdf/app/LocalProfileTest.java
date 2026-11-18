package studio.ftpdf.app;

import static org.junit.Assert.*;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;

/** CI force-stops the app between these two scenarios. */
@RunWith(AndroidJUnit4.class)
public class LocalProfileTest {

  static final String email = "reader@example.test",
    pw = "a local reading profile";

  private static void drawer(StudioScreen ui) throws Exception {
    if ("true".equals(ui.js("!!btn('Open navigation')"))) ui.button("Open navigation");
  }

  @Test
  public void createProfileAndCollection() throws Exception {
    try (StudioScreen ui = new StudioScreen()) {
      ui.value(".profile-btn", "Alex Morgan");
      androidx.test.uiautomator.UiDevice.getInstance(
        androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
      ).takeScreenshot(new java.io.File(ui.app.getCacheDir(), "first-launch.png"));
      assertEquals(
        "seeded sample files",
        12,
        ((JSONObject) DeviceLibrary.instance(ui.app).call("workspace", new JSONObject()))
          .getJSONArray("documents")
          .length()
      );
      drawer(ui);
      ui.button("New collection");
      ui.fill("input[placeholder='e.g. Studio projects']", "Personal drafts");
      ui.button("Create collection");
      ui.value("h1", "Personal drafts");
      ui.newDoc("Text", "Private draft");
      ui.button("Create document");
      ui.edit();
      ui.fill("textarea.text-page", "My saved field notes");
      ui.save();
      ui.closeDocument();
      drawer(ui);
      ui.click(".profile-btn");
      ui.button("Create account");
      ui.fill("input[name=name]", "Local reader");
      ui.fill("input[name=email]", email);
      ui.fill("input[name=password]", pw);
      ui.click("[role=dialog] button[type=submit], [role=dialog] form .btn.primary");
      ui.value(".profile-btn", "Local reader");
      drawer(ui);
      ui.button("Settings");
      ui.click(".theme-choice:nth-child(2)");
      ui.await(
        "theme saved",
        "document.documentElement.dataset.theme==='espresso' && !q('.theme-choice:disabled')"
      );
    }
  }

  @Test
  public void recoverProfileAndEnforceIsolation() throws Exception {
    try (StudioScreen ui = new StudioScreen()) {
      DeviceLibrary db = DeviceLibrary.instance(ui.app);
      ui.value(".profile-btn", "Local reader");
      ui.await("persisted theme", "document.documentElement.dataset.theme==='espresso'");
      drawer(ui);
      ui.button("Personal drafts");
      ui.button("Open Private draft.txt");
      ui.value(".reader-text", "My saved field notes");
      String id = ui.documentId();
      ui.closeDocument();
      drawer(ui);
      ui.click(".profile-btn");
      ui.button("Sign out");
      ui.click(".modal-footer button:last-child");
      ui.value(".profile-btn", "Alex Morgan");
      assertFalse(
        "guest cannot see the collection",
        ui.js("document.body.textContent.includes('Personal drafts')").equals("true")
      );
      try {
        db.read(id, false).stream.close();
        fail("guest accessed private bytes");
      } catch (java.io.IOException expected) {
        assertEquals("Document not found.", expected.getMessage());
      }
      drawer(ui);
      ui.click(".profile-btn");
      ui.button("Sign in");
      ui.fill("input[name=email]", email);
      ui.fill("input[name=password]", pw);
      ui.click("[role=dialog] form .btn.primary");
      ui.value(".profile-btn", "Local reader");
      drawer(ui);
      ui.button("Personal drafts");
      ui.button("Open Private draft.txt");
      ui.reader();
      ui.button("Delete document");
      ui.value(".dialog-copy", "Private draft.txt");
      ui.button("Cancel");
      ui.reader();
      ui.button("Delete document");
      ui.button("Move to Trash");
      ui.await("trashed", "!!q('.main-content') && !q(\"[aria-label='Open Private draft.txt']\")");
      assertTrue(
        "trash persisted before it becomes actionable",
        ((JSONObject) db.call("document.info", new JSONObject().put("id", id))).getBoolean(
          "trashed"
        )
      );
      drawer(ui);
      ui.button("Trash");
      ui.button("Restore Private draft");
      ui.await("restored", "document.body.textContent.includes('Trash is empty')");
      assertFalse(
        "restore persisted",
        ((JSONObject) db.call("document.info", new JSONObject().put("id", id))).getBoolean(
          "trashed"
        )
      );
      drawer(ui);
      ui.button("Personal drafts");
      ui.button("Open Private draft.txt");
      ui.value(".reader-text", "My saved field notes");
    }
  }
}
