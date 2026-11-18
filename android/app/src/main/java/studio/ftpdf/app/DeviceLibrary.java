package studio.ftpdf.app;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.util.Base64;
import java.io.*;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.*;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import org.json.JSONArray;
import org.json.JSONObject;

/** Android's private backend. Large document bytes are files, not SQLite CursorWindow blobs. */
final class DeviceLibrary extends SQLiteOpenHelper {

  static final int MAX = 25 * 1024 * 1024,
    QUOTA = 100 * 1024 * 1024;
  static final String[] KINDS = { "pdf", "docx", "txt", "html" };
  private final Context app;
  private final File objects, staging;
  private final Map<String, Stage> uploads = new HashMap<>();
  private final SecureRandom random = new SecureRandom();
  private int failedLogins;
  private long blockUntil;

  static final class Data {

    final InputStream stream;
    final long updated;

    Data(InputStream stream, long updated) {
      this.stream = stream;
      this.updated = updated;
    }
  }

  private static final class Stage {

    final String owner;
    boolean pinned;
    long used = now();

    Stage(String owner) {
      this.owner = owner;
    }
  }

  private static DeviceLibrary singleton;

  static synchronized DeviceLibrary instance(Context c) {
    if (singleton == null) singleton = new DeviceLibrary(c);
    return singleton;
  }

  DeviceLibrary(Context c) {
    super(c.getApplicationContext(), "ft-library-v1.db", null, 3);
    app = c.getApplicationContext();
    objects = new File(app.getFilesDir(), "documents");
    staging = new File(app.getCacheDir(), "incoming-documents");
    objects.mkdirs();
    staging.mkdirs();
    for (File f : Optional.ofNullable(staging.listFiles()).orElse(new File[0])) f.delete();
  }

  @Override
  public void onConfigure(SQLiteDatabase db) {
    db.setForeignKeyConstraintsEnabled(true);
  }

  @Override
  public void onCreate(SQLiteDatabase db) {
    db.execSQL(
      "CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE,salt BLOB,hash BLOB,theme TEXT NOT NULL DEFAULT 'terracotta',birth_date TEXT,needs_setup INTEGER NOT NULL DEFAULT 0)"
    );
    db.execSQL(
      "CREATE TABLE session(slot INTEGER PRIMARY KEY CHECK(slot=1),owner TEXT NOT NULL REFERENCES users(id))"
    );
    db.execSQL(
      "CREATE TABLE collections(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),name TEXT COLLATE NOCASE NOT NULL,color TEXT NOT NULL,UNIQUE(owner,name))"
    );
    db.execSQL(
      "CREATE TABLE docs(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,type TEXT NOT NULL,collectionId TEXT REFERENCES collections(id) ON DELETE SET NULL,starred INTEGER NOT NULL DEFAULT 0,trashed INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,updated INTEGER NOT NULL,opened INTEGER NOT NULL,pages INTEGER,locked INTEGER NOT NULL,cover TEXT NOT NULL,size INTEGER NOT NULL,asset_key TEXT NOT NULL UNIQUE)"
    );
    db.execSQL("CREATE INDEX docs_owner ON docs(owner,updated)");
    phoneLinks(db);
    db.execSQL(
      "CREATE TABLE activity(id INTEGER PRIMARY KEY,owner TEXT NOT NULL,message TEXT NOT NULL,created INTEGER NOT NULL)"
    );
  }

  @Override
  public void onUpgrade(SQLiteDatabase db, int old, int next) {
    if (old < 2) phoneLinks(db);
    if (old < 3) {
      // Do not reseed or remove anything, even if a file looks like an old example.
      db.execSQL("ALTER TABLE users ADD COLUMN birth_date TEXT");
      db.execSQL("ALTER TABLE users ADD COLUMN needs_setup INTEGER NOT NULL DEFAULT 0");
    }
  }

  private void phoneLinks(SQLiteDatabase db) {
    db.execSQL(
      "CREATE TABLE IF NOT EXISTS phone_copies(owner TEXT NOT NULL,source TEXT NOT NULL,doc TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,PRIMARY KEY(owner,source))"
    );
  }

  private SQLiteDatabase db() {
    return getWritableDatabase();
  }

