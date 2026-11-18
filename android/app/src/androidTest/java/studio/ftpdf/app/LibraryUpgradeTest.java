package studio.ftpdf.app;

import static org.junit.Assert.*;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class LibraryUpgradeTest {

  @Test
  public void oldOwnersAreNotResetOrAskedToStartOver() {
    try (SQLiteDatabase old = SQLiteDatabase.create(null)) {
      old.execSQL(
        "CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE,salt BLOB,hash BLOB,theme TEXT NOT NULL)"
      );
      old.execSQL("INSERT INTO users VALUES('existing','My workspace',NULL,NULL,NULL,'forest')");
      old.execSQL("CREATE TABLE docs(id TEXT PRIMARY KEY,owner TEXT,name TEXT,asset_key TEXT)");
      old.execSQL("INSERT INTO docs VALUES('kept','existing','My edited report','unaltered')");
      DeviceLibrary.instance(TestFiles.app).onUpgrade(old, 2, 3);
      try (
        Cursor c = old.rawQuery(
          "SELECT u.name,u.theme,u.needs_setup,u.birth_date,d.name,d.asset_key FROM users u JOIN docs d ON d.owner=u.id",
          null
        )
      ) {
        assertTrue(c.moveToFirst());
        assertEquals("My workspace", c.getString(0));
        assertEquals("forest", c.getString(1));
        assertEquals(0, c.getInt(2));
        assertTrue(c.isNull(3));
        assertEquals("My edited report", c.getString(4));
        assertEquals("unaltered", c.getString(5));
        assertFalse(c.moveToNext());
      }
    }
  }
}
