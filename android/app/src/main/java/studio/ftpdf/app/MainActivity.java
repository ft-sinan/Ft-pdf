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

/** The UI, readers, editors, fonts and backend all ship inside the APK. */
public class MainActivity extends Activity {

  private static final String HOST = "appassets.androidplatform.net",
    ORIGIN = "https://" + HOST;
  private static final int PICK = 20,
    SAVE = 21,
    TREE = 22,
    ACCESS = 23,
    CAMERA = 24,
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
  private PhoneFiles phone;
  private String sourceOwner;
  private final ExecutorService scans = Executors.newSingleThreadExecutor();
  private String pendingExport;
  private java.util.function.BiConsumer<Boolean, String> exportReply;
  private ValueCallback<Uri[]> picker;
  private Uri captureUri;
  private File captureFile;

  private void takePhoto() throws Exception {
    File dir = new File(getCacheDir(), "photo-captures");
    dir.mkdirs();
    for (File f : Optional.ofNullable(dir.listFiles()).orElse(new File[0]))
      if (f.lastModified() < System.currentTimeMillis() - 86400000L) f.delete();
    captureFile = File.createTempFile("Page-", ".jpg", dir);
    captureUri = androidx.core.content.FileProvider.getUriForFile(
      this,
      getPackageName() + ".capture",
      captureFile
    );
    Intent i = new Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE)
      .putExtra(android.provider.MediaStore.EXTRA_OUTPUT, captureUri)
      .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
    i.setClipData(ClipData.newRawUri("Page", captureUri));
    startActivityForResult(i, CAMERA);
  }

  protected boolean externalReader() {
    return false;
  }

  private boolean pdfView(Intent i) {
    if (
      i == null ||
      !Intent.ACTION_VIEW.equals(i.getAction()) ||
      i.getData() == null ||
      !"content".equals(i.getData().getScheme())
    ) return false;
    Uri uri = i.getData();
    if ((getPackageName() + ".capture").equals(uri.getAuthority())) return false;
    try {
      return (
        "application/pdf".equalsIgnoreCase(i.resolveType(this)) ||
        (uri.getLastPathSegment() != null &&
          uri.getLastPathSegment().toLowerCase(Locale.ROOT).endsWith(".pdf"))
      );
    } catch (RuntimeException unavailable) {
      return false;
    }
  }

  private void forwardPdf(Intent i) {
    // Older defaults may explicitly address MainActivity. Forward only the read grant.
    Intent reader = new Intent(Intent.ACTION_VIEW)
      .setClass(this, OpenPdfActivity.class)
      .setDataAndType(i.getData(), "application/pdf");
    try {
      startActivity(reader.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
    } catch (SecurityException expired) {
      startActivity(reader.setFlags(0));
    }
  }

  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    if (!externalReader() && pdfView(getIntent())) {
      forwardPdf(getIntent());
      finish();
      return;
    }
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
    phone = new PhoneFiles(this, library);
    if (externalReader() && !pdfView(getIntent())) {
      showError("This PDF is unavailable. Go back and open it again from Files.");
      return;
    }
    if (state == null) queue(getIntent());
    else {
      pendingExport = state.getString("export");
      sourceOwner = state.getString("sourceOwner");
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
    settings.setBuiltInZoomControls(true); // Pinch to read without a toolbar.
    settings.setDisplayZoomControls(false);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(true);
    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    android.content.pm.PackageInfo provider = WebView.getCurrentWebViewPackage();
    if (provider != null && leadingVersion(provider.versionName) < 105) {
      showError("Update Android System WebView (or Chrome) to use Ft PDF’s offline editors.");
      return;
    }
    // Never navigate the studio WebView away from its local origin. Only a main-frame
    // user tap on an exact bundled contact can launch an external app, with no document URI.
    Set<String> contacts = creatorLinks();
    web.setWebViewClient(
      new WebViewClient() {
        @Override
        public boolean shouldOverrideUrlLoading(WebView w, WebResourceRequest r) {
          if (
            r.isForMainFrame() &&
            r.hasGesture() &&
            !r.isRedirect() &&
            contacts.contains(r.getUrl().toString()) &&
            w.getUrl() != null &&
            (ORIGIN + "/index.html").equals(w.getUrl().split("#", 2)[0])
          ) {
            Uri link = r.getUrl();
            try {
              startActivity(
                new Intent(
                  "mailto".equals(link.getScheme()) ? Intent.ACTION_SENDTO : Intent.ACTION_VIEW,
                  link
                )
              );
            } catch (android.content.ActivityNotFoundException | SecurityException missing) {
              toast("No app can open this link. Use the copy button instead.");
            }
            return true;
          }
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
          if (p.isCaptureEnabled() && Arrays.toString(p.getAcceptTypes()).contains("image/")) {
            try {
              takePhoto();
            } catch (Exception e) {
              if (captureFile != null) captureFile.delete();
              captureUri = null;
              picker = null;
              cb.onReceiveValue(null);
              toast("No camera app available. Choose existing images instead.");
            }
            return true;
          }
          List<String> types = new ArrayList<>();
          for (String v : p.getAcceptTypes())
            for (String t : v.split(",")) {
              t = t.trim();
              if (t.startsWith("image/")) types.add(t);
              else if (t.contains("/") && !t.equals("*/*")) types.add(t);
            }
          if (types.isEmpty()) types.addAll(Arrays.asList(TYPES));
          boolean imagesOnly =
            !types.isEmpty() && types.stream().allMatch(t -> t.startsWith("image/"));
          Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(types.size() == 1 ? types.get(0) : imagesOnly ? "image/*" : "*/*")
            .putExtra(Intent.EXTRA_LOCAL_ONLY, true)
            .putExtra(Intent.EXTRA_MIME_TYPES, types.toArray(new String[0]))
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
        JSONObject envelope;
        try {
          envelope = new JSONObject(data);
        } catch (Exception invalid) {
          return;
        }
        ("phone.scan".equals(envelope.optString("op")) ? scans : io).execute(() -> {
          JSONObject response = new JSONObject();
          try {
            JSONObject request = envelope;
            response.put("id", request.getString("id"));
            String op = request.getString("op");
            JSONObject a = request.optJSONObject("args");
            if (a == null) a = new JSONObject();
            Object value;
            if (op.startsWith("phone.")) {
              String owner = library.currentOwner();
              switch (op) {
                case "phone.scan":
                  value = phone.scan(owner);
                  break;
                case "phone.page":
                  value = phone.page(owner, a.optString("q"), Math.max(0, a.optInt("offset")));
                  break;
                case "phone.stop":
                  phone.enable(owner, false);
                  value = true;
                  break;
                case "phone.forget":
                  phone.forget(owner, a.getString("id"));
                  value = true;
                  break;
                case "phone.access":
                case "phone.folder":
                  runOnUiThread(() -> chooseSource(owner, op.equals("phone.folder")));
                  value = true;
                  break;
                default:
                  throw new IOException("Unknown phone source action.");
              }
            } else if (op.equals("export.bytes")) {
              String stage = a.getString("id"),
                ext = a.getString("ext"),
                title = a.getString("name").trim().replaceAll("[\\p{Cntrl}/\\\\]", " ");
              if (
                !Arrays.asList("zip", "jpg", "xlsx", "pptx").contains(ext) ||
                title.isEmpty() ||
                title.length() > 140
              ) throw new IOException("Invalid output file name or format.");
              library.pinExport(stage);
              String token = request.getString("id");
              runOnUiThread(() -> {
                java.util.function.BiConsumer<Boolean, String> answer = (saved, why) -> {
                  if (isDestroyed() || web != w) return;
                  try {
                    reply.postMessage(
                      new JSONObject()
                        .put("id", token)
                        .put("ok", why == null)
                        .put("value", saved)
                        .put("error", why)
                        .toString()
                    );
                  } catch (Exception ignored) {}
                };
                if (pendingExport != null) {
                  library.finishExport(stage);
                  answer.accept(false, "Finish the current export first.");
                  return;
                }
                pendingExport = "temp:" + stage;
                exportReply = answer;
                String mime = ext.equals("zip")
                  ? "application/zip"
                  : ext.equals("jpg")
                    ? "image/jpeg"
                    : ext.equals("xlsx")
                      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      : "application/vnd.openxmlformats-officedocument.presentationml.presentation";
                try {
                  startFiles(
                    new Intent(Intent.ACTION_CREATE_DOCUMENT)
                      .addCategory(Intent.CATEGORY_OPENABLE)
                      .setType(mime)
                      .putExtra(Intent.EXTRA_TITLE, title + "." + ext),
                    SAVE
                  );
                } catch (Exception e) {
                  pendingExport = null;
                  exportReply = null;
                  library.finishExport(stage);
                  answer.accept(false, "Android Files is unavailable.");
                }
              });
              return;
            } else if (op.equals("reader.close") && externalReader()) {
              runOnUiThread(this::finish);
              value = true;
            } else if (op.equals("inbox.list")) value = inboxList();
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
    web.loadUrl(ORIGIN + "/index.html" + (externalReader() ? "#/open-pdf" : ""));
  }

  private Set<String> creatorLinks() {
    try (
      Scanner file = new Scanner(getAssets().open("creator-contacts.json"), "UTF-8").useDelimiter(
        "\\A"
      )
    ) {
      JSONArray entries = new JSONArray(file.next());
      Set<String> urls = new HashSet<>();
      for (int i = 0; i < entries.length(); i++) urls.add(
        entries.getJSONObject(i).getString("url")
      );
      return urls;
    } catch (Exception invalid) {
      return Collections.emptySet();
    }
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
      if (
        path.startsWith("/device-file/") ||
        path.startsWith("/inbox/") ||
        path.startsWith("/phone-file/")
      ) {
        if (
          r.isForMainFrame() ||
          (!"1".equals(r.getRequestHeaders().get("X-Ft-Read")) &&
            !"1".equals(r.getRequestHeaders().get("x-ft-read")))
        ) return denied(403);
        h.put("Content-Security-Policy", "sandbox; default-src 'none'");
        InputStream stream;
        if (path.startsWith("/phone-file/")) stream = new LimitedInputStream(
          phone.open(path.substring(12))
        );
        else if (path.startsWith("/inbox/")) {
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
          path.startsWith("/pdf-assets/") ||
          path.startsWith("/ocr/")
        )
      ) return denied(404);
      if (path.startsWith("/ocr/") && path.endsWith(".js")) h.put(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'wasm-unsafe-eval'; connect-src data:; worker-src 'none'"
      );
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
        String type = null;
        try {
          type = getContentResolver().getType(item.getValue());
        } catch (RuntimeException ignored) {}
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

  private void sourcesChanged() {
    if (web != null && !isDestroyed()) web.evaluateJavascript(
      "window.dispatchEvent(new Event('ft:sources'))",
      null
    );
  }

  private void chooseSource(String owner, boolean folder) {
    if (sourceOwner != null || isFinishing()) return;
    sourceOwner = owner;
    try {
      if (folder) {
        startFiles(
          new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
            .putExtra(Intent.EXTRA_LOCAL_ONLY, true)
            .addFlags(
              Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
            ),
          TREE
        );
      } else if (phone.allowed()) {
        phone.enable(owner, true);
        sourceOwner = null;
        sourcesChanged();
      } else if (Build.VERSION.SDK_INT >= 30) {
        startActivityForResult(
          new Intent(
            android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
            Uri.parse("package:" + getPackageName())
          ),
          ACCESS
        );
      } else requestPermissions(
        new String[] { android.Manifest.permission.READ_EXTERNAL_STORAGE },
        ACCESS
      );
    } catch (Exception e) {
      sourceOwner = null;
      toast("Use Choose folder to select readable documents.");
      sourcesChanged();
    }
  }

  private void finishSource(int code, Uri uri) {
    String owner = sourceOwner;
    sourceOwner = null;
    if (owner == null) return;
    io.execute(() -> {
      try {
        if (owner.equals(library.currentOwner())) {
          if (code == ACCESS) phone.enable(owner, phone.allowed());
          else if (uri != null) phone.link(owner, uri);
        }
      } catch (Exception e) {
        runOnUiThread(() -> toast("Folder access was not granted."));
      }
      runOnUiThread(this::sourcesChanged);
    });
  }

  @Override
  public void onRequestPermissionsResult(int code, String[] perms, int[] grants) {
    super.onRequestPermissionsResult(code, perms, grants);
    if (code == ACCESS) finishSource(code, null);
  }

  @Override
  protected void onActivityResult(int code, int result, Intent data) {
    super.onActivityResult(code, result, data);
    if (code == TREE || code == ACCESS) {
      finishSource(code, result == RESULT_OK && data != null ? data.getData() : null);
      return;
    }
    if (code == CAMERA) {
      if (captureUri != null) revokeUriPermission(
        captureUri,
        Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION
      );
      boolean ok = result == RESULT_OK && captureFile != null && captureFile.length() > 0;
      if (picker != null) picker.onReceiveValue(ok ? new Uri[] { captureUri } : null);
      if (!ok && captureFile != null) captureFile.delete();
      picker = null;
      captureUri = null;
      captureFile = null;
      return;
    }
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
      java.util.function.BiConsumer<Boolean, String> answer = exportReply;
      exportReply = null;
      if (id == null) return;
      boolean temp = id.startsWith("temp:");
      String stage = temp ? id.substring(5) : "";
      Uri dest = data == null ? null : data.getData();
      if (result != RESULT_OK || dest == null || !"content".equals(dest.getScheme())) {
        if (temp) library.finishExport(stage);
        if (answer != null) answer.accept(false, null);
        return;
      }
      io.execute(() -> {
        String issue = null;
        try (
          InputStream in = temp ? library.openExport(stage) : library.read(id, false).stream;
          OutputStream out = getContentResolver().openOutputStream(dest, "wt")
        ) {
          if (out == null) throw new IOException("Destination unavailable");
          byte[] b = new byte[32768];
          int n;
          while ((n = in.read(b)) != -1) out.write(b, 0, n);
        } catch (Exception e) {
          issue = "Could not export: " + e.getMessage();
        } finally {
          if (temp) library.finishExport(stage);
        }
        String why = issue;
        runOnUiThread(() -> {
          if (answer != null) answer.accept(why == null, why);
          else toast(why == null ? "Document saved to Files" : why);
        });
      });
    }
  }

  private void toast(String s) {
    Toast.makeText(this, s, Toast.LENGTH_LONG).show();
  }

  @Override
  protected void onPause() {
    // Pause this renderer, never global WebView timers: another Ft PDF activity may be reading.
    if (web != null) web.onPause();
    super.onPause();
  }

  @Override
  protected void onResume() {
    super.onResume();
    if (web != null) web.onResume();
    if (web != null && !externalReader()) web.evaluateJavascript(
      "window.dispatchEvent(new Event('ft:resume'))",
      null
    );
  }

  @Override
  protected void onNewIntent(Intent i) {
    super.onNewIntent(i);
    // The inbox owns pending grants. Do not replace the activity’s launch intent
    // with an already-consumed file when a second document is opened.
    if (pdfView(i)) {
      forwardPdf(i);
      return;
    }
    if (externalReader()) return;
    queue(i);
    if (web != null) web.evaluateJavascript("window.dispatchEvent(new Event('ft:inbox'))", null);
  }

  @Override
  protected void onSaveInstanceState(Bundle state) {
    super.onSaveInstanceState(state);
    state.putString("export", pendingExport);
    state.putString("sourceOwner", sourceOwner);
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
    if (
      isFinishing() && pendingExport != null && pendingExport.startsWith("temp:")
    ) library.finishExport(pendingExport.substring(5));
    scans.shutdownNow();
    io.shutdown();
    if (web != null) {
      root.removeView(web);
      web.destroy();
      web = null;
    }
    super.onDestroy();
  }
}
