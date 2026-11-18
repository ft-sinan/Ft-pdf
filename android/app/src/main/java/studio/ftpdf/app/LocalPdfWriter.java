package studio.ftpdf.app;

import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.graphics.pdf.PdfDocument;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextDirectionHeuristics;
import android.text.TextPaint;
import java.io.IOException;
import java.io.OutputStream;

/** Creates a real, self-contained PDF. Dimensions and font sizes are in PDF points. */
final class LocalPdfWriter {

  static final int MAX_TEXT = 50000;
  private static final int MARGIN = 44;
  private static final int MAX_PAGES = 200;

  enum Paper {
    A4(595, 842),
    LETTER(612, 792);

    final int width, height;

    Paper(int width, int height) {
      this.width = width;
      this.height = height;
    }
  }

  private LocalPdfWriter() {}

  static String suggestedFilename(String title) {
    String base = title
      .trim()
      .replaceAll("(?i)\\.pdf$", "")
      .replaceAll("[\\\\/\\p{Cntrl}:*?\"<>|]", "_")
      .trim();
    return (base.isEmpty() ? "Untitled document" : base) + ".pdf";
  }

  private static StaticLayout layout(String s, int width, int size, boolean bold) {
    TextPaint paint = new TextPaint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
    paint.setColor(Color.rgb(42, 40, 36));
    paint.setTypeface(
      bold
        ? Typeface.create("sans-serif", Typeface.BOLD)
        : Typeface.create("sans-serif", Typeface.NORMAL)
    );
    paint.setTextSize(size);
    return StaticLayout.Builder.obtain(s, 0, s.length(), paint, width)
      .setAlignment(Layout.Alignment.ALIGN_NORMAL)
      .setTextDirection(TextDirectionHeuristics.FIRSTSTRONG_LTR)
      .setIncludePad(true)
      .setLineSpacing(bold ? 0f : 3f, 1f)
      .build();
  }

  /** Caller owns the stream. An empty body produces one completely blank page. */
  static int write(String title, String text, Paper paper, OutputStream out) throws IOException {
    if (title == null || title.trim().isEmpty() || title.length() > 120) throw new IOException(
      "Enter a title of 1–120 characters."
    );
    if (text == null || text.length() > MAX_TEXT) throw new IOException(
      "Use no more than 50,000 characters in one PDF."
    );
    text = text.replace("\r\n", "\n").replace('\r', '\n');
    boolean blank = text.trim().isEmpty();
    int width = paper.width - 2 * MARGIN;
    StaticLayout heading = layout(title.trim(), width, 23, true);
    StaticLayout body = layout(text, width, 12, false);
    int line = 0,
      count = 0;
    PdfDocument pdf = new PdfDocument();
    try {
      do {
        if (++count > MAX_PAGES) throw new IOException(
          "This document exceeds 200 pages. Split the text into smaller PDFs."
        );
        PdfDocument.Page page = pdf.startPage(
          new PdfDocument.PageInfo.Builder(paper.width, paper.height, count).create()
        );
        try {
          if (!blank) {
            Canvas canvas = page.getCanvas();
            int top = MARGIN;
            if (count == 1) {
              canvas.save();
              canvas.translate(MARGIN, top);
              heading.draw(canvas);
              canvas.restore();
              top += heading.getHeight() + 18;
            }
            // Only render whole lines that fit; keep the original layout's Unicode shaping and wrapping.
            int startY = body.getLineTop(line),
              available = paper.height - MARGIN - top;
            int end = line + 1;
            while (end < body.getLineCount() && body.getLineBottom(end) - startY <= available)
              end++;
            canvas.save();
            canvas.translate(MARGIN, top);
            canvas.clipRect(0, 0, width, body.getLineBottom(end - 1) - startY);
            canvas.translate(0, -startY);
            body.draw(canvas);
            canvas.restore();
            line = end;
          }
        } finally {
          pdf.finishPage(page);
        }
      } while (!blank && line < body.getLineCount());
      pdf.writeTo(out);
    } finally {
      pdf.close();
    }
    return count;
  }
}