  private static String uid() {
    return UUID.randomUUID().toString();
  }

  private static long now() {
    return System.currentTimeMillis();
  }

  private static IOException error(String msg) {
    return new IOException(msg);
  }

  private static JSONObject obj(Object... pairs) throws Exception {
    JSONObject o = new JSONObject();
    for (int i = 0; i < pairs.length; i += 2) o.put(
      (String) pairs[i],
      pairs[i + 1] == null ? JSONObject.NULL : pairs[i + 1]
    );
    return o;
  }

  private String one(String sql, String... args) {
    try (Cursor c = db().rawQuery(sql, args)) {
      return c.moveToFirst() ? c.getString(0) : null;
    }
  }

  synchronized String currentOwner() throws Exception {
    return owner();
  }

  private String owner() throws Exception {
    String id = one("SELECT owner FROM session WHERE slot=1");
    if (id == null) throw error("Please reopen the library.");
    return id;
  }

  private String switchTo(String id) {
    db().execSQL("INSERT OR REPLACE INTO session(slot,owner) VALUES(1,?)", new Object[] { id });
    for (String key : new ArrayList<>(uploads.keySet())) discard(key);
    return id;
  }

  private void event(String owner, String message) {
    db().execSQL("INSERT INTO activity(owner,message,created) VALUES(?,?,?)", new Object[] {
      owner,
      message,
      now(),
    });
  }

  private File part(File dir, String key, String ext) {
    return new File(dir, key + ext);
  }

  private void removePair(File dir, String key) {
    if (key != null) {
      part(dir, key, ".bin").delete();
      part(dir, key, ".txt").delete();
    }
  }

  private static String validName(String s, int max) throws Exception {
    s = s.replaceAll("[\\p{Cntrl}/\\\\]", " ").trim();
    if (s.isEmpty() || s.length() > max) throw error(
      "Enter a name between 1 and " + max + " characters."
    );
    return s;
  }

  private static String docName(String s, String type) throws Exception {
    if (s.toLowerCase(Locale.ROOT).endsWith("." + type)) s = s.substring(
      0,
      s.length() - type.length() - 1
    );
    return validName(s, 140);
  }

  private String collection(String owner, JSONObject a) throws Exception {
    if (a.isNull("collectionId") || a.optString("collectionId").isEmpty()) return null;
    String id = a.getString("collectionId");
    if (one("SELECT id FROM collections WHERE owner=? AND id=?", owner, id) == null) throw error(
      "Collection not found."
    );
    return id;
  }

  private static String cover(String type) {
    return type.equals("pdf")
      ? "report"
      : type.equals("docx")
        ? "proposal"
        : type.equals("html")
          ? "code"
          : "note";
  }

  private static String s(Cursor c, String k) {
    return c.getString(c.getColumnIndexOrThrow(k));
  }

  private static long n(Cursor c, String k) {
    return c.getLong(c.getColumnIndexOrThrow(k));
  }

  private JSONObject meta(Cursor c) throws Exception {
    return obj(
      "id",
      s(c, "id"),
      "name",
      s(c, "name"),
      "type",
      s(c, "type"),
      "collectionId",
      s(c, "collectionId"),
      "starred",
      n(c, "starred") != 0,
      "trashed",
      n(c, "trashed") != 0,
      "created",
      n(c, "created"),
      "updated",
      n(c, "updated"),
      "opened",
      n(c, "opened"),
      "pages",
      c.isNull(c.getColumnIndexOrThrow("pages")) ? JSONObject.NULL : n(c, "pages"),
      "locked",
      n(c, "locked") != 0,
      "cover",
      s(c, "cover"),
      "size",
      n(c, "size")
    );
  }

  private JSONObject document(String owner, String id) throws Exception {
    try (
      Cursor c = db().rawQuery("SELECT * FROM docs WHERE owner=? AND id=?", new String[] {
        owner,
        id,
      })
    ) {
      if (!c.moveToFirst()) throw error("Document not found.");
      return meta(c);
    }
  }

