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
    try (
      StudioScreen ui = new StudioScreen(
        androidx.test.core.app.ActivityScenario.launch(MainActivity.class)
      )
    ) {
      ui.value("h1", "Welcome to Ft PDF.");
      androidx.test.uiautomator.UiDevice.getInstance(
        androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
      ).takeScreenshot(new java.io.File(ui.app.getCacheDir(), "first-launch.png"));
      ui.button("Take the tour");
      ui.button("Star sample");
      ui.button("Edit sample");
      ui.fill(".practice-paper", "Practice only");
      ui.button("Done");
      ui.value(".practice-paper", "Practice only");
      ui.button("Continue to profile");
      ui.fill("input[name=displayName]", "First reader");
      ui.fill("input[name=birthday]", "1999-11-05");
      ui.button("Open my library");
      ui.value(".profile-btn", "First reader");
      JSONObject w = (JSONObject) DeviceLibrary.instance(ui.app).call(
        "workspace",
        new JSONObject()
      );
      for (String key : new String[] { "documents", "collections", "activity" })
        assertEquals("no tour data in " + key, 0, w.getJSONArray(key).length());
      assertEquals("1999-11-05", w.getJSONObject("user").getString("birthDate"));
      assertFalse(w.getJSONObject("user").getBoolean("needsSetup"));
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
      assertEquals(
        "profile date survives process death",
        "1999-11-05",
        ((JSONObject) db.call("workspace", new JSONObject()))
          .getJSONObject("user")
          .getString("birthDate")
      );
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
      ui.value(".profile-btn", "Guest");
      assertTrue(
        "birth date belongs only to the signed-out owner",
        ((JSONObject) db.call("workspace", new JSONObject()))
          .getJSONObject("user")
          .isNull("birthDate")
      );
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
