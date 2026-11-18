package studio.ftpdf.app;

import android.Manifest;
import android.content.*;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.*;
import android.os.storage.StorageManager;
import android.os.storage.StorageVolume;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import java.io.*;
import java.util.*;
import org.json.*;

/** Read-only index. The renderer sees short-lived opaque IDs, never a filesystem or content-URI API. */
final class PhoneFiles {

  private static final int LIMIT = 4000,
    VISITS = 90000,
    PAGE = 12;
  private final Context app;
  private final SharedPreferences prefs;
  private final DeviceLibrary library;
  private String indexed = "";
  private Map<String, Entry> entries = new LinkedHashMap<>();
  private int generation;
  private String note = "";

  private static final class Entry {

    String id = UUID.randomUUID().toString();
    final String name, folder;
    final long size, time;
    final File file, root;
    final Uri uri, tree;

    Entry(String n, String dir, long s, long t, File f, File r, Uri u, Uri tr) {
      name = n;
      folder = dir;
      size = s;
      time = t;
      file = f;
      root = r;
      uri = u;
      tree = tr;
    }

    String locator() {
      return file == null ? uri.toString() : file.toString();
    }

    JSONObject json() throws JSONException {
      return new JSONObject()
        .put("id", id)
        .put("name", name)
        .put(
          "source",
          UUID.nameUUIDFromBytes(
            locator().getBytes(java.nio.charset.StandardCharsets.UTF_8)
          ).toString()
        )
        .put("folder", folder)
        .put("size", size)
        .put("modified", time);
    }
  }

  PhoneFiles(Context c, DeviceLibrary db) {
    app = c.getApplicationContext();
    library = db;
    prefs = app.getSharedPreferences("phone-index-v1", Context.MODE_PRIVATE);
  }