  private JSONObject user(String owner) throws Exception {
    try (
      Cursor c = db().rawQuery(
        "SELECT name,email,theme,birth_date,needs_setup FROM users WHERE id=?",
        new String[] { owner }
      )
    ) {
      if (!c.moveToFirst()) throw error("Account not found.");
      return obj(
        "id",
        owner,
        "name",
        c.getString(0),
        "email",
        c.getString(1),
        "theme",
        c.getString(2),
        "isGuest",
        c.isNull(1),
        "birthDate",
        c.getString(3),
        "needsSetup",
        c.getInt(4) != 0
      );
    }
  }

  private JSONObject workspace(String owner) throws Exception {
    JSONArray docs = new JSONArray(),
      cols = new JSONArray(),
      activity = new JSONArray();
    String[] args = { owner };
    try (Cursor c = db().rawQuery("SELECT * FROM docs WHERE owner=? ORDER BY updated DESC", args)) {
      while (c.moveToNext()) docs.put(meta(c));
    }
    try (
      Cursor c = db().rawQuery(
        "SELECT id,name,color FROM collections WHERE owner=? ORDER BY rowid",
        args
      )
    ) {
      while (c.moveToNext())
        cols.put(obj("id", c.getString(0), "name", c.getString(1), "color", c.getString(2)));
    }
    try (
      Cursor c = db().rawQuery(
        "SELECT id,message,created FROM activity WHERE owner=? ORDER BY id DESC LIMIT 12",
        args
      )
    ) {
      while (c.moveToNext())
        activity.put(obj("id", c.getLong(0), "message", c.getString(1), "created", c.getLong(2)));
    }
    return obj(
      "user",
      user(owner),
      "documents",
      docs,
      "collections",
      cols,
      "activity",
      activity,
      "quota",
      QUOTA
    );
  }

