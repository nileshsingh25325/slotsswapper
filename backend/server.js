const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("./db"); // Your SQLite connection and setup

const app = express();
app.use(cors());
app.use(bodyParser.json());

const JWTSECRET = process.env.JWTSECRET || "supersecretjwtkey";

// ----------------- Middleware -----------------
function authMiddleware(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ message: "Missing authorization header" });
  const parts = h.split(" ");
  if (parts.length !== 2) return res.status(401).json({ message: "Invalid auth header" });
  const token = parts[1];
  try {
    const payload = jwt.verify(token, JWTSECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ message: "Invalid token" });
  }
}

// ----------------- Auth Routes -----------------
app.post("/api/auth/signup", async (req, res) => {
  let { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ message: "name,email,password required" });
  email = email.toLowerCase();
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing)
    return res.status(400).json({ message: "Email already registered" });
  const hash = await bcrypt.hash(password, 10);
  const info = db.prepare("INSERT INTO users (name,email,password_hash) VALUES (?,?,?)")
    .run(name, email, hash);
  const user = { id: info.lastInsertRowid, name, email };
  const token = jwt.sign(user, JWTSECRET);
  res.json({ message: "Registration successful", token, user });
});

app.post("/api/auth/login", async (req, res) => {
  let { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ message: "email,password required" });
  email = email.toLowerCase();
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!row)
    return res.status(400).json({ message: "Email not registered" });

  if (!row.password_hash)
    return res.status(400).json({ message: "Invalid credentials" });

  try {
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) return res.status(400).json({ message: "Incorrect password" });
  } catch (error) {
    console.error("Error during bcrypt compare", error);
    return res.status(500).json({ message: "Server error" });
  }

  const user = { id: row.id, name: row.name, email: row.email };
  const token = jwt.sign(user, JWTSECRET);
  res.json({ message: "Login successful", token, user });
});

// ----------------- Event Routes -----------------
app.get("/api/events/me", authMiddleware, (req, res) => {
  const rows = db.prepare(
    "SELECT id,title,start_time,end_time,status,user_id FROM events WHERE user_id = ? ORDER BY start_time"
  ).all(req.user.id);
  res.json(rows);
});

app.post("/api/events", authMiddleware, (req, res) => {
  const { title, start_time, end_time } = req.body;
  if (!title || !start_time || !end_time)
    return res.status(400).json({ message: "title,start_time,end_time required" });
  if (new Date(start_time) < new Date())
    return res.status(400).json({ message: "Cannot book past slots" });
  const info = db.prepare(
    "INSERT INTO events (title, start_time, end_time, status, user_id) VALUES (?,?,?,?,?)"
  ).run(title, start_time, end_time, "BUSY", req.user.id);
  const ev = db.prepare("SELECT id,title,start_time,end_time,status,user_id FROM events WHERE id = ?").get(info.lastInsertRowid);
  res.json(ev);
});

app.patch("/api/events/:id", authMiddleware, (req, res) => {
  const id = req.params.id;
  const ev = db.prepare("SELECT * FROM events WHERE id = ?").get(id);
  if (!ev) return res.status(404).json({ message: "Event not found" });
  if (ev.user_id !== req.user.id) return res.status(403).json({ message: "Not allowed" });
  const newStatus = req.body.status;
  db.prepare("UPDATE events SET status = ? WHERE id = ?").run(newStatus, id);
  const updated = db.prepare("SELECT id,title,start_time,end_time,status,user_id FROM events WHERE id = ?").get(id);
  res.json(updated);
});

// NEW ENDPOINT to make a slot SWAPPABLE
app.patch("/api/events/:id/make-swappable", authMiddleware, (req, res) => {
  const id = req.params.id;
  const ev = db.prepare("SELECT * FROM events WHERE id = ?").get(id);
  if (!ev) return res.status(404).json({ message: "Slot not found" });
  if (ev.user_id !== req.user.id) return res.status(403).json({ message: "Not allowed to make this slot swappable" });

  db.prepare("UPDATE events SET status = ? WHERE id = ?").run("SWAPPABLE", id);
  const updated = db.prepare("SELECT * FROM events WHERE id = ?").get(id);
  res.json(updated);
});

// ----------------- Swappable Slots Marketplace -----------------
app.get("/api/swappable-slots", authMiddleware, (req, res) => {
  const rows = db.prepare(
    "SELECT id,title,start_time,end_time,status,user_id FROM events WHERE status = ? AND user_id != ? ORDER BY start_time"
  ).all("SWAPPABLE", req.user.id);
  res.json(rows);
});

