const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { WebSocketServer } = require('ws');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Database ──────────────────────────────────────────────────────────────────

const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(path.join(dbDir, 'sts2.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS state_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    state_json TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS combats (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    combat_id    TEXT NOT NULL UNIQUE,
    character    TEXT,
    floor_number INTEGER,
    enemy_set    TEXT,
    start_hp     INTEGER,
    end_hp       INTEGER,
    hp_delta     INTEGER,
    outcome      TEXT,
    turns_taken  INTEGER,
    started_at   TEXT DEFAULT (datetime('now')),
    ended_at     TEXT
  );

  CREATE TABLE IF NOT EXISTS turns (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    combat_id        TEXT NOT NULL REFERENCES combats(combat_id),
    turn_number      INTEGER NOT NULL,
    energy_available INTEGER,
    energy_used      INTEGER,
    cards_played     TEXT,
    block_gained     INTEGER,
    damage_dealt     INTEGER,
    damage_taken     INTEGER,
    created_at       TEXT DEFAULT (datetime('now')),
    UNIQUE(combat_id, turn_number)
  );

  CREATE TABLE IF NOT EXISTS runs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id          TEXT NOT NULL UNIQUE,
    character       TEXT,
    score           INTEGER,
    floor_reached   INTEGER,
    ascension_level INTEGER,
    outcome         TEXT,
    cause_of_death  TEXT,
    relics          TEXT,
    started_at      TEXT,
    ended_at        TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS run_decks (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id           TEXT NOT NULL REFERENCES runs(run_id),
    floor            INTEGER NOT NULL,
    snapshot_trigger TEXT,
    deck_json        TEXT NOT NULL,
    created_at       TEXT DEFAULT (datetime('now')),
    UNIQUE(run_id, floor, snapshot_trigger)
  );
`);

// ── WebSocket ─────────────────────────────────────────────────────────────────

const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

let latestState = null;

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  wss.clients.forEach(c => { if (c.readyState === c.OPEN) c.send(msg); });
}

wss.on('connection', ws => {
  if (latestState) ws.send(JSON.stringify(latestState));
  ws.on('error', err => console.error('[WS]', err.message));
});

// ── Live state ────────────────────────────────────────────────────────────────

app.post('/api/state', (req, res) => {
  const { eventType, state } = req.body;
  if (!eventType || !state) return res.status(400).json({ error: 'eventType and state required' });

  const payload = { eventType, state, timestamp: Date.now() };
  latestState = payload;

  try {
    db.prepare('INSERT INTO state_log (event_type, state_json) VALUES (?, ?)')
      .run(eventType, JSON.stringify(state));
  } catch (err) {
    console.error('[state log]', err.message);
  }

  broadcast(payload);
  res.json({ ok: true });
});

app.get('/api/state/latest', (req, res) => {
  if (!latestState) return res.status(404).json({ error: 'No state yet' });
  res.json(latestState);
});

app.get('/api/state/log', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  res.json(db.prepare('SELECT * FROM state_log ORDER BY id DESC LIMIT ?').all(limit));
});

// ── Combat ────────────────────────────────────────────────────────────────────

app.post('/api/combat/start', (req, res) => {
  const { combatId, character, floorNumber, enemySet, startHp } = req.body;
  if (!combatId) return res.status(400).json({ error: 'combatId required' });
  try {
    db.prepare('INSERT OR IGNORE INTO combats (combat_id, character, floor_number, enemy_set, start_hp) VALUES (?, ?, ?, ?, ?)')
      .run(combatId, character, floorNumber, JSON.stringify(enemySet || []), startHp);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/combat/end', (req, res) => {
  const { combatId, endHp, outcome } = req.body;
  if (!combatId) return res.status(400).json({ error: 'combatId required' });
  try {
    const n      = db.prepare('SELECT COUNT(*) as n FROM turns WHERE combat_id = ?').get(combatId).n;
    const start  = db.prepare('SELECT start_hp FROM combats WHERE combat_id = ?').get(combatId);
    db.prepare(`UPDATE combats SET end_hp=?, hp_delta=?, outcome=?, turns_taken=?, ended_at=datetime('now') WHERE combat_id=?`)
      .run(endHp, start ? endHp - start.start_hp : null, outcome, n, combatId);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/turn', (req, res) => {
  const { combatId, turnNumber, energyAvailable, energyUsed, cardsPlayed, blockGained, damageDealt, damageTaken } = req.body;
  if (!combatId || turnNumber == null) return res.status(400).json({ error: 'combatId and turnNumber required' });
  try {
    db.prepare(`INSERT INTO turns (combat_id, turn_number, energy_available, energy_used, cards_played, block_gained, damage_dealt, damage_taken)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(combat_id, turn_number) DO UPDATE SET
                  energy_available=excluded.energy_available, energy_used=excluded.energy_used,
                  cards_played=excluded.cards_played, block_gained=excluded.block_gained,
                  damage_dealt=excluded.damage_dealt, damage_taken=excluded.damage_taken`)
      .run(combatId, turnNumber, energyAvailable, energyUsed, JSON.stringify(cardsPlayed || []), blockGained, damageDealt, damageTaken);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/combat/:combatId/turns', (req, res) => {
  res.json(db.prepare('SELECT * FROM turns WHERE combat_id = ? ORDER BY turn_number ASC').all(req.params.combatId));
});

app.get('/api/combats', (req, res) => {
  const page     = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
  const offset   = (page - 1) * pageSize;
  let where = 'WHERE 1=1'; const params = [];
  if (req.query.outcome) { where += ' AND outcome = ?'; params.push(req.query.outcome); }
  const total = db.prepare(`SELECT COUNT(*) as n FROM combats ${where}`).get(...params).n;
  const rows  = db.prepare(`SELECT * FROM combats ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset);
  res.json({ total, page, pageSize, rows });
});

