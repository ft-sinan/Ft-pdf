package studio.ftpdf.app;

import static org.junit.Assert.*;

import android.Manifest;
import android.content.pm.PackageManager;
import android.graphics.*;
import android.graphics.pdf.PdfRenderer;
import android.os.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.*;
import java.io.*;
import java.util.regex.Pattern;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class ScannerTest {

  final DeviceLibrary db = DeviceLibrary.instance(TestFiles.app);
  final UiDevice os = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());

  int documents() throws Exception {
    return ((JSONObject) db.call("workspace", new JSONObject())).getJSONArray("documents").length();
  }

  @Test
  public void denyingCameraKeepsTheLibraryUsable() throws Exception {
    try (StudioScreen ui = new StudioScreen()) {
      int before = documents();
      ui.button("Scan document");
      UiObject2 deny = os.wait(
        Until.findObject(By.res(Pattern.compile(".*:id/permission_deny_button"))),
        10000
      );
      if (deny == null) deny = os.wait(
        Until.findObject(By.text(Pattern.compile("(?i)^don.t allow$"))),
        2000
      );
      assertNotNull("Android requested only camera permission", deny);
      deny.click();
      ui.value(".scan-live", "Camera access is off");
      ui.button("Cancel");
      ui.button("Images to PDF");
      ui.value(".modal-head", "Images to PDF");
      assertEquals(before, documents());
    }
  }

  @Test
  public void realCameraLivePreviewAndManualShutter() throws Exception {
    assertEquals(
      PackageManager.PERMISSION_GRANTED,
      TestFiles.app.checkSelfPermission(Manifest.permission.CAMERA)
    );
    try (StudioScreen ui = new StudioScreen()) {
      int before = documents();
      ui.button("Scan document");
      ui.click(".scan-controls input:checked");
      ui.await(
        "real emulator camera frames",
        "q('video')?.videoWidth>0 && q('video').currentTime>0 && q('video').srcObject?.getVideoTracks()[0]?.readyState==='live'"
      );
      ui.js("window.__realCamera=q('video').srcObject.getVideoTracks()[0]");
      ui.button("Capture page manually");
      ui.value(".scan-count", "1 page");
      ui.button("Review pages");
      ui.await("camera released in review", "window.__realCamera.readyState==='ended'");
      ui.button("Close dialog");
      ui.button("Discard scan");
      ui.visible(".main-content");
      assertEquals(before, documents());
    }
  }

  // Synthetic *optical input* to the actual installed detector. No production test switch,
  // imported image, fake detector result, fake PDF writer or setState injection.
  private void paperStream(StudioScreen ui) throws Exception {
    ui.js(
      """
      (()=>{window.__sheet=1;window.__testTracks=[];navigator.mediaDevices.getUserMedia=async (opts)=>{
        if(opts.audio!==false)throw Error('Unexpected audio request');
        const c=document.createElement('canvas');c.width=640;c.height=480;const x=c.getContext('2d');
        const frame=()=>{const i=window.__sheet;x.fillStyle='#1c2623';x.fillRect(0,0,640,480);if(!i)return;
          x.fillStyle='white';x.beginPath();x.moveTo(145,42);x.lineTo(515,69);x.lineTo(487,430);x.lineTo(111,402);x.closePath();x.fill();
          x.fillStyle='#242424';for(let y=105;y<372;y+=19)x.fillRect(170,y,i===2?105:251,3);
          x.fillStyle=i===1?'#dc2736':i===2?'#1738d9':'#12a648';x.fillRect(251,175,116,124);
          if(i===2){x.fillStyle='#373737';x.fillRect(175,90,66,252);}
        };frame();const stream=c.captureStream(12),track=stream.getVideoTracks()[0];window.__testTracks.push(track);
        const t=setInterval(()=>{if(track.readyState==='ended')clearInterval(t);else frame()},70);return stream;
      };return true;})()
      """
    );
  }

  private void verifyPdf(String id, int... channels) throws Exception {
    File f = File.createTempFile("scan-qa-", ".pdf", TestFiles.app.getCacheDir());
    try {
      try (OutputStream out = new FileOutputStream(f)) {
        out.write(TestFiles.bytes(db.read(id, false).stream));
      }
      try (
        PdfRenderer r = new PdfRenderer(
          ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY)
        )
      ) {
        assertEquals(channels.length, r.getPageCount());
        for (int i = 0; i < channels.length; i++) try (PdfRenderer.Page p = r.openPage(i)) {
          assertTrue(
            "Automatic perspective crop excludes background",
            p.getWidth() < 360 && p.getHeight() < 330
          );
          Bitmap b = Bitmap.createBitmap(p.getWidth(), p.getHeight(), Bitmap.Config.ARGB_8888);
          try {
            p.render(b, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
            int px = b.getPixel(b.getWidth() / 2, b.getHeight() / 2),
              red = Color.red(px),
              green = Color.green(px),
              blue = Color.blue(px);
            assertEquals(
              "Source sheet at page " + (i + 1),
              channels[i],
              red > green && red > blue ? 0 : green > blue ? 1 : 2
            );
            assertTrue("white paper at corrected corner", Color.red(b.getPixel(10, 10)) > 190);
          } finally {
            b.recycle();
          }
        }
      }
    } finally {
      f.delete();
    }
  }

  @Test
  public void autoCaptureReviewAndInsertProduceOrderedPdfPages() throws Exception {
    try (StudioScreen ui = new StudioScreen()) {
      int before = documents();
      paperStream(ui);
      ui.button("Scan document");
      ui.await("detected four paper corners", "q('.scan-lines polygon')?.points.numberOfItems===4");
      ui.value(".scan-count", "1 page");
      SystemClock.sleep(1450);
      assertEquals(
        "no repeat while stationary",
        "1 page",
        new org.json.JSONTokener(ui.js("q('.scan-count').textContent")).nextValue()
      );
      ui.js("window.__sheet=2");
      ui.value(".scan-count", "2 pages");
      ui.button("Review pages");
      assertEquals(before, documents());
      ui.button("Move page 2 up");
      ui.button("Adjust corners of page 1");
      ui.visible("[aria-label='Top left corner']");
      ui.js(
        "q('[aria-label=\"Top left corner\"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))"
      );
      ui.button("Apply crop");
      ui.visible(".scan-pages");
      ui.button("Retake page 2");
      ui.js("window.__sheet=1");
      ui.await(
        "retake replaced the selected page, back in review",
        "document.querySelectorAll('.scan-pages li').length===2"
      );
      ui.fill(".scanner .field input", "Auto-scanned sheets");
      ui.button("Create scanned PDF");
      ui.visible("canvas[data-rendered='true'][aria-label='PDF page 1 of 2']");
      String id = ui.documentId();
      verifyPdf(id, 2, 0);
      assertEquals(before + 1, documents());
      ui.edit();
      ui.button("Add scanned pages");
      ui.js("window.__sheet=3");
      ui.value(".scan-count", "1 page");
      ui.button("Review pages");
      ui.value(".scan-summary", "Insert after PDF page 1");
      ui.button("Save inserted pages");
      ui.visible("canvas[aria-label='PDF page 2 of 3']");
      verifyPdf(id, 2, 1, 0);
      assertEquals(before + 1, documents());
    }
  }
}
