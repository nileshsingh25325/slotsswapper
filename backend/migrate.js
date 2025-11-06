
// backend/migrate.js
const db = require('./db');

const users = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;

const events = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'BUSY',
  user_id INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

const swaps = `
CREATE TABLE IF NOT EXISTS swap_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requestor_id INTEGER NOT NULL,
  requestee_id INTEGER NOT NULL,
  my_slot_id INTEGER NOT NULL,
  their_slot_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(requestor_id) REFERENCES users(id),
  FOREIGN KEY(requestee_id) REFERENCES users(id),
  FOREIGN KEY(my_slot_id) REFERENCES events(id),
  FOREIGN KEY(their_slot_id) REFERENCES events(id)
);
`;

db.exec(users);
db.exec(events);
db.exec(swaps);

console.log('Migration applied.');
