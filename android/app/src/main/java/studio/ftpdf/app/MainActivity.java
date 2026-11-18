package studio.ftpdf.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.*;
import android.widget.*;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/** A same-origin Android client. Files are selected through SAF, never broad storage permissions. */
public final class MainActivity extends Activity {

  private static final int PICK = 20,
    SAVE = 21,
    CREAM = 0xfffbfaf7,
    CLAY = 0xffad4637;
  private static final long MAX_BYTES = 25L * 1024 * 1024;
  private static final String[] TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/html",
  };
  private FrameLayout root;
  private WebView web;
  private String origin;
  private boolean pageReady, offering;
  private ValueCallback<Uri[]> picker;
  private String downloadUrl, downloadName;
  private final ArrayList<Uri> incoming = new ArrayList<>();
  private final ExecutorService io = Executors.newSingleThreadExecutor();

  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    root = new FrameLayout(this);
    root.setBackgroundColor(CREAM);
    setContentView(root);
    if (Build.VERSION.SDK_INT >= 35) root.setOnApplyWindowInsetsListener((v, insets) -> {
      android.graphics.Insets s = insets.getInsets(
        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime()
      );
      v.setPadding(s.left, s.top, s.right, s.bottom);
      return WindowInsets.CONSUMED;
    });
    if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
      android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,
      this::back
    );
    if (state == null) queue(getIntent());
    else {
      ArrayList<Uri> saved = state.getParcelableArrayList("pending");
      if (saved != null) incoming.addAll(saved);
      downloadUrl = state.getString("downloadUrl");
      downloadName = state.getString("downloadName");
    }
    String saved = getPreferences(MODE_PRIVATE).getString(
      "origin",
      getString(R.string.default_workspace_url)
    );
    try {
      origin = normalize(saved);
      // The local composer must stay reachable even if a previously saved server is down.
      if ((state != null && state.getBoolean("inWorkspace")) || !incoming.isEmpty()) openWorkspace(
        state
      );
      else setup("");
    } catch (Exception e) {
      setup("");
    }
  }

  @Override
  protected void onSaveInstanceState(Bundle s) {
    super.onSaveInstanceState(s);
    s.putParcelableArrayList("pending", incoming);
    s.putString("downloadUrl", downloadUrl);
    s.putString("downloadName", downloadName);
    s.putBoolean("inWorkspace", web != null);
    if (web != null) web.saveState(s);
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    queue(intent);
    if (web == null && origin != null && !incoming.isEmpty()) openWorkspace(null);
    else offerImport();
  }

  private void queue(Intent i) {
    if (i == null) return;
    String action = i.getAction();
    if (Intent.ACTION_VIEW.equals(action)) addUri(i.getData());
    else if (Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) {
      ClipData c = i.getClipData();
      if (c != null) for (int j = 0; j < c.getItemCount(); j++) addUri(c.getItemAt(j).getUri());
      if (Intent.ACTION_SEND.equals(action)) addUri(i.getParcelableExtra(Intent.EXTRA_STREAM));
      else {
        ArrayList<Uri> list = i.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
        if (list != null) for (Uri u : list) addUri(u);
      }
    }
  }

  private void addUri(Uri u) {
    if (
      u != null && "content".equals(u.getScheme()) && !incoming.contains(u) && incoming.size() < 30
    ) incoming.add(u);
  }

  private static String normalize(String s) throws Exception {
    URI u = new URI(s.trim());
    String scheme = u.getScheme();
    if (
      u.getHost() == null ||
      u.getRawUserInfo() != null ||
      !("https".equals(scheme) || (BuildConfig.DEBUG && "http".equals(scheme)))
    ) throw new Exception("Enter a complete HTTPS workspace address.");
    return new URI(scheme, null, u.getHost(), u.getPort(), "/", null, null).toString();
  }

  private boolean same(String url) {
    try {
      return origin.equals(normalize(url));
    } catch (Exception e) {
      return false;
    }
  }

  private int dp(int v) {
    return Math.round(getResources().getDisplayMetrics().density * v);
  }

  private TextView text(String s, int size, int color, boolean bold) {
    TextView t = new TextView(this);
    t.setText(s);
    t.setTextSize(size);
    t.setTextColor(color);
    if (bold) t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    return t;
  }

  private void toast(String s) {
    Toast.makeText(this, s, Toast.LENGTH_LONG).show();
  }

  private void setup(String error) {
    pageReady = false;
    if (web != null) {
      root.removeView(web);
      web.destroy();
      web = null;
    }
    root.removeAllViews();
    ScrollView scroll = new ScrollView(this);
    scroll.setFillViewport(true);
    LinearLayout card = new LinearLayout(this);
    card.setGravity(Gravity.CENTER_VERTICAL);
    card.setOrientation(LinearLayout.VERTICAL);
    card.setFocusableInTouchMode(true);
    card.setPadding(dp(27), dp(30), dp(27), dp(30));
    scroll.addView(card);
    root.addView(scroll);
    ImageView mark = new ImageView(this);
    mark.setImageResource(R.drawable.ft_mark);
    card.addView(mark, dp(52), dp(52));
    TextView name = text("Ft PDF", 34, 0xff302d28, true);
    name.setPadding(0, dp(13), 0, dp(22));
    card.addView(name);
    TextView localLabel = text("ON THIS DEVICE", 11, CLAY, true);
    localLabel.setLetterSpacing(.11f);
    card.addView(localLabel);
    card.addView(text("Create a document", 23, 0xff302d28, true));
    TextView localCaption = text(
      "Write a PDF and save it to Files. No server or sign-in required.",
      15,
      0xff706b64,
      false
    );
    localCaption.setPadding(0, dp(6), 0, dp(9));
    card.addView(localCaption);
    Button create = new Button(this);
    create.setAllCaps(false);
    create.setText(R.string.creator_title);
    create.setTextColor(Color.WHITE);
    create.setBackgroundTintList(ColorStateList.valueOf(CLAY));
    create.setOnClickListener(v -> startActivity(new Intent(this, CreatePdfActivity.class)));
    card.addView(create);
    TextView workspaceLabel = text("ONLINE WORKSPACE · OPTIONAL", 11, CLAY, true);
    workspaceLabel.setLetterSpacing(.11f);
    workspaceLabel.setPadding(0, dp(25), 0, dp(3));
    card.addView(workspaceLabel);
    card.addView(text("Connect your workspace", 21, 0xff302d28, true));
    TextView caption = text(
      "Enter the address of your hosted Ft PDF server. Your documents and account stay on that server.",
      15,
      0xff706b64,
      false
    );
    caption.setPadding(0, dp(8), 0, dp(18));
    card.addView(caption);
    EditText field = new EditText(this);
    field.setSingleLine(true);
    field.setInputType(17);
    field.setHint("https://your-workspace.example");
    field.setText(origin == null ? "" : origin);
    card.addView(field);
    TextView warning = text(error, 13, CLAY, false);
    card.addView(warning);
    Button submit = new Button(this);
    submit.setAllCaps(false);
    submit.setText("Connect workspace");
    submit.setTextColor(0xff573b30);
    submit.setBackgroundTintList(ColorStateList.valueOf(0xffeee5d9));
    card.addView(submit);
    submit.setOnClickListener(v -> {
      try {
        origin = normalize(field.getText().toString());
        getPreferences(MODE_PRIVATE).edit().putString("origin", origin).apply();
        openWorkspace(null);
      } catch (Exception e) {
        warning.setText("Use a valid HTTPS address for your Ft PDF server.");
      }
    });
  }

  private void openWorkspace(Bundle state) {
    root.removeAllViews();
    pageReady = false;
    web = new WebView(this);
    web.setBackgroundColor(CREAM);
    root.addView(web);
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setAllowFileAccess(false);
    s.setAllowContentAccess(true);
    s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    s.setUserAgentString(s.getUserAgentString() + " FtPDF-Android/2 FtPDF-LocalCreator/1");
    CookieManager.getInstance().setAcceptCookie(true);
    CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
    web.setWebViewClient(
      new WebViewClient() {
        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
          if (!r.isForMainFrame()) return false;
          String url = r.getUrl().toString();
          if ("ftpdf://create-pdf".equals(url) && same(v.getUrl())) {
            startActivity(new Intent(MainActivity.this, CreatePdfActivity.class));
            return true;
          }
          if ("ftpdf://settings".equals(url) && same(v.getUrl())) {
            new AlertDialog.Builder(MainActivity.this)
              .setTitle("Change workspace address?")
              .setMessage("Save any document changes before switching servers.")
              .setNegativeButton("Cancel", null)
              .setPositiveButton("Continue", (d, i) -> setup(""))
              .show();
            return true;
          }
          return !same(url);
        }

        @Override
        public void onPageFinished(WebView v, String url) {
          if (v != web) return;
          pageReady = same(url);
          CookieManager.getInstance().flush();
          if (pageReady) offerImport();
        }

        @Override
        public void onReceivedHttpError(
          WebView v,
          WebResourceRequest req,
          WebResourceResponse response
        ) {
          if (v == web && req.isForMainFrame() && response.getStatusCode() >= 400) v.post(() -> {
            if (v == web) setup(
              "Workspace returned HTTP " +
                response.getStatusCode() +
                ". You can still create a PDF on this device."
            );
          });
        }

        @Override
        public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError error) {
          if (v == web && req.isForMainFrame()) v.post(() -> {
            if (v == web) setup(
              "Could not reach this workspace. Check the address and your internet connection."
            );
          });
        }
      }
    );
    web.setWebChromeClient(
      new WebChromeClient() {
        @Override
        public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
          if (!same(v.getUrl())) return false;
          if (picker != null) picker.onReceiveValue(null);
          picker = cb;
          Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*");
          i.putExtra(Intent.EXTRA_MIME_TYPES, TYPES);
          i.putExtra(
            Intent.EXTRA_ALLOW_MULTIPLE,
            p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE
          );
          try {
            startActivityForResult(i, PICK);
          } catch (Exception e) {
            picker.onReceiveValue(null);
            picker = null;
            toast("No file picker is available.");
          }
          return true;
        }
      }
    );
    web.setDownloadListener((url, ua, disposition, mime, length) -> {
      if (
        !same(url) || !Uri.parse(url).getPath().matches("/api/documents/[a-zA-Z0-9-]+/file")
      ) return;
      downloadUrl = url;
      downloadName = URLUtil.guessFileName(url, disposition, mime);
      if (disposition != null && disposition.contains("filename*=UTF-8''")) {
        try {
          downloadName = URLDecoder.decode(
            disposition.substring(disposition.indexOf("filename*=UTF-8''") + 17),
            "UTF-8"
          );
        } catch (Exception ignored) {}
      }
      downloadName = cleanName(downloadName);
      Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT)
        .addCategory(Intent.CATEGORY_OPENABLE)
        .setType(mimeFor(downloadName))
        .putExtra(Intent.EXTRA_TITLE, downloadName);
      try {
        startActivityForResult(i, SAVE);
      } catch (Exception e) {
        toast("No save dialog is available.");
      }
    });
    if (state == null || web.restoreState(state) == null) web.loadUrl(origin);
  }

  private static String mimeFor(String n) {
    String s = n.toLowerCase(Locale.ROOT);
    return s.endsWith(".pdf")
      ? TYPES[0]
      : s.endsWith(".docx")
        ? TYPES[2]
        : s.endsWith(".doc")
          ? TYPES[1]
          : s.endsWith(".html") || s.endsWith(".htm")
            ? TYPES[4]
            : TYPES[3];
  }

  private static String cleanName(String n) {
    return n.replaceAll("[\\\\/\\p{Cntrl}]", "_");
  }

  private String displayName(Uri uri) {
    try (
      Cursor c = getContentResolver().query(
        uri,
        new String[] { OpenableColumns.DISPLAY_NAME },
        null,
        null,
        null
      )
    ) {
      if (c != null && c.moveToFirst() && c.getString(0) != null) return cleanName(c.getString(0));
    } catch (Exception ignored) {}
    return "Shared document";
  }

  private void offerImport() {
    if (!pageReady || web == null || incoming.isEmpty() || offering || isFinishing()) return;
    offering = true;
    ArrayList<Uri> batch = new ArrayList<>(incoming);
    String example = displayName(batch.get(0));
    String desc = batch.size() == 1 ? example : example + " and " + (batch.size() - 1) + " more";
    new AlertDialog.Builder(this)
      .setTitle("Import into Ft PDF?")
      .setMessage(
        desc +
          "\n\nA copy will be saved to your workspace at " +
          Uri.parse(origin).getHost() +
          ". The original stays unchanged."
      )
      .setNegativeButton("Cancel", (d, i) -> {
        incoming.removeAll(batch);
        offering = false;
      })
      .setOnCancelListener(d -> {
        incoming.removeAll(batch);
        offering = false;
      })
      .setPositiveButton("Import", (dialog, i) -> {
        String cookie = CookieManager.getInstance().getCookie(origin),
          base = origin;
        if (cookie == null || !cookie.contains("ft_session=")) {
          offering = false;
          toast("Wait for the workspace to finish loading, then try opening the file again.");
          return;
        }
        toast("Importing document" + (batch.size() > 1 ? "s…" : "…"));
        io.execute(() -> {
          String last = "",
            error = null;
          int count = 0;
          for (Uri u : batch) {
            try {
              last = upload(base, cookie, u);
              count++;
            } catch (Exception e) {
              error = e.getMessage();
              break;
            }
          }
          String id = last,
            err = error;
          int n = count;
          runOnUiThread(() -> {
            if (isFinishing() || isDestroyed()) return;
            offering = false;
            incoming.removeAll(batch);
            if (web != null && base.equals(origin) && !id.isEmpty()) {
              String detail = "{id:" + JSONObject.quote(id) + ",count:" + n + "}";
              web.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('ft:imported',{detail:" + detail + "}))",
                null
              );
            }
            if (err != null) toast("Import failed: " + err);
            offerImport();
          });
        });
      })
      .show();
  }

  private static HttpURLConnection connect(String url, String cookie) throws IOException {
    HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
    con.setConnectTimeout(20000);
    con.setReadTimeout(60000);
    con.setInstanceFollowRedirects(false);
    con.setRequestProperty("Cookie", cookie == null ? "" : cookie);
    return con;
  }

  private static void write(OutputStream o, String s) throws IOException {
    o.write(s.getBytes(StandardCharsets.UTF_8));
  }

  private static void copy(InputStream in, OutputStream out, long max) throws IOException {
    if (in == null || out == null) throw new IOException("The selected file is unavailable.");
    byte[] buffer = new byte[16384];
    long total = 0;
    int n;
    while ((n = in.read(buffer)) != -1) {
      total += n;
      if (total > max) throw new IOException("File exceeds the size limit.");
      out.write(buffer, 0, n);
    }
  }

  private String upload(String base, String cookie, Uri uri) throws Exception {
    String name = displayName(uri);
    if (
      !name.toLowerCase(Locale.ROOT).matches(".*\\.(pdf|doc|docx|txt|htm|html)$")
    ) throw new IOException("Choose a PDF, Word, TXT, or HTML file.");
    String boundary = "ft-" + UUID.randomUUID();
    HttpURLConnection con = connect(base + "api/documents/import", cookie);
    try {
      con.setRequestMethod("POST");
      con.setDoOutput(true);
      con.setChunkedStreamingMode(16384);
      con.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
      try (
        OutputStream out = con.getOutputStream();
        InputStream in = getContentResolver().openInputStream(uri)
      ) {
        write(
          out,
          "--" +
            boundary +
            "\r\nContent-Disposition: form-data; name=\"name\"\r\n\r\n" +
            name +
            "\r\n--" +
            boundary +
            "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"document\"\r\nContent-Type: application/octet-stream\r\n\r\n"
        );
        copy(in, out, MAX_BYTES);
        write(out, "\r\n--" + boundary + "--\r\n");
      }
      int code = con.getResponseCode();
      try (
        InputStream in = code < 300 ? con.getInputStream() : con.getErrorStream();
        ByteArrayOutputStream out = new ByteArrayOutputStream()
      ) {
        copy(in, out, 65536);
        JSONObject json = new JSONObject(out.toString("UTF-8"));
        if (code != 201) throw new IOException(
          json.optString("error", "Workspace rejected the file.")
        );
        return json.getString("id");
      }
    } finally {
      con.disconnect();
    }
  }

  @Override
  protected void onActivityResult(int code, int result, Intent data) {
    super.onActivityResult(code, result, data);
    if (code == PICK && picker != null) {
      ArrayList<Uri> picked = new ArrayList<>();
      if (result == RESULT_OK && data != null) {
        ClipData clip = data.getClipData();
        if (clip != null) for (int i = 0; i < clip.getItemCount(); i++) {
          Uri u = clip.getItemAt(i).getUri();
          if (u != null && "content".equals(u.getScheme())) picked.add(u);
        }
        else if (data.getData() != null && "content".equals(data.getData().getScheme())) picked.add(
          data.getData()
        );
      }
      picker.onReceiveValue(picked.isEmpty() ? null : picked.toArray(new Uri[0]));
      picker = null;
    }
    if (
      code == SAVE &&
      result == RESULT_OK &&
      data != null &&
      data.getData() != null &&
      downloadUrl != null &&
      same(downloadUrl)
    ) {
      Uri dest = data.getData();
      String url = downloadUrl,
        cookie = CookieManager.getInstance().getCookie(origin);
      downloadUrl = null;
      io.execute(() -> {
        try {
          HttpURLConnection con = connect(url, cookie);
          try {
            if (con.getResponseCode() != 200) throw new IOException("Sign in and try again.");
            try (
              InputStream in = con.getInputStream();
              OutputStream out = getContentResolver().openOutputStream(dest, "wt")
            ) {
              copy(in, out, MAX_BYTES);
            }
          } finally {
            con.disconnect();
          }
          runOnUiThread(() -> toast("Document downloaded"));
        } catch (Exception e) {
          runOnUiThread(() -> toast("Download failed: " + e.getMessage()));
        }
      });
    }
  }

  private void back() {
    WebView v = web;
    if (v != null && same(v.getUrl())) {
      v.evaluateJavascript(
        "window.dispatchEvent(new Event('ft:back',{cancelable:true}))",
        handled -> {
          if (!"false".equals(handled)) {
            if (v.canGoBack()) v.goBack();
            else setup("");
          }
        }
      );
    } else finish();
  }

  @Override
  public void onBackPressed() {
    back();
  }

  @Override
  protected void onDestroy() {
    if (picker != null) picker.onReceiveValue(null);
    io.shutdownNow();
    if (web != null) {
      root.removeView(web);
      web.destroy();
    }
    super.onDestroy();
  }
}