// ── Runs ──────────────────────────────────────────────────────────────────────

app.post('/api/run/start', (req, res) => {
  const { runId, character, ascensionLevel } = req.body;
  if (!runId) return res.status(400).json({ error: 'runId required' });
  try {
    db.prepare(`INSERT OR IGNORE INTO runs (run_id, character, ascension_level, started_at) VALUES (?, ?, ?, datetime('now'))`)
      .run(runId, character, ascensionLevel);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/run/end', (req, res) => {
  const { runId, outcome, score, floorReached, causeOfDeath, relics } = req.body;
  if (!runId) return res.status(400).json({ error: 'runId required' });
  try {
    db.prepare(`UPDATE runs SET outcome=?, score=?, floor_reached=?, cause_of_death=?, relics=?, ended_at=datetime('now') WHERE run_id=?`)
      .run(outcome, score, floorReached, causeOfDeath, JSON.stringify(relics || []), runId);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/run/deck-snapshot', (req, res) => {
  const { runId, floor, snapshotTrigger, deck } = req.body;
  if (!runId || floor == null) return res.status(400).json({ error: 'runId and floor required' });
  try {
    db.prepare('INSERT OR REPLACE INTO run_decks (run_id, floor, snapshot_trigger, deck_json) VALUES (?, ?, ?, ?)')
      .run(runId, floor, snapshotTrigger, JSON.stringify(deck || []));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/runs', (req, res) => {
  const page     = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
  const offset   = (page - 1) * pageSize;
  let where = 'WHERE 1=1'; const params = [];
  if (req.query.character) { where += ' AND character = ?';       params.push(req.query.character); }
  if (req.query.outcome)   { where += ' AND outcome = ?';          params.push(req.query.outcome); }
  if (req.query.ascension) { where += ' AND ascension_level = ?';  params.push(parseInt(req.query.ascension)); }
  const total = db.prepare(`SELECT COUNT(*) as n FROM runs ${where}`).get(...params).n;
  const rows  = db.prepare(`SELECT * FROM runs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset);
  res.json({ total, page, pageSize, rows });
});

app.get('/api/runs/:runId', (req, res) => {
  const run = db.prepare('SELECT * FROM runs WHERE run_id = ?').get(req.params.runId);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  const decks   = db.prepare('SELECT * FROM run_decks WHERE run_id = ? ORDER BY floor ASC').all(req.params.runId);
  const combats = db.prepare('SELECT * FROM combats WHERE combat_id LIKE ? ORDER BY id ASC').all(`${req.params.runId}%`);
  res.json({ run, decks, combats });
});

// ── Start ─────────────────────────────────────────────────────────────────────

server.listen(PORT, '0.0.0.0', () => {
  const { networkInterfaces } = require('os');
  const ips = Object.values(networkInterfaces()).flat()
    .filter(n => n.family === 'IPv4' && !n.internal)
    .map(n => n.address);
  console.log(`\n  STS2 Helper running on port ${PORT}`);
  console.log(`  Local:     http://localhost:${PORT}`);
  ips.forEach(ip => console.log(`  Network:   http://${ip}:${PORT}`));
  console.log('');
});
