package studio.ftpdf.app;

import android.Manifest;
import android.content.*;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;
import android.os.*;
import android.os.storage.StorageManager;
import android.os.storage.StorageVolume;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import android.provider.MediaStore;
import java.io.*;
import java.util.*;
import org.json.*;

/** Read-only index. The renderer sees profile-scoped opaque IDs, never a filesystem or content-URI API. */
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
  private String note = "",
    stamp = "";
  private long checked = 0;

  static void schema(SQLiteDatabase db) {
    db.execSQL(
      "CREATE TABLE IF NOT EXISTS phone_index(owner TEXT NOT NULL REFERENCES users(id), id TEXT NOT NULL, scope TEXT NOT NULL, locator TEXT NOT NULL, disk INTEGER NOT NULL, name TEXT NOT NULL, folder TEXT NOT NULL, size INTEGER NOT NULL, modified INTEGER NOT NULL, first_modified INTEGER NOT NULL, added INTEGER NOT NULL, PRIMARY KEY(owner,id))"
    );
    db.execSQL(
      "CREATE TABLE IF NOT EXISTS phone_checks(owner TEXT PRIMARY KEY REFERENCES users(id), checked INTEGER NOT NULL, stamp TEXT NOT NULL, note TEXT NOT NULL)"
    );
  }

  private SQLiteDatabase db() {
    return library.getWritableDatabase();
  }

  private void restore(String owner) {
    if (indexed.equals(owner)) return;
    Map<String, Entry> rows = new LinkedHashMap<>();
    try (
      Cursor c = db().rawQuery(
        "SELECT id,scope,locator,disk,name,folder,size,modified,added,first_modified FROM phone_index WHERE owner=? ORDER BY added,first_modified DESC,name,id",
        new String[] { owner }
      )
    ) {
      while (c.moveToNext()) {
        boolean disk = c.getInt(3) != 0;
        String scope = c.getString(1),
          loc = c.getString(2);
        Entry e = new Entry(
          c.getString(4),
          c.getString(5),
          c.getLong(6),
          c.getLong(7),
          disk ? new File(loc) : null,
          disk ? new File(scope) : null,
          disk ? null : Uri.parse(loc),
          disk ? null : Uri.parse(scope)
        );
        e.id = c.getString(0);
        e.added = c.getLong(8);
        e.firstModified = c.getLong(9);
        rows.put(e.id, e);
      }
    }
    try (
      Cursor c = db().rawQuery(
        "SELECT checked,stamp,note FROM phone_checks WHERE owner=?",
        new String[] { owner }
      )
    ) {
      boolean ok = c.moveToFirst();
      checked = ok ? c.getLong(0) : 0;
      stamp = ok ? c.getString(1) : "";
      note = ok ? c.getString(2) : "";
    }
    entries = rows;
    indexed = owner;
  }

  private String storageStamp(String owner) {
    boolean broad = prefs.getBoolean("scan:" + owner, false) && allowed();
    StringBuilder s = new StringBuilder(broad ? "all" : "folders");
    for (String t : new TreeSet<>(readableTrees(owner))) s.append('|').append(t);
    if (broad && Build.VERSION.SDK_INT >= 30) try {
      for (String v : new TreeSet<>(MediaStore.getExternalVolumeNames(app)))
        s.append('|')
          .append(v)
          .append(':')
          .append(MediaStore.getVersion(app, v))
          .append(':')
          .append(MediaStore.getGeneration(app, v));
    } catch (RuntimeException ignored) {
      /* Folder providers and older devices can always be refreshed manually. */
    }
    return key(s.toString());
  }

  private static final class Entry {

    String id;
    long added, firstModified;

    String scope() {
      return file == null ? tree.toString() : root.getPath();
    }

    boolean same(Entry e) {
      return (
        name.equals(e.name) &&
        folder.equals(e.folder) &&
        time == e.time &&
        size == e.size &&
        locator().equals(e.locator()) &&
        scope().equals(e.scope())
      );
    }

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
    if (!enabled) db().delete("phone_index", "owner=? AND disk=1", new String[] { owner });
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
    db().delete("phone_index", "owner=? AND scope=?", new String[] { owner, found });
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

  static boolean supported(String name) {
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
        if (
          v.getDirectory() != null &&
          (Environment.MEDIA_MOUNTED.equals(v.getState()) ||
            Environment.MEDIA_MOUNTED_READ_ONLY.equals(v.getState()))
        ) list.add(v.getDirectory().getCanonicalFile());
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
    boolean unreadable;
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
      if (children == null) {
        b.unreadable = true;
        continue;
      }
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
        if (
          c == null || c.getExtras().getBoolean(DocumentsContract.EXTRA_LOADING, false)
        ) throw new IOException();
        while (!b.exceeds(out.size()) && c.moveToNext()) {
          b.visited++;
          String id = c.getString(0),
            name = c.getString(1);
          if (id == null || name == null || name.startsWith(".")) continue;
          if (Document.MIME_TYPE_DIR.equals(c.getString(2))) todo.add(new String[] { id, name });
          else if (supported(name)) {
            Uri u = DocumentsContract.buildDocumentUriUsingTree(tree, id);
            out.putIfAbsent(
              identity(tree, id),
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

  // A file visible via two grants is one row. This identity is never used as a read grant.
  private String identity(Uri tree, String id) {
    if ("com.android.externalstorage.documents".equals(tree.getAuthority())) {
      int i = id.indexOf(':');
      if (i >= 0) {
        String volume = id.substring(0, i),
          relative = id.substring(i + 1);
        if ("primary".equalsIgnoreCase(volume)) return new File(
          Environment.getExternalStorageDirectory(),
          relative
        ).getPath();
        if (Build.VERSION.SDK_INT >= 30) for (StorageVolume v : app
          .getSystemService(StorageManager.class)
          .getStorageVolumes())
          if (volume.equalsIgnoreCase(v.getUuid()) && v.getDirectory() != null) return new File(
            v.getDirectory(),
            relative
          ).getPath();
      }
    }
    return tree.getAuthority() + ":" + id;
  }

  JSONObject scan(String owner, boolean force) throws Exception {
    final int ticket;
    final String token = storageStamp(owner);
    synchronized (this) {
      restore(owner);
      if (!force && !due(token)) return page(owner, "", 0, false, false);
      ticket = ++generation;
    }
    boolean broad = prefs.getBoolean("scan:" + owner, false) && allowed();
    Map<String, Entry> found = new HashMap<>();
    Set<String> complete = new HashSet<>();
    Budget b = new Budget();
    boolean partial = false;
    if (broad) for (File root : roots()) {
      b.unreadable = false;
      try {
        disk(root, found, b);
      } catch (IOException | SecurityException unavailable) {
        b.unreadable = true;
      }
      if (!b.unreadable && !b.exceeds(found.size())) complete.add(root.getPath());
      else partial = true;
    }
    for (String t : new TreeSet<>(readableTrees(owner))) {
      Uri uri = Uri.parse(t);
      try {
        tree(uri, found, b);
        if (!b.exceeds(found.size())) complete.add(t);
        else partial = true;
      } catch (Exception unavailable) {
        partial = true;
      }
    }
    synchronized (this) {
      if (ticket != generation || !owner.equals(library.currentOwner())) throw new IOException(
        "Phone sources changed. Refresh to check again."
      );
      restore(owner);
      long now = Math.max(checked + 1, System.currentTimeMillis());
      Set<String> seen = new HashSet<>();
      String warning = partial
        ? "Some folders could not be fully checked. Previously found files are kept."
        : "";
      // A scan is a metadata diff, never a re-import. Commit the diff and its checkpoint together.
      SQLiteDatabase db = db();
      db.beginTransaction();
      try {
        for (Map.Entry<String, Entry> item : found.entrySet()) {
          Entry e = item.getValue();
          e.id = key(owner + ":" + item.getKey());
          seen.add(e.id);
          Entry old = entries.get(e.id);
          if (old != null && e.same(old)) continue;
          e.added = old != null ? old.added : checked == 0 ? 0 : now;
          db.execSQL(
            "INSERT OR REPLACE INTO phone_index(owner,id,scope,locator,disk,name,folder,size,modified,first_modified,added) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            new Object[] {
              owner,
              e.id,
              e.scope(),
              e.locator(),
              e.file == null ? 0 : 1,
              e.name,
              e.folder,
              e.size,
              e.time,
              old == null ? e.time : old.firstModified,
              e.added,
            }
          );
        }
        for (Entry old : entries.values())
          if (complete.contains(old.scope()) && !seen.contains(old.id)) db.delete(
            "phone_index",
            "owner=? AND id=?",
            new String[] { owner, old.id }
          );
        db.execSQL("INSERT OR REPLACE INTO phone_checks VALUES(?,?,?,?)", new Object[] {
          owner,
          now,
          token,
          warning,
        });
        db.setTransactionSuccessful();
      } finally {
        db.endTransaction();
      }
      indexed = "";
      return page(owner, "", 0, false, false);
    }
  }

  private boolean due(String token) {
    long age = System.currentTimeMillis() - checked;
    return checked == 0 || !stamp.equals(token) || age < 0 || age > 15 * 60 * 1000;
  }

  synchronized JSONObject page(
    String owner,
    String query,
    int offset,
    boolean onlyNew,
    boolean check
  ) throws Exception {
    restore(owner);
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
    Set<File> mounted = allowed && enabled ? roots() : Collections.emptySet();
    int count = 0,
      newCount = 0;
    String q = query.trim().toLowerCase(Locale.ROOT);
    if (indexed.equals(owner)) for (Entry e : entries.values()) {
      if (
        e.file != null ? !mounted.contains(e.root) : !readable.contains(e.tree.toString())
      ) continue;
      boolean fresh = e.added > 0 && e.added == checked;
      if (fresh) newCount++;
      if (onlyNew && !fresh) continue;
      if (!(e.name + " " + e.folder).toLowerCase(Locale.ROOT).contains(q)) continue;
      if (count++ >= offset && files.length() < PAGE) files.put(e.json());
    }
    return new JSONObject()
      .put("allowed", allowed)
      .put("enabled", enabled)
      .put("folders", folders)
      .put("files", files)
      .put("total", count)
      .put("checked", checked)
      .put("newCount", newCount)
      .put(
        "due",
        check && ((enabled && allowed) || !readable.isEmpty()) && due(storageStamp(owner))
      )
      .put("notice", indexed.equals(owner) ? note : "");
  }

  synchronized InputStream open(String id) throws Exception {
    String owner = library.currentOwner();
    restore(owner);
    Entry e = entries.get(id);
    if (!owner.equals(indexed) || e == null) throw new IOException("Refresh the phone file list.");
    if (e.file != null) {
      if (
        !allowed() ||
        !prefs.getBoolean("scan:" + owner, false) ||
        !roots().contains(e.root) ||
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
