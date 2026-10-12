'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

// Ensure the data directory exists before opening the database file.
fs.mkdirSync(path.dirname(config.databaseFile), { recursive: true });

// Node's built-in SQLite driver (no native build step required).
const db = new DatabaseSync(config.databaseFile);
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
