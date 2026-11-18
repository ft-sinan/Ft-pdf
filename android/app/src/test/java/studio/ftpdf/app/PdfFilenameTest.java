package studio.ftpdf.app;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class PdfFilenameTest {

  @Test
  public void suffixIsAddedOnlyOnce() {
    assertEquals("Field notes.pdf", LocalPdfWriter.suggestedFilename("  Field notes.PDF "));
    assertEquals("യാത്ര.pdf", LocalPdfWriter.suggestedFilename("യാത്ര"));
  }

  @Test
  public void suggestsOneSafeFilenameForThePicker() {
    assertEquals("Chapter 1_2_ notes.pdf", LocalPdfWriter.suggestedFilename("Chapter 1/2: notes"));
    assertEquals("Untitled document.pdf", LocalPdfWriter.suggestedFilename(".pdf"));
  }
}
