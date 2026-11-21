const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { WebSocketServer } = require('ws');
const { parseJsonBigSafe, canonicalizeSeed } = require('./lib/rng');
const { seedReport, saveReport } = require('./lib/predict');
const { buildMap, simulateRoutes, lookahead } = require('./lib/route');
const { generateActMap } = require('./lib/mapgen');

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

// Recover last known state so a server restart doesn't blank the dashboard
let latestState = (() => {
  const row = db.prepare('SELECT event_type, state_json, created_at FROM state_log ORDER BY id DESC LIMIT 1').get();
  if (!row) return null;
  try {
    return { eventType: row.event_type, state: JSON.parse(row.state_json), timestamp: new Date(row.created_at).getTime() };
  } catch { return null; }
})();

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  wss.clients.forEach(c => { if (c.readyState === c.OPEN) c.send(msg); });
}

// Changes on every server start; the dashboard reloads itself when it sees a new one.
const BUILD_ID = String(Date.now());

wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'hello', build: BUILD_ID }));
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

// ── Seed / RNG forecasts ──────────────────────────────────────────────────────

// Everything derivable from a seed string alone (state at run start).
app.get('/api/rng/seed/:seed', (req, res) => {
  const seed = canonicalizeSeed(req.params.seed || '');
  if (!seed || seed.length > 64) return res.status(400).json({ error: 'seed required' });
  res.json(seedReport(seed));
});

// Exact forecasts from the RNG state stored in the current run's save file.
app.get('/api/rng/current', (req, res) => {
  // The game deletes current_run.save when a run ends.
  const report = latestSave && fs.existsSync(latestSavePath) && saveReport(latestSave);
  if (!report) return res.status(404).json({ error: 'No run in progress (no current_run.save found)' });
  res.json(report);
});

// Current act map plus path-independent lookahead (next fights, events, shops).
// The saved_map for an act: the save has the current act's; later acts are generated by
// the game's own map code (lib/mapgen.js).
async function savedMapFor(save, act) {
  return act === (save.current_act_index ?? 0) ? save.acts[act].saved_map : generateActMap(save, act);
}

