package studio.ftpdf.app;

import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import org.json.JSONObject;

/** Synthetic files in the instrumentation APK only. Never populate an app at startup. */
final class TestFiles {

  static final Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();

  static InputStream input(String name) throws IOException {
    return InstrumentationRegistry.getInstrumentation().getContext().getAssets().open(name);
  }

  static byte[] bytes(InputStream source) throws IOException {
    try (InputStream in = source; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
      byte[] buf = new byte[8192];
      int n;
      while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
      return out.toByteArray();
    }
  }

  static Uri external(String name, String mime, InputStream source) throws Exception {
    ContentValues v = new ContentValues();
    v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
    v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
    v.put(MediaStore.MediaColumns.RELATIVE_PATH, "Download/");
    try (InputStream in = source) {
      Uri uri = app.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
      if (uri == null) throw new IOException("Could not make test document");
      try (OutputStream out = app.getContentResolver().openOutputStream(uri)) {
        out.write(bytes(in));
      }
      return uri;
    }
  }

  static void libraryPdf(String name) throws Exception {
    DeviceLibrary db = DeviceLibrary.instance(app);
    db.call("workspace", new JSONObject());
    Object stage = db.call("upload.begin", new JSONObject());
    db.call(
      "upload.append",
      new JSONObject()
        .put("id", stage)
        .put("part", "file")
        .put("data", Base64.encodeToString(bytes(input("field-sheets.pdf")), Base64.NO_WRAP))
    );
    db.call(
      "document.put",
      new JSONObject().put("stage", stage).put("name", name).put("type", "pdf").put("pages", 3)
    );
  }

  private TestFiles() {}
}
