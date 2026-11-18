package studio.ftpdf.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.view.Gravity;
import android.view.WindowInsets;
import android.webkit.*;
import android.widget.*;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.io.*;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

/** The UI, editors, fonts, example documents and backend all ship inside the APK. */
public final class MainActivity extends Activity {

  private static final String HOST = "appassets.androidplatform.net",
    ORIGIN = "https://" + HOST;
  private static final int PICK = 20,
    SAVE = 21,
    CREAM = 0xfffbfaf7;
  private static final String[] TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/html",
  };
  private final ExecutorService io = Executors.newSingleThreadExecutor();
  private final Map<String, Uri> inbox = Collections.synchronizedMap(new LinkedHashMap<>());
  private WebView web;
  private FrameLayout root;
  private DeviceLibrary library;
  private String pendingExport;
  private ValueCallback<Uri[]> picker;

  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    root = new FrameLayout(this);
    root.setBackgroundColor(CREAM);
    setContentView(root);
    if (Build.VERSION.SDK_INT >= 35) root.setOnApplyWindowInsetsListener((v, i) -> {
      android.graphics.Insets b = i.getInsets(
        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime()
      );
      v.setPadding(b.left, b.top, b.right, b.bottom);
      return WindowInsets.CONSUMED;
    });
    if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
      android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,
      this::back
    );
    library = DeviceLibrary.instance(this);
    if (state == null) queue(getIntent());
    else {
      pendingExport = state.getString("export");
      ArrayList<Uri> items = state.getParcelableArrayList("inbox");
      if (items != null) for (Uri u : items) add(u);
    }
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
      showError("Update Android System WebView to open your document library.");
      return;
    }
    web = new WebView(this);
    web.setId(R.id.library_webview);
    web.setBackgroundColor(CREAM);
    root.addView(web);
    WebSettings settings = web.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(true);
    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    android.content.pm.PackageInfo provider = WebView.getCurrentWebViewPackage();
    if (provider != null && leadingVersion(provider.versionName) < 105) {
      showError("Update Android System WebView (or Chrome) to use Ft PDF’s offline editors.");
      return;
    }
    web.setWebViewClient(
      new WebViewClient() {
        @Override
        public boolean shouldOverrideUrlLoading(WebView w, WebResourceRequest r) {
          return (
            !r.isForMainFrame() ||
            !trusted(r.getUrl()) ||
            !"/index.html".equals(r.getUrl().getPath())
          );
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView w, WebResourceRequest r) {
          return resource(r);
        }

        @Override
        public void onReceivedError(WebView w, WebResourceRequest r, WebResourceError e) {
          if (r.isForMainFrame()) runOnUiThread(() ->
            showError("Could not open the installed library. Close and reopen Ft PDF.")
          );
        }
      }
    );
    web.setWebChromeClient(
      new WebChromeClient() {
        @Override
        public boolean onShowFileChooser(WebView w, ValueCallback<Uri[]> cb, FileChooserParams p) {
          if (
            w.getUrl() == null || !ORIGIN.concat("/index.html").equals(w.getUrl().split("#", 2)[0])
          ) return false;
          if (picker != null) picker.onReceiveValue(null);
          picker = cb;
          Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*")
            .putExtra(Intent.EXTRA_MIME_TYPES, TYPES)
            .putExtra(
              Intent.EXTRA_ALLOW_MULTIPLE,
              p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE
            );
          try {
            startFiles(i, PICK);
          } catch (Exception e) {
            picker = null;
            cb.onReceiveValue(null);
            toast("The system file picker is unavailable.");
          }
          return true;
        }
      }
    );
    // Unlike addJavascriptInterface, this API checks the sender origin and frame on every call.
    WebViewCompat.addWebMessageListener(
      web,
      "FtDevice",
      Collections.singleton(ORIGIN),
      (w, msg, from, main, reply) -> {
        if (!main || !trusted(from) || w != web) return;
        String data = msg.getData();
        if (data == null || data.length() > 450000) return;
        io.execute(() -> {
          JSONObject response = new JSONObject();
          try {
            JSONObject request = new JSONObject(data);
            response.put("id", request.getString("id"));
            String op = request.getString("op");
            JSONObject a = request.optJSONObject("args");
            if (a == null) a = new JSONObject();
            Object value;
            if (op.equals("inbox.list")) value = inboxList();
            else if (op.equals("inbox.done")) {
              inbox.remove(a.getString("id"));
              value = true;
            } else if (op.equals("export")) {
              JSONObject d = (JSONObject) library.call("document.info", a);
              runOnUiThread(() -> export(d));
              value = true;
            } else value = library.call(op, a);
            response.put("ok", true).put("value", value);
          } catch (Exception e) {
            try {
              response
                .put("ok", false)
                .put(
                  "error",
                  e.getMessage() == null
                    ? "The library could not complete this action."
                    : e.getMessage()
                );
            } catch (Exception ignored) {}
          }
          runOnUiThread(() -> {
            if (!isDestroyed() && web == w) reply.postMessage(response.toString());
          });
        });
      }
    );
    web.loadUrl(ORIGIN + "/index.html");
  }

  private static int leadingVersion(String v) {
    try {
      return Integer.parseInt(v.split("\\.")[0]);
    } catch (Exception e) {
      return 0;
    }
  }

  private void startFiles(Intent i, int request) {
    i.putExtra(
      android.provider.DocumentsContract.EXTRA_INITIAL_URI,
      android.provider.DocumentsContract.buildDocumentUri(
        "com.android.externalstorage.documents",
        "primary:Download"
      )
    );
    startActivityForResult(i, request);
  }

  private static boolean trusted(Uri u) {
    return u != null && "https".equals(u.getScheme()) && HOST.equals(u.getEncodedAuthority());
  }

  private void showError(String msg) {
    TextView t = new TextView(this);
    t.setText(msg);
    t.setPadding(32, 48, 32, 48);
    t.setGravity(Gravity.CENTER);
    root.removeAllViews();
    root.addView(t);
  }

  private static String mime(String path) {
    String p = path.toLowerCase(Locale.ROOT);
    if (p.endsWith(".html")) return "text/html";
    if (p.endsWith(".mjs") || p.endsWith(".js")) return "application/javascript";
    if (p.endsWith(".css")) return "text/css";
    if (p.endsWith(".json")) return "application/json";
    if (p.endsWith(".svg")) return "image/svg+xml";
    if (p.endsWith(".png")) return "image/png";
    if (p.endsWith(".ttf")) return "font/ttf";
    if (p.endsWith(".woff2")) return "font/woff2";
    return "application/octet-stream";
  }

  private static WebResourceResponse denied(int status) {
    return new WebResourceResponse(
      "text/plain",
      "UTF-8",
      status,
      "Unavailable",
      Collections.singletonMap("Cache-Control", "no-store"),
      new ByteArrayInputStream(new byte[0])
    );
  }

  private WebResourceResponse resource(WebResourceRequest r) {
    Uri uri = r.getUrl();
    String path = uri.getPath();
    if (
      !trusted(uri) ||
      !"GET".equals(r.getMethod()) ||
      path == null ||
      path.contains("..") ||
      path.contains("\\") ||
      path.contains("\u0000")
    ) return denied(403);
    try {
      Map<String, String> h = new HashMap<>();
      h.put("X-Content-Type-Options", "nosniff");
      h.put("Cache-Control", "no-store");
      if (path.startsWith("/device-file/") || path.startsWith("/inbox/")) {
        if (
          r.isForMainFrame() ||
          (!"1".equals(r.getRequestHeaders().get("X-Ft-Read")) &&
            !"1".equals(r.getRequestHeaders().get("x-ft-read")))
        ) return denied(403);
        h.put("Content-Security-Policy", "sandbox; default-src 'none'");
        InputStream stream;
        if (path.startsWith("/inbox/")) {
          Uri u = inbox.get(path.substring(7));
          if (u == null) return denied(404);
          InputStream in = getContentResolver().openInputStream(u);
          if (in == null) return denied(404);
          stream = new LimitedInputStream(in);
        } else {
          List<String> parts = uri.getPathSegments();
          if (parts.size() != 3) return denied(404);
          DeviceLibrary.Data d = library.read(parts.get(1), "content".equals(parts.get(2)));
          stream = d.stream;
          h.put("X-Ft-Updated", String.valueOf(d.updated));
        }
        return new WebResourceResponse("application/octet-stream", null, 200, "OK", h, stream);
      }
      if (
        !(
          path.equals("/index.html") ||
          path.equals("/brand.svg") ||
          path.startsWith("/assets/") ||
          path.startsWith("/fonts/") ||
          path.startsWith("/icons/") ||
          path.startsWith("/pdf-assets/")
        )
      ) return denied(404);
      if (path.equals("/index.html")) h.put(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob:; worker-src 'self' blob:; frame-src 'self' blob: about:; object-src 'none'; base-uri 'none'; form-action 'none'"
      );
      String type = mime(path);
      return new WebResourceResponse(
        type,
        type.startsWith("text/") || type.equals("application/javascript") ? "UTF-8" : null,
        200,
        "OK",
        h,
        getAssets().open("studio" + path)
      );
    } catch (Exception e) {
      return denied(404);
    }
  }

  private static final class LimitedInputStream extends FilterInputStream {

    int seen;

    LimitedInputStream(InputStream in) {
      super(in);
    }

    private int check(int n) throws IOException {
      if (n > 0 && (seen += n) > DeviceLibrary.MAX) throw new IOException("File exceeds 25 MB.");
      return n;
    }

    @Override
    public int read(byte[] b, int off, int len) throws IOException {
      return check(super.read(b, off, len));
    }

    @Override
    public int read() throws IOException {
      int b = super.read();
      if (b >= 0) check(1);
      return b;
    }
  }

  private void add(Uri u) {
    if (
      u != null && "content".equals(u.getScheme()) && inbox.size() < 30 && !inbox.containsValue(u)
    ) inbox.put(UUID.randomUUID().toString(), u);
  }

  private void queue(Intent intent) {
    if (intent == null) return;
    String a = intent.getAction();
    if (Intent.ACTION_VIEW.equals(a)) add(intent.getData());
    if (Intent.ACTION_SEND.equals(a) || Intent.ACTION_SEND_MULTIPLE.equals(a)) {
      ClipData c = intent.getClipData();
      if (c != null) for (int i = 0; i < c.getItemCount(); i++) add(c.getItemAt(i).getUri());
      if (Intent.ACTION_SEND.equals(a)) add(intent.getParcelableExtra(Intent.EXTRA_STREAM));
      else {
        ArrayList<Uri> l = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
        if (l != null) for (Uri u : l) add(u);
      }
    }
  }

  private JSONArray inboxList() throws Exception {
    JSONArray out = new JSONArray();
    synchronized (inbox) {
      for (Map.Entry<String, Uri> item : inbox.entrySet()) {
        String name = "Shared document";
        long size = -1;
        try (
          Cursor c = getContentResolver().query(
            item.getValue(),
            new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE },
            null,
            null,
            null
          )
        ) {
          if (c != null && c.moveToFirst()) {
            if (c.getString(0) != null) name = c.getString(0);
            if (!c.isNull(1)) size = c.getLong(1);
          }
        } catch (Exception ignored) {}
        String type = getContentResolver().getType(item.getValue());
        if (!name.contains(".") && type != null) {
          int ix = Arrays.asList(TYPES).indexOf(type);
          if (ix >= 0) name += new String[] { ".pdf", ".doc", ".docx", ".txt", ".html" }[ix];
        }
        out.put(new JSONObject().put("id", item.getKey()).put("name", name).put("size", size));
      }
    }
    return out;
  }

  private static String docMime(String t) {
    return "pdf".equals(t)
      ? TYPES[0]
      : "docx".equals(t)
        ? TYPES[2]
        : "html".equals(t)
          ? TYPES[4]
          : TYPES[3];
  }

  private void export(JSONObject doc) {
    if (isFinishing() || isDestroyed()) return;
    if (pendingExport != null) {
      toast("Finish the current export first.");
      return;
    }
    String type = doc.optString("type");
    pendingExport = doc.optString("id");
    try {
      startFiles(
        new Intent(Intent.ACTION_CREATE_DOCUMENT)
          .addCategory(Intent.CATEGORY_OPENABLE)
          .setType(docMime(type))
          .putExtra(Intent.EXTRA_TITLE, doc.optString("name") + "." + type),
        SAVE
      );
    } catch (Exception e) {
      pendingExport = null;
      toast("The system save dialog is unavailable.");
    }
  }

  @Override
  protected void onActivityResult(int code, int result, Intent data) {
    super.onActivityResult(code, result, data);
    if (code == PICK && picker != null) {
      ArrayList<Uri> items = new ArrayList<>();
      if (result == RESULT_OK && data != null) {
        ClipData c = data.getClipData();
        if (c != null) {
          for (int i = 0; i < c.getItemCount(); i++) {
            Uri u = c.getItemAt(i).getUri();
            if (u != null && "content".equals(u.getScheme())) items.add(u);
          }
        } else if (
          data.getData() != null && "content".equals(data.getData().getScheme())
        ) items.add(data.getData());
      }
      picker.onReceiveValue(items.isEmpty() ? null : items.toArray(new Uri[0]));
      picker = null;
    }
    if (code == SAVE) {
      String id = pendingExport;
      pendingExport = null;
      if (result != RESULT_OK || data == null || data.getData() == null || id == null) return;
      Uri dest = data.getData();
      if (!"content".equals(dest.getScheme())) return;
      io.execute(() -> {
        try (
          InputStream in = library.read(id, false).stream;
          OutputStream out = getContentResolver().openOutputStream(dest, "wt")
        ) {
          if (out == null) throw new IOException("Destination unavailable");
          byte[] b = new byte[32768];
          int n;
          while ((n = in.read(b)) != -1) out.write(b, 0, n);
        } catch (Exception e) {
          runOnUiThread(() -> toast("Could not export: " + e.getMessage()));
          return;
        }
        runOnUiThread(() -> toast("Document saved to Files"));
      });
    }
  }

  private void toast(String s) {
    Toast.makeText(this, s, Toast.LENGTH_LONG).show();
  }

  @Override
  protected void onNewIntent(Intent i) {
    super.onNewIntent(i);
    // The inbox owns pending grants. Do not replace the activity’s launch intent
    // with an already-consumed file when a second document is opened.
    queue(i);
    if (web != null) web.evaluateJavascript("window.dispatchEvent(new Event('ft:inbox'))", null);
  }

  @Override
  protected void onSaveInstanceState(Bundle state) {
    super.onSaveInstanceState(state);
    state.putString("export", pendingExport);
    synchronized (inbox) {
      state.putParcelableArrayList("inbox", new ArrayList<>(inbox.values()));
    }
  }

  private void back() {
    if (web == null) {
      finish();
      return;
    }
    web.evaluateJavascript("window.dispatchEvent(new Event('ft:back',{cancelable:true}))", r -> {
      if (!"false".equals(r)) finish();
    });
  }

  @Override
  public void onBackPressed() {
    back();
  }

  @Override
  protected void onDestroy() {
    if (picker != null) picker.onReceiveValue(null);
    io.shutdown();
    if (web != null) {
      root.removeView(web);
      web.destroy();
      web = null;
    }
    super.onDestroy();
  }
}
