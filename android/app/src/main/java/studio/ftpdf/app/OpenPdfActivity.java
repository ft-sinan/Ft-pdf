package studio.ftpdf.app;

/** A separate Android back-stack entry for Files → Open with. The user's studio
 * (including a draft, picker or unfinished welcome tour) is not navigated away. */
public final class OpenPdfActivity extends MainActivity {

  @Override
  protected boolean externalReader() {
    return true;
  }
}