// ----------------- Swap Requests -----------------
app.post("/api/swap-request", authMiddleware, (req, res) => {
  const { mySlotId, theirSlotId } = req.body;
  if (!mySlotId || !theirSlotId)
    return res.status(400).json({ message: "mySlotId and theirSlotId required" });
  const my = db.prepare("SELECT * FROM events WHERE id = ?").get(mySlotId);
  const their = db.prepare("SELECT * FROM events WHERE id = ?").get(theirSlotId);
  if (!my || !their)
    return res.status(400).json({ message: "Slots not found" });
  if (my.user_id !== req.user.id)
    return res.status(400).json({ message: "mySlot must belong to you" });
  if (my.status !== "SWAPPABLE" || their.status !== "SWAPPABLE")
    return res.status(400).json({ message: "Both slots must be SWAPPABLE" });
  if (their.user_id === req.user.id)
    return res.status(400).json({ message: "Cannot request your own slot" });
  const insert = db.prepare(
    "INSERT INTO swap_requests (requestor_id,requestee_id,my_slot_id,their_slot_id,status) VALUES (?,?,?,?,?)"
  ).run(req.user.id, their.user_id, mySlotId, theirSlotId, "PENDING");
  db.prepare("UPDATE events SET status = ? WHERE id IN (?,?)").run("SWAPPENDING", mySlotId, theirSlotId);
  const sr = db.prepare("SELECT * FROM swap_requests WHERE id = ?").get(insert.lastInsertRowid);
  res.json(sr);
});

app.get("/api/swaps/me", authMiddleware, (req, res) => {
  // Incoming and outgoing requests, join with user and event for more detail
  const incoming = db.prepare(`
    SELECT sr.*, u.name as requestorname, me.title as myslottitle, their.title as theirslottitle
    FROM swap_requests sr
    JOIN users u ON u.id = sr.requestor_id
    JOIN events me ON me.id = sr.my_slot_id
    JOIN events their ON their.id = sr.their_slot_id
    WHERE sr.requestee_id = ?
    ORDER BY sr.created_at DESC`).all(req.user.id);

  const outgoing = db.prepare(`
    SELECT sr.*, u.name as requesteename, me.title as myslottitle, their.title as theirslottitle
    FROM swap_requests sr
    JOIN users u ON u.id = sr.requestee_id
    JOIN events me ON me.id = sr.my_slot_id
    JOIN events their ON their.id = sr.their_slot_id
    WHERE sr.requestor_id = ?
    ORDER BY sr.created_at DESC`).all(req.user.id);

  res.json({ incoming, outgoing });
});

app.post("/api/swap-response/:id", authMiddleware, (req, res) => {
  const id = req.params.id;
  const { accept } = req.body; // accept = true/false
  const sr = db.prepare("SELECT * FROM swap_requests WHERE id = ?").get(id);
  if (!sr) return res.status(404).json({ message: "SwapRequest not found" });
  if (sr.requestee_id !== req.user.id)
    return res.status(403).json({ message: "Not allowed" });
  if (sr.status !== "PENDING")
    return res.status(400).json({ message: "Request not pending" });

  if (accept) {
    const tx = db.transaction(() => {
      db.prepare("UPDATE swap_requests SET status = ? WHERE id = ?").run("ACCEPTED", id);
      const my = db.prepare("SELECT * FROM events WHERE id = ?").get(sr.my_slot_id);
      const their = db.prepare("SELECT * FROM events WHERE id = ?").get(sr.their_slot_id);
      db.prepare("UPDATE events SET user_id = ?, status = ? WHERE id = ?").run(their.user_id, "BUSY", my.id);
      db.prepare("UPDATE events SET user_id = ?, status = ? WHERE id = ?").run(my.user_id, "BUSY", their.id);
    });
    try {
      tx();
      return res.json({ message: "Swap accepted and executed" });
    } catch (e) {
      return res.status(500).json({ message: "Failed to complete swap", error: e.message });
    }
  } else {
    db.prepare("UPDATE swap_requests SET status = ? WHERE id = ?").run("REJECTED", id);
    db.prepare("UPDATE events SET status = ? WHERE id IN (?,?)").run("SWAPPABLE", sr.my_slot_id, sr.their_slot_id);
    return res.json({ message: "Swap rejected and slots restored" });
  }
});

// ----------------- Start Server -----------------
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log("Server listening on", PORT);
});
