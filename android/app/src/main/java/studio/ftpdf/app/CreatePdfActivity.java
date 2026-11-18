package studio.ftpdf.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.widget.Button;
import android.widget.EditText;
import android.widget.Spinner;
import android.widget.TextView;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Offline composer. No WebView, session cookie, network, or storage permission is involved. */
public final class CreatePdfActivity extends Activity {

  private static final int CREATE = 31;
  private final ExecutorService writer = Executors.newSingleThreadExecutor();
  private EditText title, body;
  private Spinner paper;
  private Button save, open;
  private TextView status;
  private Uri lastSaved;
  private boolean busy, pristineAfterSave;
  private String savedTitle, savedBody;
  private int savedPaper;

  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    setContentView(R.layout.activity_create_pdf);
    View root = findViewById(R.id.creator_root);
    if (Build.VERSION.SDK_INT >= 35) root.setOnApplyWindowInsetsListener((v, insets) -> {
      android.graphics.Insets edges = insets.getInsets(
        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime()
      );
      v.setPadding(edges.left, edges.top, edges.right, edges.bottom);
      return WindowInsets.CONSUMED;
    });
    if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
      android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,
      this::leave
    );
    title = findViewById(R.id.pdf_title);
    body = findViewById(R.id.pdf_text);
    paper = findViewById(R.id.pdf_paper);
    status = findViewById(R.id.creator_status);
    save = findViewById(R.id.creator_save);
    open = findViewById(R.id.creator_open);
    findViewById(R.id.creator_back).setOnClickListener(v -> leave());
    save.setOnClickListener(v -> chooseDestination());
    open.setOnClickListener(v -> openSaved());
    if (state != null && state.getString("lastPdf") != null) {
      lastSaved = Uri.parse(state.getString("lastPdf"));
      open.setVisibility(View.VISIBLE);
    }
  }

  @Override
  protected void onSaveInstanceState(Bundle state) {
    super.onSaveInstanceState(state); // Android saves the fields and paper selection using their view IDs.
    if (lastSaved != null) state.putString("lastPdf", lastSaved.toString());
  }

  private void chooseDestination() {
    if (busy) return;
    String name = title.getText().toString().trim();
    if (name.isEmpty()) {
      title.setError("Give your document a title.");
      title.requestFocus();
      return;
    }
    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
      .addCategory(Intent.CATEGORY_OPENABLE)
      .setType("application/pdf")
      .putExtra(Intent.EXTRA_TITLE, LocalPdfWriter.suggestedFilename(name));
    try {
      startActivityForResult(intent, CREATE);
    } catch (ActivityNotFoundException e) {
      status.setText("No file picker is available on this device.");
    }
  }

  @Override
  protected void onActivityResult(int request, int result, Intent data) {
    super.onActivityResult(request, result, data);
    if (request != CREATE) return;
    if (result != RESULT_OK || data == null || data.getData() == null) {
      status.setText("Save cancelled. Your draft is still here.");
      return;
    }
    Uri destination = data.getData();
    if (!"content".equals(destination.getScheme())) {
      status.setText("Choose a destination in Files and try again.");
      return;
    }
    // The system can deliver a picker result before restored edit fields have been laid out.
    save.post(() -> writePdf(destination));
  }

  private void writePdf(Uri destination) {
    if (busy || isFinishing()) return;
    String name = title.getText().toString().trim(),
      content = body.getText().toString();
    int selected = paper.getSelectedItemPosition();
    LocalPdfWriter.Paper size =
      selected == 1 ? LocalPdfWriter.Paper.LETTER : LocalPdfWriter.Paper.A4;
    setBusy(true);
    status.setText("Creating PDF…");
    writer.execute(() -> {
      // Finish rendering in an app-private temp file before writing any bytes to the user's destination.
      File tmp = null;
      try {
        tmp = File.createTempFile("ft-create-", ".pdf", getCacheDir());
        final int pages;
        try (FileOutputStream f = new FileOutputStream(tmp)) {
          pages = LocalPdfWriter.write(name, content, size, f);
        }
        try (
          FileInputStream in = new FileInputStream(tmp);
          OutputStream out = getContentResolver().openOutputStream(destination, "wt")
        ) {
          if (out == null) throw new IOException("The selected destination is unavailable.");
          byte[] chunk = new byte[16384];
          int n;
          while ((n = in.read(chunk)) != -1) out.write(chunk, 0, n);
        }
        runOnUiThread(() -> {
          if (isDestroyed() || isFinishing()) return;
          setBusy(false);
          lastSaved = destination;
          pristineAfterSave = true;
          savedTitle = name;
          savedBody = content;
          savedPaper = selected;
          status.setText("PDF saved · " + pages + (pages == 1 ? " page" : " pages"));
          open.setVisibility(View.VISIBLE);
        });
      } catch (Exception e) {
        runOnUiThread(() -> {
          if (isDestroyed() || isFinishing()) return;
          setBusy(false);
          status.setText(
            "Could not save the PDF. " +
              (e.getMessage() == null ? "Choose another location and try again." : e.getMessage())
          );
        });
      } finally {
        if (tmp != null) tmp.delete();
      }
    });
  }

  private void setBusy(boolean value) {
    busy = value;
    title.setEnabled(!value);
    body.setEnabled(!value);
    paper.setEnabled(!value);
    save.setEnabled(!value);
    open.setEnabled(!value);
  }

  private void openSaved() {
    if (lastSaved == null) return;
    Intent view = new Intent(Intent.ACTION_VIEW)
      .setDataAndType(lastSaved, "application/pdf")
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
    Intent chooser = Intent.createChooser(view, "Open PDF with");
    chooser.putExtra(Intent.EXTRA_EXCLUDE_COMPONENTS, new ComponentName[] {
      new ComponentName(this, MainActivity.class),
    });
    try {
      startActivity(chooser);
    } catch (ActivityNotFoundException e) {
      status.setText("Your PDF is saved. Open it from your Files app.");
    }
  }

  private void leave() {
    if (busy) return;
    String name = title.getText().toString().trim(),
      content = body.getText().toString();
    if (
      (name.isEmpty() && content.isEmpty()) ||
      (pristineAfterSave &&
        name.equals(savedTitle) &&
        content.equals(savedBody) &&
        savedPaper == paper.getSelectedItemPosition())
    ) {
      finish();
      return;
    }
    new AlertDialog.Builder(this)
      .setTitle("Leave this draft?")
      .setMessage("Changes since your last save will be discarded.")
      .setNegativeButton("Keep writing", null)
      .setPositiveButton("Discard", (d, i) -> finish())
      .show();
  }

  @Override
  public void onBackPressed() {
    leave();
  }

  @Override
  protected void onDestroy() {
    writer.shutdown();
    super.onDestroy();
  }
}
