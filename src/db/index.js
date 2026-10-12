'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

// Resolve a writable location for the database. The configured path is used
// when possible (e.g. a Render persistent disk at /var/data); otherwise we fall
// back to ./data so the app still boots on hosts without a mounted disk.
function resolveDatabaseFile(preferred) {
  const candidates = [preferred, path.resolve(process.cwd(), 'data', 'payroll.db')];
  for (const candidate of candidates) {
    try {
      fs.mkdirSync(path.dirname(candidate), { recursive: true });
      fs.accessSync(path.dirname(candidate), fs.constants.W_OK);
      if (candidate !== preferred) {
        console.warn(`[db] "${preferred}" not writable; using "${candidate}" instead.`);
      }
      return candidate;
    } catch (err) {
      console.warn(`[db] cannot use "${candidate}": ${err.message}`);
    }
  }
  throw new Error('[db] No writable directory available for the SQLite database.');
}

const databaseFile = resolveDatabaseFile(config.databaseFile);
console.log(`[db] using database file: ${databaseFile}`);

// Node's built-in SQLite driver (no native build step required).
const db = new DatabaseSync(databaseFile);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Apply the schema idempotently on boot.
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Lightweight migrations for databases created before a column existed.
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`[db] migrated: added ${table}.${column}`);
  }
}

ensureColumn('users', 'email_verified', 'INTEGER NOT NULL DEFAULT 0');

module.exports = db;