// ?act=N (default: current act) — that act's map plus fights / events / shops in order.
app.get('/api/map', async (req, res) => {
  if (!latestSave || !fs.existsSync(latestSavePath)) return res.status(404).json({ error: 'No run in progress' });
  const save = latestSave;
  const cur = save.current_act_index ?? 0;
  const act = Math.min(Math.max(parseInt(req.query.act ?? cur, 10) || cur, cur), save.acts.length - 1);
  try {
    res.json({
      seed: save.rng?.seed, currentAct: cur,
      acts: save.acts.map((a, i) => ({ index: i, id: a.id })),
      map: buildMap(save, act, await savedMapFor(save, act)),
      lookahead: lookahead(save, 8, act),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Simulate planned routes: ?routes={"1":["col,row",...],"2":[...]} (per act index).
app.get('/api/route', async (req, res) => {
  if (!latestSave || !fs.existsSync(latestSavePath)) return res.status(404).json({ error: 'No run in progress' });
  const save = latestSave;
  let routes = {};
  try { routes = JSON.parse(req.query.routes || '{}'); } catch { return res.status(400).json({ error: 'bad routes' }); }
  const clean = {};
  for (const [a, path] of Object.entries(routes)) {
    if (/^\d+$/.test(a) && Array.isArray(path)) clean[a] = path.filter(k => /^\d+,\d+$/.test(k));
  }
  try {
    const cur = save.current_act_index ?? 0;
    const maps = {};
    for (const a of Object.keys(clean).map(Number).filter(a => a > cur && a < save.acts.length)) {
      maps[a] = await generateActMap(save, a);
    }
    res.json(simulateRoutes(save, clean, maps));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Save-file watcher ─────────────────────────────────────────────────────────
// Reads STS2's current_run.save on disk — works without enabling mods in-game.

const STS2_SAVE_BASE = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'SlayTheSpire2', 'steam'
);

function _charName(id = '') {
  return id.replace(/^CHARACTER\./i, '').split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function _cardName(id = '') {
  const suffixes = ['_ANCIENT_ARCHITECT', '_IRONCLAD', '_SILENT', '_DEFECT', '_WATCHER'];
  let s = id.replace(/^CARD\./i, '');
  for (const sfx of suffixes) if (s.endsWith(sfx)) { s = s.slice(0, -sfx.length); break; }
  return s.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function _relicName(id = '') {
  return (typeof id === 'string' ? id : id?.id ?? '')
    .replace(/^RELIC\./i, '').split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

// Last parsed current_run.save — RNG forecasts are computed from its saved stream states.
let latestSave = null, latestSavePath = null, latestSaveMtime = 0;

function parseSave(filePath) {
  try {
    // Big-safe: RNG state is stored as u64 JSON numbers that JSON.parse would round.
    const save = parseJsonBigSafe(fs.readFileSync(filePath, 'utf8'));
    // Several profiles can hold a save; the most recently written one is the active run.
    const mtime = fs.statSync(filePath).mtimeMs;
    if (filePath === latestSavePath || mtime >= latestSaveMtime) {
      latestSave = save; latestSavePath = filePath; latestSaveMtime = mtime;
    }
    const player = save.players?.[0];
    if (!player) return null;

    // Current floor from visited map coordinates
    let floorInAct = 0;
    for (const coord of (save.visited_map_coords || [])) {
      const y = Array.isArray(coord) ? coord[1] : (coord?.y ?? 0);
      floorInAct = Math.max(floorInAct, (y ?? 0) + 1);
    }
    const ACT_OFFSETS = [0, 17, 34];
    const actIdx = save.current_act_index ?? 0;
    const floorNumber = (ACT_OFFSETS[actIdx] ?? actIdx * 17) + floorInAct;

    const deck = (player.deck || []).map(c => ({
      id:       c.id || '',
      name:     _cardName(c.id || ''),
      type:     '',
      cost:     0,
      damage:   0,
      block:    0,
      upgraded: false,
    }));

    const relics = (player.relics || []).map(r => _relicName(r?.id ?? r));

    return {
      eventType: 'save_file',
      state: {
        source:      'save_file',
        seed:        save.rng?.seed ?? '',
        character:   _charName(player.character_id),
        playerHp:    player.current_hp    ?? 0,
        playerMaxHp: player.max_hp        ?? 0,
        floorNumber,
        energy:      player.max_energy    ?? 3,
        maxEnergy:   player.max_energy    ?? 3,
        block:       0,
        turnNumber:  0,
        gold:        player.gold          ?? 0,
        ascension:   save.ascension       ?? 0,
        hand:        [],
        drawPile:    deck,
        discardPile: [],
        exhaustPile: [],
        enemies:     [],
        relics,
        powers:      {},
      },
      timestamp: Date.now(),
    };
  } catch { return null; }
}

function watchSaveDir(dir) {
  if (!fs.existsSync(dir)) return false;
  const saveFile = path.join(dir, 'current_run.save');

  // Seed on startup from any existing save
  // (always parse, so RNG forecasts work even when latestState came from the DB)
  if (fs.existsSync(saveFile)) {
    const parsed = parseSave(saveFile);
    if (parsed && !latestState) { latestState = parsed; console.log('[save] Seeded from', saveFile); }
  }

  let debounce;
  fs.watch(dir, (event, filename) => {
    if (filename !== 'current_run.save') return;
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (!fs.existsSync(saveFile)) return;
      const parsed = parseSave(saveFile);
      if (!parsed) return;
      latestState = parsed;
      broadcast(parsed);
      console.log('[save] Updated:', saveFile);
    }, 300);
  });
  return true;
}

function initSaveWatcher() {
  if (!fs.existsSync(STS2_SAVE_BASE)) {
    console.log('[save] STS2 save dir not found — save-file watcher disabled');
    return;
  }
  let count = 0;
  for (const steamId of fs.readdirSync(STS2_SAVE_BASE)) {
    const base = path.join(STS2_SAVE_BASE, steamId);
    for (const profile of ['profile1', 'profile2', 'profile3']) {
      if (watchSaveDir(path.join(base, profile, 'saves'))) count++;
      if (watchSaveDir(path.join(base, 'modded', profile, 'saves'))) count++;
    }
  }
  console.log(`[save] Watching ${count} save director${count === 1 ? 'y' : 'ies'}`);
}

initSaveWatcher();

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
