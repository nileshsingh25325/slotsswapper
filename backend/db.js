
// backend/db.js
const Database = require('better-sqlite3');
const path = require('path');
const dbPath = process.env.SQLITE_FILE || path.join(__dirname, 'data.sqlite');
const db = new Database(dbPath);
module.exports = db;
