package studio.ftpdf.app;

import static org.junit.Assert.*;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.os.ParcelFileDescriptor;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Exercise Android's real PDF renderer on an emulator/device, not a mocked byte stream. */
@RunWith(AndroidJUnit4.class)
public class LocalPdfWriterTest {

  private void check(String body, LocalPdfWriter.Paper paper, boolean blank) throws Exception {
    Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    File file = File.createTempFile("ft-render-test", ".pdf", context.getCacheDir());
    try {
      int pages;
      try (FileOutputStream out = new FileOutputStream(file)) {
        pages = LocalPdfWriter.write("Studio notes", body, paper, out);
      }
      if (blank) assertEquals(1, pages);
      else assertTrue(pages > 1);
      try (
        PdfRenderer reader = new PdfRenderer(
          ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
        )
      ) {
        assertEquals(pages, reader.getPageCount());
        for (int i = 0; i < pages; i++) try (PdfRenderer.Page p = reader.openPage(i)) {
          assertEquals(paper.width, p.getWidth());
          assertEquals(paper.height, p.getHeight());
          Bitmap bitmap = Bitmap.createBitmap(paper.width, paper.height, Bitmap.Config.ARGB_8888);
          bitmap.eraseColor(Color.WHITE);
          p.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
          boolean ink = false;
          for (int y = 0; y < paper.height && !ink; y += 2) for (
            int x = 0;
            x < paper.width;
            x += 2
          ) {
            if (Color.red(bitmap.getPixel(x, y)) < 180) {
              ink = true;
              break;
            }
          }
          bitmap.recycle();
          assertEquals(!blank, ink);
        }
      }
    } finally {
      file.delete();
    }
  }

  @Test
  public void blankA4IsReadableAndBlank() throws Exception {
    check("", LocalPdfWriter.Paper.A4, true);
  }

  @Test
  public void unicodeTextWrapsAcrossLetterPages() throws Exception {
    StringBuilder body = new StringBuilder();
    for (int i = 0; i < 100; i++) body.append(
      "Field notes — കുറിപ്പുകൾ. This is a longer line of text that should be wrapped safely within the page margins.\n"
    );
    body.append("End of document.");
    check(body.toString(), LocalPdfWriter.Paper.LETTER, false);
  }
}