  private String insert(
    String owner,
    String name,
    String type,
    String col,
    boolean star,
    long created,
    long updated,
    long opened,
    Object pages,
    boolean locked,
    String cover,
    String key,
    long size
  ) {
    String id = uid();
    db().execSQL(
      "INSERT INTO docs(id,owner,name,type,collectionId,starred,created,updated,opened,pages,locked,cover,asset_key,size) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      new Object[] {
        id,
        owner,
        name,
        type,
        col,
        star ? 1 : 0,
        created,
        updated,
        opened,
        pages,
        locked ? 1 : 0,
        cover,
        key,
        size,
      }
    );
    return id;
  }

  private String guest(boolean firstOpen) throws Exception {
    String previous = one("SELECT id FROM users WHERE email IS NULL LIMIT 1");
    if (previous != null) return switchTo(previous);
    String guest = uid();
    db().beginTransaction();
    try {
      db().execSQL("INSERT INTO users(id,name,needs_setup) VALUES(?,?,?)", new Object[] {
        guest,
        "Guest",
        firstOpen ? 1 : 0,
      });
      switchTo(guest);
      db().setTransactionSuccessful();
    } finally {
      db().endTransaction();
    }
    return guest;
  }

  private JSONObject saveProfile(String owner, JSONObject a) throws Exception {
    String name = validName(a.getString("name"), 64),
      birth = a.optString("birthDate", "");
    if (!birth.isEmpty()) {
      try {
        if (!birth.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")) throw new IllegalArgumentException();
        java.time.LocalDate date = java.time.LocalDate.parse(birth);
        if (
          date.getYear() < 1 || date.isAfter(java.time.LocalDate.now())
        ) throw new IllegalArgumentException();
      } catch (java.time.DateTimeException | IllegalArgumentException invalid) {
        throw error("Choose a valid date of birth that is not in the future.");
      }
    }
    // Completion and both profile fields are one acknowledged write to the active profile.
    db().execSQL("UPDATE users SET name=?,birth_date=?,needs_setup=0 WHERE id=?", new Object[] {
      name,
      birth.isEmpty() ? null : birth,
      owner,
    });
    return user(owner);
  }

  private byte[] hash(String password, byte[] salt) throws Exception {
    PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, 310000, 256);
    try {
      return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
    } finally {
      spec.clearPassword();
    }
  }

  private Object auth(String op, String owner, JSONObject a) throws Exception {
    if (op.equals("logout")) return workspace(guest(false));
    String email = a.getString("email").trim().toLowerCase(Locale.ROOT),
      pw = a.getString("password");
    if (pw.length() > 256) throw error("Password is too long.");
    if (op.equals("register")) {
      if (!user(owner).getBoolean("isGuest")) throw error("Sign out first.");
      String name = validName(a.getString("name"), 64);
      if (
        pw.length() < 8 ||
        email.length() > 200 ||
        !android.util.Patterns.EMAIL_ADDRESS.matcher(email).matches()
      ) throw error("Use a valid email and a password of at least eight characters.");
      if (one("SELECT id FROM users WHERE email=?", email) != null) throw error(
        "This account already exists on this device."
      );
      byte[] salt = new byte[16];
      random.nextBytes(salt);
      db().execSQL(
        "UPDATE users SET name=?,email=?,salt=?,hash=?,needs_setup=0 WHERE id=?",
        new Object[] { name, email, salt, hash(pw, salt), owner }
      );
      return workspace(owner);
    }
    if (now() < blockUntil) throw error("Please wait a minute before trying again.");
    try (
      Cursor c = db().rawQuery("SELECT id,salt,hash FROM users WHERE email=?", new String[] {
        email,
      })
    ) {
      boolean exists = c.moveToFirst();
      byte[] candidate = hash(pw, exists ? c.getBlob(1) : new byte[16]);
      if (!exists || !MessageDigest.isEqual(candidate, c.getBlob(2))) {
        if (++failedLogins >= 8) {
          blockUntil = now() + 60000;
          failedLogins = 0;
        }
        throw error("The email or password is incorrect.");
      }
      failedLogins = 0;
      return workspace(switchTo(c.getString(0)));
    }
  }

  private void discard(String id) {
    if (uploads.remove(id) != null) removePair(staging, id);
  }

  private String begin(String owner) throws Exception {
    for (String k : new ArrayList<>(uploads.keySet()))
      if (!uploads.get(k).pinned && now() - uploads.get(k).used > 300000) discard(k);
    if (uploads.size() >= 4) throw error("Finish the current import first.");
    String id = uid();
    uploads.put(id, new Stage(owner));
    try {
      part(staging, id, ".bin").createNewFile();
      part(staging, id, ".txt").createNewFile();
    } catch (IOException e) {
      discard(id);
      throw e;
    }
    return id;
  }

  private void requireStage(String owner, String id) throws Exception {
    Stage stage = uploads.get(id);
    if (stage == null || !stage.owner.equals(owner)) throw error("Import expired. Try again.");
    stage.used = now();
  }

  synchronized void pinExport(String id) throws Exception {
    requireStage(owner(), id);
    uploads.get(id).pinned = true;
  }

  synchronized InputStream openExport(String id) throws Exception {
    requireStage(owner(), id);
    return new FileInputStream(part(staging, id, ".bin"));
  }

  synchronized void finishExport(String id) {
    discard(id);
  }

  private Object put(String owner, JSONObject a, String stage) throws Exception {
    requireStage(owner, stage);
    String existing = a.optString("id", ""),
      type = a.getString("type");
    if (!Arrays.asList(KINDS).contains(type)) throw error("Unknown file format.");
    JSONObject old = existing.isEmpty() ? null : document(owner, existing);
    if (
      old != null &&
      (old.getBoolean("trashed") || old.getBoolean("locked") || !type.equals(old.getString("type")))
    ) throw error("This document cannot be edited.");
    if (
      old != null && a.has("expected") && old.getLong("updated") != a.getLong("expected")
    ) throw error("The document changed. Reopen it before saving.");
    String name = old == null ? docName(a.getString("name"), type) : old.getString("name"),
      col = old == null ? collection(owner, a) : null;
    long size = part(staging, stage, ".bin").length(),
      used = Long.parseLong(one("SELECT coalesce(sum(size),0) FROM docs WHERE owner=?", owner));
    if (size > MAX || used + size - (old == null ? 0 : old.getLong("size")) > QUOTA) throw error(
      "Storage limit reached (25 MB per file, 100 MB per library)."
    );
    String key = uid(),
      prev =
        old == null
          ? null
          : one("SELECT asset_key FROM docs WHERE owner=? AND id=?", owner, existing),
      id = existing;
    Object pages = a.isNull("pages") ? null : a.getInt("pages");
    boolean locked = a.optBoolean("locked");
    long t = now();
    boolean ok = false;
    db().beginTransaction();
    try {
      for (String ext : new String[] { ".bin", ".txt" })
        if (!part(staging, stage, ext).renameTo(part(objects, key, ext))) throw error(
          "Could not store the file on this device."
        );
      if (old == null) id = insert(
        owner,
        name,
        type,
        col,
        false,
        t,
        t,
        0,
        pages,
        locked,
        cover(type),
        key,
        size
      );
      else db().execSQL(
        "UPDATE docs SET asset_key=?,size=?,updated=?,pages=?,locked=? WHERE owner=? AND id=?",
        new Object[] {
          key,
          size,
          Math.max(t, old.getLong("updated") + 1),
          pages,
          locked ? 1 : 0,
          owner,
          id,
        }
      );
      if (old == null && a.has("source")) db().execSQL(
        "INSERT OR REPLACE INTO phone_copies VALUES(?,?,?)",
        new Object[] { owner, a.getString("source"), id }
      );
      event(
        owner,
        (old == null ? (a.optBoolean("imported") ? "Imported " : "Created ") : "Saved ") +
          name +
          "." +
          type
      );
      db().setTransactionSuccessful();
      ok = true;
    } finally {
      db().endTransaction();
      discard(stage);
      if (!ok) removePair(objects, key);
    }
    removePair(objects, prev);
    return document(owner, id);
  }

  private Object patch(String owner, JSONObject a) throws Exception {
    String id = a.getString("id");
    JSONObject old = document(owner, id);
    String name = a.has("name")
      ? docName(a.getString("name"), old.getString("type"))
      : old.getString("name");
    String col = a.has("collectionId")
      ? collection(owner, a)
      : old.isNull("collectionId")
        ? null
        : old.getString("collectionId");
    db().execSQL(
      "UPDATE docs SET name=?,collectionId=?,starred=?,trashed=?,updated=? WHERE owner=? AND id=?",
      new Object[] {
        name,
        col,
        a.optBoolean("starred", old.getBoolean("starred")) ? 1 : 0,
        a.optBoolean("trashed", old.getBoolean("trashed")) ? 1 : 0,
        a.has("name") ? now() : old.getLong("updated"),
        owner,
        id,
      }
    );
    event(
      owner,
      (a.has("trashed")
        ? a.getBoolean("trashed")
          ? "Trashed "
          : "Restored "
        : a.has("starred")
          ? a.getBoolean("starred")
            ? "Starred "
            : "Unstarred "
          : a.has("name")
            ? "Renamed "
            : "Moved ") + name
    );
    return document(owner, id);
  }

  synchronized Object call(String op, JSONObject a) throws Exception {
    if (op.equals("workspace")) {
      String current = one("SELECT owner FROM session WHERE slot=1");
      return workspace(current == null ? guest(true) : current);
    }
    String u = owner(),
      id = a.optString("id", "");
    if (a.has("expectedOwner") && !u.equals(a.getString("expectedOwner"))) throw error(
      "The active library changed. Reopen it and try again."
    );
    switch (op) {
      case "login":
      case "logout":
      case "register":
        return auth(op, u, a);
      case "profile.save":
        return saveProfile(u, a);
      case "settings":
        if (a.has("theme")) {
          String theme = a.getString("theme");
          if (
            !Arrays.asList("terracotta", "espresso", "forest", "midnight").contains(theme)
          ) throw error("Unknown theme.");
          db().execSQL("UPDATE users SET theme=? WHERE id=?", new Object[] { theme, u });
        }
        if (a.has("name")) db().execSQL("UPDATE users SET name=? WHERE id=?", new Object[] {
          validName(a.getString("name"), 64),
          u,
        });
        return user(u);
      case "collection.put": {
        String name = validName(a.getString("name"), 64),
          color = a.getString("color");
        if (
          !Arrays.asList("rose", "gold", "sage", "blue", "plum", "stone").contains(color)
        ) throw error("Unknown folder color.");
        if (
          one("SELECT id FROM collections WHERE owner=? AND name=? AND id!=?", u, name, id) != null
        ) throw error("A collection with that name already exists.");
        if (id.isEmpty()) {
          id = uid();
          db().execSQL("INSERT INTO collections VALUES(?,?,?,?)", new Object[] {
            id,
            u,
            name,
            color,
          });
        } else {
          if (one("SELECT id FROM collections WHERE owner=? AND id=?", u, id) == null) throw error(
            "Collection not found."
          );
          db().execSQL(
            "UPDATE collections SET name=?,color=? WHERE owner=? AND id=?",
            new Object[] { name, color, u, id }
          );
        }
        event(u, "Saved collection " + name);
        return obj("id", id, "name", name, "color", color);
      }
      case "collection.delete":
        if (one("SELECT id FROM collections WHERE owner=? AND id=?", u, id) == null) throw error(
          "Collection not found."
        );
        db().execSQL("DELETE FROM collections WHERE owner=? AND id=?", new Object[] { u, id });
        return JSONObject.NULL;
      case "copy.find": {
        String match = one(
          "SELECT d.id FROM docs d JOIN phone_copies p ON p.doc=d.id WHERE p.owner=? AND p.source=? AND d.owner=? AND d.trashed=0",
          u,
          a.getString("source"),
          u
        );
        return match == null ? JSONObject.NULL : document(u, match);
      }
      case "upload.begin":
        return begin(u);
      case "upload.append": {
        requireStage(u, id);
        String encoded = a.getString("data");
        if (encoded.length() > 270000) throw error("Chunk is too large.");
        byte[] b = Base64.decode(encoded, Base64.DEFAULT);
        boolean text = "content".equals(a.getString("part"));
        File f = part(staging, id, text ? ".txt" : ".bin");
        if (f.length() + b.length > (text ? 40 * 1024 * 1024 : MAX)) throw error(
          "File is too large."
        );
        try (OutputStream out = new FileOutputStream(f, true)) {
          out.write(b);
        }
        return JSONObject.NULL;
      }
      case "upload.cancel":
        requireStage(u, id);
        discard(id);
        return JSONObject.NULL;
      case "document.put":
        return put(u, a, a.getString("stage"));
      case "pdf.create": {
        String stage = begin(u);
        try {
          String title = docName(a.getString("name"), "pdf");
          int pages;
          try (OutputStream out = new FileOutputStream(part(staging, stage, ".bin"))) {
            pages = LocalPdfWriter.write(
              title,
              a.optString("text"),
              "letter".equals(a.optString("paper"))
                ? LocalPdfWriter.Paper.LETTER
                : LocalPdfWriter.Paper.A4,
              out
            );
          }
          a.put("type", "pdf").put("pages", pages);
          return put(u, a, stage);
        } finally {
          discard(stage);
        }
      }
      case "document.info":
        return document(u, id);
      case "document.patch":
        return patch(u, a);
      case "document.open": {
        JSONObject d = document(u, id);
        if (d.getBoolean("trashed")) throw error("Restore the document first.");
        db().execSQL("UPDATE docs SET opened=? WHERE owner=? AND id=?", new Object[] {
          now(),
          u,
          id,
        });
        event(u, "Opened " + d.getString("name"));
        return document(u, id);
      }
      case "document.delete": {
        JSONObject d = document(u, id);
        if (!d.getBoolean("trashed")) throw error("Move the file to Trash first.");
        String key = one("SELECT asset_key FROM docs WHERE owner=? AND id=?", u, id);
        db().execSQL("DELETE FROM docs WHERE owner=? AND id=?", new Object[] { u, id });
        removePair(objects, key);
        event(u, "Deleted " + d.getString("name"));
        return JSONObject.NULL;
      }
      default:
        throw error("Unknown library action.");
    }
  }

  synchronized Data read(String id, boolean content) throws Exception {
    String u = owner();
    try (
      Cursor c = db().rawQuery(
        "SELECT asset_key,updated FROM docs WHERE owner=? AND id=?",
        new String[] { u, id }
      )
    ) {
      if (!c.moveToFirst()) throw error("Document not found.");
      return new Data(
        new FileInputStream(part(objects, c.getString(0), content ? ".txt" : ".bin")),
        c.getLong(1)
      );
    }
  }
}