  boolean allowed() {
    return Build.VERSION.SDK_INT >= 30
      ? Environment.isExternalStorageManager()
      : app.checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) ==
          PackageManager.PERMISSION_GRANTED;
  }

  synchronized void clear() {
    generation++;
    entries.clear();
    indexed = "";
    note = "";
  }

  synchronized void enable(String owner, boolean enabled) {
    prefs
      .edit()
      .putBoolean("scan:" + owner, enabled)
      .apply();
    clear();
  }

  private Set<String> trees(String owner) {
    return new LinkedHashSet<>(prefs.getStringSet("trees:" + owner, Collections.emptySet()));
  }

  private Set<String> readableTrees(String owner) {
    Set<String> granted = new HashSet<>();
    for (UriPermission p : app.getContentResolver().getPersistedUriPermissions())
      if (p.isReadPermission()) granted.add(p.getUri().toString());
    granted.retainAll(trees(owner));
    return granted;
  }

  synchronized void link(String owner, Uri tree) throws Exception {
    if (
      !DocumentsContract.isTreeUri(tree) || !"content".equals(tree.getScheme())
    ) throw new IOException("Choose a document folder.");
    Set<String> s = trees(owner);
    if (s.size() >= 12 && !s.contains(tree.toString())) throw new IOException(
      "Disconnect a folder before adding another."
    );
    app
      .getContentResolver()
      .takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION);
    s.add(tree.toString());
    prefs
      .edit()
      .putStringSet("trees:" + owner, s)
      .apply();
    clear();
  }

  private String key(String s) {
    return UUID.nameUUIDFromBytes(s.getBytes(java.nio.charset.StandardCharsets.UTF_8)).toString();
  }

  synchronized void forget(String owner, String id) {
    Set<String> s = trees(owner);
    String found = null;
    for (String t : s) if (key(t).equals(id)) found = t;
    if (found == null) return;
    s.remove(found);
    prefs
      .edit()
      .putStringSet("trees:" + owner, s)
      .apply();
    boolean used = false;
    for (Object v : prefs.getAll().values())
      if (v instanceof Set && ((Set<?>) v).contains(found)) used = true;
    if (!used) try {
      app
        .getContentResolver()
        .releasePersistableUriPermission(Uri.parse(found), Intent.FLAG_GRANT_READ_URI_PERMISSION);
    } catch (SecurityException ignored) {}
    clear();
  }

  private static boolean supported(String name) {
    int dot = name.lastIndexOf('.');
    return (
      dot >= 0 &&
      Arrays.asList("pdf", "doc", "docx", "txt", "html", "htm").contains(
        name.substring(dot + 1).toLowerCase(Locale.ROOT)
      )
    );
  }

  private static String display(Uri t) {
    String id = DocumentsContract.getTreeDocumentId(t);
    int slash = Math.max(id.lastIndexOf('/'), id.lastIndexOf(':'));
    return slash + 1 < id.length() ? id.substring(slash + 1) : id;
  }

  private Set<File> roots() throws IOException {
    Set<File> list = new LinkedHashSet<>();
    if (Build.VERSION.SDK_INT >= 30) {
      for (StorageVolume v : app.getSystemService(StorageManager.class).getStorageVolumes())
        if (v.getDirectory() != null) list.add(v.getDirectory().getCanonicalFile());
    } else {
      list.add(Environment.getExternalStorageDirectory().getCanonicalFile());
      for (File f : app.getExternalFilesDirs(null)) {
        if (f == null) continue;
        String p = f.getCanonicalPath();
        int i = p.indexOf("/Android/");
        if (i > 0) list.add(new File(p.substring(0, i)));
      }
    }
    return list;
  }

  private static final class Budget {

    int visited;
    final long end = SystemClock.elapsedRealtime() + 18000;

    boolean exceeds(int size) {
      return (
        size >= LIMIT ||
        visited >= VISITS ||
        SystemClock.elapsedRealtime() > end ||
        Thread.currentThread().isInterrupted()
      );
    }
  }

  private void disk(File root, Map<String, Entry> out, Budget b) throws IOException {
    ArrayDeque<File> todo = new ArrayDeque<>();
    todo.add(root);
    while (!todo.isEmpty() && !b.exceeds(out.size())) {
      File dir = todo.remove();
      File[] children = dir.listFiles();
      if (children == null) continue;
      for (File f : children) {
        if (b.exceeds(out.size())) break;
        b.visited++;
        String n = f.getName();
        if (n.startsWith(".") || !f.getCanonicalFile().equals(f.getAbsoluteFile())) continue;
        if (dir.equals(root) && n.equalsIgnoreCase("Android")) {
          File media = new File(f, "media");
          if (
            media.isDirectory() && media.getCanonicalFile().equals(media.getAbsoluteFile())
          ) todo.add(media);
          continue;
        }
        if (f.isDirectory()) todo.add(f);
        else if (supported(n) && f.isFile() && f.canRead()) {
          String path = f.getAbsolutePath();
          out.put(
            path,
            new Entry(
              n,
              dir.equals(root) ? "Shared storage" : dir.getName(),
              f.length(),
              f.lastModified(),
              f,
              root,
              null,
              null
            )
          );
        }
      }
    }
  }

  private void tree(Uri tree, Map<String, Entry> out, Budget b) throws Exception {
    ArrayDeque<String[]> todo = new ArrayDeque<>();
    Set<String> seen = new HashSet<>();
    todo.add(new String[] { DocumentsContract.getTreeDocumentId(tree), display(tree) });
    while (!todo.isEmpty() && !b.exceeds(out.size())) {
      String[] dir = todo.remove();
      if (!seen.add(dir[0])) continue;
      Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, dir[0]);
      try (
        Cursor c = app
          .getContentResolver()
          .query(
            children,
            new String[] {
              Document.COLUMN_DOCUMENT_ID,
              Document.COLUMN_DISPLAY_NAME,
              Document.COLUMN_MIME_TYPE,
              Document.COLUMN_SIZE,
              Document.COLUMN_LAST_MODIFIED,
            },
            null,
            null,
            null
          )
      ) {
        if (c == null) throw new IOException();
        while (!b.exceeds(out.size()) && c.moveToNext()) {
          b.visited++;
          String id = c.getString(0),
            name = c.getString(1);
          if (id == null || name == null || name.startsWith(".")) continue;
          if (Document.MIME_TYPE_DIR.equals(c.getString(2))) todo.add(new String[] { id, name });
          else if (supported(name)) {
            Uri u = DocumentsContract.buildDocumentUriUsingTree(tree, id);
            out.put(
              tree.getAuthority() + ":" + id,
              new Entry(
                name,
                dir[1],
                c.isNull(3) ? -1 : c.getLong(3),
                c.getLong(4),
                null,
                null,
                u,
                tree
              )
            );
          }
        }
      }
    }
  }

  JSONObject scan(String owner) throws Exception {
    int ticket;
    synchronized (this) {
      ticket = ++generation;
    }
    boolean broad = prefs.getBoolean("scan:" + owner, false) && allowed();
    Map<String, Entry> found = new HashMap<>();
    Budget b = new Budget();
    String warning = "";
    if (broad) {
      for (File root : roots()) disk(root, found, b);
    }
    for (String t : trees(owner)) {
      Uri uri = Uri.parse(t);
      if (broad && "com.android.externalstorage.documents".equals(uri.getAuthority())) continue;
      try {
        tree(uri, found, b);
      } catch (Exception e) {
        warning = "A linked folder is unavailable. Reconnect it or remove it from Sources.";
      }
    }
    List<Entry> sorted = new ArrayList<>(found.values());
    sorted.sort(
      Comparator.comparingLong((Entry e) -> e.time)
        .reversed()
        .thenComparing(e -> e.name)
    );
    synchronized (this) {
      if (ticket == generation && owner.equals(library.currentOwner())) {
        // Keep displayed IDs usable while a refresh of the same source finishes.
        Map<String, String> previous = new HashMap<>();
        if (indexed.equals(owner)) for (Entry old : entries.values())
          previous.put(old.locator(), old.id);
        entries = new LinkedHashMap<>();
        for (Entry e : sorted) {
          e.id = previous.getOrDefault(e.locator(), e.id);
          entries.put(e.id, e);
        }
        indexed = owner;
        note = b.exceeds(found.size())
          ? "Showing a bounded scan. Choose a smaller folder to focus the results."
          : warning;
      }
      return page(owner, "", 0);
    }
  }

  synchronized JSONObject page(String owner, String query, int offset) throws Exception {
    boolean allowed = allowed(),
      enabled = prefs.getBoolean("scan:" + owner, false);
    Set<String> linked = trees(owner),
      readable = readableTrees(owner);
    JSONArray folders = new JSONArray(),
      files = new JSONArray();
    for (String t : linked)
      folders.put(
        new JSONObject()
          .put("id", key(t))
          .put("name", display(Uri.parse(t)))
          .put("readable", readable.contains(t))
      );
    int count = 0;
    String q = query.trim().toLowerCase(Locale.ROOT);
    if (indexed.equals(owner)) for (Entry e : entries.values()) {
      if (e.file != null ? !(allowed && enabled) : !readable.contains(e.tree.toString())) continue;
      if (!(e.name + " " + e.folder).toLowerCase(Locale.ROOT).contains(q)) continue;
      if (count++ >= offset && files.length() < PAGE) files.put(e.json());
    }
    return new JSONObject()
      .put("allowed", allowed)
      .put("enabled", enabled)
      .put("folders", folders)
      .put("files", files)
      .put("total", count)
      .put("notice", indexed.equals(owner) ? note : "");
  }

  synchronized InputStream open(String id) throws Exception {
    String owner = library.currentOwner();
    Entry e = entries.get(id);
    if (!owner.equals(indexed) || e == null) throw new IOException("Refresh the phone file list.");
    if (e.file != null) {
      if (
        !allowed() ||
        !prefs.getBoolean("scan:" + owner, false) ||
        !e.file.getAbsoluteFile().equals(e.file.getCanonicalFile()) ||
        !e.file.getCanonicalPath().startsWith(e.root.getPath() + File.separator) ||
        e.file.length() > DeviceLibrary.MAX
      ) throw new IOException("File unavailable.");
      return new FileInputStream(e.file);
    }
    if (!readableTrees(owner).contains(e.tree.toString())) throw new IOException(
      "Folder disconnected."
    );
    InputStream in = app.getContentResolver().openInputStream(e.uri);
    if (in == null) throw new IOException("File unavailable.");
    return in;
  }
}
