package studio.ftpdf.app;

import static org.junit.Assert.*;

import android.content.Context;
import android.os.SystemClock;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.*;
import org.json.JSONObject;

/** Interact with the installed UI; no test hooks, fake bridge, HTTP API or test server in the app. */
final class StudioScreen implements AutoCloseable {

  final Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
  final ActivityScenario<MainActivity> activity = ActivityScenario.launch(MainActivity.class);

  StudioScreen() throws Exception {
    await(
      "direct launch into the library",
      "document.querySelector('h1')?.textContent==='Workspace overview'"
    );
  }

  String js(String expr) throws Exception {
    CountDownLatch ready = new CountDownLatch(1);
    String[] answer = { "null" };
    activity.onActivity(a -> {
      WebView web = a.findViewById(R.id.library_webview);
      if (web == null) {
        ready.countDown();
        return;
      }
      web.evaluateJavascript(
        "(()=>{const q=s=>document.querySelector(s),btn=t=>Array.from(document.querySelectorAll('button')).find(b=>(b.getAttribute('aria-label')===t||b.textContent.trim()===t)&&!b.disabled&&b.offsetWidth>0);return (" +
          expr +
          ")})()",
        s -> {
          answer[0] = s;
          ready.countDown();
        }
      );
    });
    assertTrue("WebView did not respond", ready.await(12, TimeUnit.SECONDS));
    return answer[0];
  }

  void await(String label, String expr) throws Exception {
    long end = SystemClock.elapsedRealtime() + 40000;
    do {
      if ("true".equals(js(expr))) return;
      SystemClock.sleep(120);
    } while (SystemClock.elapsedRealtime() < end);
    throw new AssertionError(
      label +
        " — route: " +
        js("location.hash") +
        " — screen: " +
        js("document.body?.innerText.slice(-1800)")
    );
  }

  static String str(String s) {
    return JSONObject.quote(s);
  }

  void visible(String s) throws Exception {
    await("visible " + s, "!!q(" + str(s) + ")?.offsetWidth");
  }

  void click(String s) throws Exception {
    await(
      "click " + s,
      "(()=>{let e=q(" +
        str(s) +
        ");if(!e||e.disabled||!e.offsetWidth)return false;e.click();return true})()"
    );
  }

  /** Chromium needs an actual user gesture to launch the native file chooser. */
  void touch(String selector) throws Exception {
    visible(selector);
    js("q(" + str(selector) + ").scrollIntoView({block:'center'})");
    org.json.JSONArray bounds = new org.json.JSONArray(
      js(
        "(()=>{let r=q(" +
          str(selector) +
          ").getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2,innerWidth]})()"
      )
    );
    final double x = bounds.getDouble(0),
      y = bounds.getDouble(1),
      width = bounds.getDouble(2);
    int[] xy = new int[2];
    activity.onActivity(a -> {
      WebView web = a.findViewById(R.id.library_webview);
      web.getLocationOnScreen(xy);
      xy[0] += (int) ((x * web.getWidth()) / width);
      xy[1] += (int) ((y * web.getWidth()) / width);
    });
    androidx.test.uiautomator.UiDevice.getInstance(
      InstrumentationRegistry.getInstrumentation()
    ).click(xy[0], xy[1]);
  }

  void button(String text) throws Exception {
    await(
      "tap " + text,
      "(()=>{let e=btn(" + str(text) + ");if(!e)return false;e.click();return true})()"
    );
  }

  void fill(String s, String value) throws Exception {
    await(
      "edit " + s,
      "(()=>{let e=q(" +
        str(s) +
        ");if(!e||e.disabled)return false;const v=" +
        str(value) +
        ";if(e.isContentEditable)e.innerText=v;else{const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value')?.set;if(!setter)return false;setter.call(e,v)}e.dispatchEvent(new Event('input',{bubbles:true}));return true})()"
    );
  }

  void value(String s, String text) throws Exception {
    await(
      "reopen " + s,
      "(q(" + str(s) + ")?.value||q(" + str(s) + ")?.textContent||'').includes(" + str(text) + ")"
    );
  }

  void newDoc(String type, String name) throws Exception {
    button("New document");
    button(type);
    fill("[placeholder='Untitled document']", name);
  }

  void save() throws Exception {
    button("Save changes");
    await("changes stored", "q('.save-status')?.textContent==='Saved' && !q('.editor-alert')");
  }

  void reload() throws Exception {
    // reload() schedules a navigation. The old, editable DOM can still answer queries
    // for a few frames; never count that as a successful reopen or send a back tap to it.
    js("window.__ftPreviousTestDocument=true");
    activity.onActivity(a -> ((WebView) a.findViewById(R.id.library_webview)).reload());
    await(
      "fresh document after reload",
      "!window.__ftPreviousTestDocument && document.readyState==='complete' && !!(q('.editor-shell') || q('.app-shell'))"
    );
  }

  void closeEditor() throws Exception {
    button("Back to workspace");
    await("returned to library", "!!q('.main-content') && !q('.editor-shell')");
  }

  @Override
  public void close() {
    activity.close();
  }
}
