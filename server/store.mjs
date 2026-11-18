import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { QUOTA } from './formats.mjs';

export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE,password TEXT,theme TEXT NOT NULL DEFAULT 'terracotta',needs_setup INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS collections(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,color TEXT NOT NULL,UNIQUE(user_id,name COLLATE NOCASE));
    CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,type TEXT NOT NULL,collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,starred INTEGER NOT NULL DEFAULT 0,trashed INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,updated INTEGER NOT NULL,opened INTEGER NOT NULL DEFAULT 0,pages INTEGER,locked INTEGER NOT NULL DEFAULT 0,cover TEXT NOT NULL,content TEXT NOT NULL DEFAULT '',bytes BLOB NOT NULL);
    CREATE INDEX IF NOT EXISTS docs_by_owner ON documents(user_id,updated);
    CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,message TEXT NOT NULL,created INTEGER NOT NULL);
  `);
  // Existing libraries (including previously edited examples) are already in use.
  if (
    !db
      .prepare('PRAGMA table_info(users)')
      .all()
      .some((c) => c.name === 'needs_setup')
  )
    db.exec('ALTER TABLE users ADD COLUMN needs_setup INTEGER NOT NULL DEFAULT 0');
  return db;
}
const cols =
  'id,name,type,collection_id AS collectionId,starred,trashed,created,updated,opened,pages,locked,cover,length(bytes) AS size';
export const meta = (r) =>
  r ? { ...r, starred: !!r.starred, trashed: !!r.trashed, locked: !!r.locked } : null;
export const findDoc = (db, user, id) =>
  meta(db.prepare(`SELECT ${cols} FROM documents WHERE user_id=? AND id=?`).get(user, id));
export const log = (db, user, message, time = Date.now()) =>
  db
    .prepare('INSERT INTO activity(user_id,message,created) VALUES(?,?,?)')
    .run(user, message, time);
export function workspace(db, id) {
  const { needs_setup, ...u } = db
    .prepare('SELECT id,name,email,theme,needs_setup FROM users WHERE id=?')
    .get(id);
  return {
    user: { ...u, isGuest: !u.email, needsSetup: !!needs_setup },
    documents: db
      .prepare(`SELECT ${cols} FROM documents WHERE user_id=? ORDER BY updated DESC`)
      .all(id)
      .map(meta),
    collections: db
      .prepare('SELECT id,name,color FROM collections WHERE user_id=? ORDER BY rowid')
      .all(id),
    activity: db
      .prepare(
        'SELECT id,message,created FROM activity WHERE user_id=? ORDER BY created DESC,id DESC LIMIT 12',
      )
      .all(id),
    quota: QUOTA,
  };
}
export const defaultCover = (type) =>
  ({ pdf: 'report', docx: 'proposal', html: 'code', txt: 'note' })[type];
export function insertDoc(db, user, d) {
  const id = randomUUID(),
    now = Date.now();
  db.prepare(
    `INSERT INTO documents(id,user_id,name,type,collection_id,starred,created,updated,opened,pages,locked,cover,content,bytes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    user,
    d.name,
    d.type,
    d.collectionId || null,
    d.starred ? 1 : 0,
    d.created ?? now,
    d.updated ?? now,
    d.opened ?? 0,
    d.pages ?? null,
    d.locked ? 1 : 0,
    d.cover || defaultCover(d.type),
    d.content || '',
    d.bytes,
  );
  return findDoc(db, user, id);
}
/** A new guest is a real, empty workspace. The tour never writes to this store. */
export function createGuest(db, firstVisit = true) {
  const id = randomUUID();
  db.prepare('INSERT INTO users(id,name,needs_setup) VALUES(?,?,?)').run(
    id,
    'Guest',
    firstVisit ? 1 : 0,
  );
  return id;
}
