// Hover-card data from the player's own game install: English text (localization/eng/*.json)
// and card portraits, read on demand from SlayTheSpire2.pck. Numbers come from lib/info.json
// (exported from the game's ModelDb by tools/rng-harness `dotnet run -- info`). Nothing taken
// from the game is written to disk.
const fs = require('fs');
const path = require('path');
const { readIndex, readFile } = require('./pck');
const INFO = require('./info.json');

const DEFAULT_PCK = 'C:/Program Files (x86)/Steam/steamapps/common/Slay the Spire 2/SlayTheSpire2.pck';
let pack = null, loc = null, portraits = null;

function openPack() {
  if (pack) return pack;
  const pckPath = process.env.STS2_PCK || DEFAULT_PCK;
  if (!fs.existsSync(pckPath)) throw new Error(`Game pack not found at ${pckPath} (set STS2_PCK)`);
  pack = readIndex(pckPath);
  return pack;
}

function texts() {
  if (loc) return loc;
  const p = openPack();
  loc = {};
  for (const f of ['cards', 'relics', 'potions', 'monsters', 'encounters', 'powers', 'card_keywords', 'enchantments']) {
    const b = readFile(p, `localization/eng/${f}.json`);
    loc[f] = b ? JSON.parse(b.toString('utf8')) : {};
  }
  return loc;
}

// ── Text templates ────────────────────────────────────────────────────────────

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtNum = v => (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2))));

// Renders the game's SmartFormat-style strings: {Var}, {Var:diff()}, {Var:plural:one|many},
// plus [gold]..[/gold]-style colour tags. Values that differ from base (upgrades) are marked.
function render(template, vars = {}, base = vars) {
  let out = esc(template || '');
  out = out.replace(/\{(\w+)(?::([^{}]*))?\}/g, (m, name, fmt) => {
    if (!(name in vars)) return fmt && fmt.startsWith('plural:') ? fmt.slice(7).split('|').pop() : '';
    const v = Number(vars[name]);
    if (fmt && fmt.startsWith('plural:')) {
      const [one, many] = fmt.slice(7).split('|');
      return v === 1 ? one : (many ?? one);
    }
    const changed = base[name] != null && Number(base[name]) !== v;
    return `<span class="v${changed ? ' up' : ''}">${fmtNum(v)}</span>`;
  });
  out = out.replace(/\[(\/?)(\w+)\]/g, (m, close, tag) => {
    if (close) return '</span>';
    return `<span class="t-${tag.toLowerCase()}">`;
  });
  return out.replace(/\n/g, '<br>');
}

// ── Card portraits ────────────────────────────────────────────────────────────

function portraitIndex() {
  if (portraits) return portraits;
  portraits = new Map();
  for (const name of openPack().files.keys()) {
    const m = name.match(/^images\/packed\/card_portraits\/([^/]+)\/([^/]+)\.png\.import$/);
    if (m && !portraits.has(m[2])) portraits.set(m[2], name); // skips beta/ subfolders' duplicates
  }
  return portraits;
}

// Godot CompressedTexture2D (GST2): lossless PNG/WebP payloads can be served as-is.
function ctexImage(buf) {
  if (!buf || buf.toString('latin1', 0, 4) !== 'GST2') return null;
  const dataFormat = buf.readUInt32LE(36); // 1 = PNG, 2 = WebP
  if (dataFormat !== 1 && dataFormat !== 2) return null;
  const size = buf.readUInt32LE(52);
  return { type: dataFormat === 1 ? 'image/png' : 'image/webp', data: buf.subarray(56, 56 + size) };
}

function cardArt(cardId) {
  const entry = String(cardId).replace(/^CARD\./, '').toLowerCase();
  const imp = portraitIndex().get(entry);
  if (!imp) return null;
  const p = openPack();
  const target = (readFile(p, imp).toString().match(/path="res:\/\/([^"]+)"/) || [])[1];
  return target ? ctexImage(readFile(p, target)) : null;
}

// ── Monster skeletons (Spine 4.2) ─────────────────────────────────────────────

const spineCache = new Map();
const resPath = (text, type) => (text.match(new RegExp(`type="${type}"[^\\]]*path="res://([^"]+)"`)) || [])[1];
const importTarget = (p, file) => {
  const imp = readFile(p, `${file}.import`);
  return imp ? (imp.toString().match(/path[.a-z0-9]*="res:\/\/([^"]+)"/) || [])[1] : null;
};

// MonsterModel.VisualsPath: scenes/creature_visuals/<id>.tscn -> skeleton data -> .skel + .atlas.
function monsterSpine(monsterId) {
  if (spineCache.has(monsterId)) return spineCache.get(monsterId);
  const p = openPack();
  let result = null;
  const scene = readFile(p, `scenes/creature_visuals/${entryOf(monsterId).toLowerCase()}.tscn`);
  if (scene) {
    const tscn = scene.toString();
    const dataRes = resPath(tscn, 'SpineSkeletonDataResource');
    const data = dataRes && readFile(p, dataRes)?.toString();
    if (data) {
      const atlasFile = resPath(data, 'SpineAtlasResource');
      const skelFile = resPath(data, 'SpineSkeletonFileResource');
      const atlasJson = readFile(p, importTarget(p, atlasFile));
      const atlas = atlasJson && JSON.parse(atlasJson.toString()).atlas_data;
      if (atlas && skelFile) {
        const dir = atlasFile.slice(0, atlasFile.lastIndexOf('/') + 1);
        // Page names are the atlas lines ending in an image extension, before any region.
        const pages = atlas.split('\n').filter(l => /\.(png|jpg|webp)$/i.test(l.trim())).map(l => l.trim());
        result = {
          skel: importTarget(p, skelFile), atlas, pages: Object.fromEntries(pages.map(pg => [pg, dir + pg])),
          skin: (tscn.match(/preview_skin = "([^"]*)"/) || [])[1] || 'default',
          animation: (tscn.match(/preview_animation = "([^"]*)"/) || [])[1] || null,
        };
      }
    }
  }
  spineCache.set(monsterId, result);
  return result;
}

// Serves the files the Spine web player asks for: skeleton.skel, skeleton.atlas, and pages.
function monsterFile(monsterId, file) {
  const s = monsterSpine(monsterId);
  if (!s) return null;
  const p = openPack();
  if (file === 'skeleton.skel') return { type: 'application/octet-stream', data: readFile(p, s.skel) };
  if (file === 'skeleton.atlas') return { type: 'text/plain', data: Buffer.from(s.atlas) };
  if (s.pages[file]) return ctexImage(readFile(p, importTarget(p, s.pages[file])));
  return null;
}

// ── Info cards ────────────────────────────────────────────────────────────────

const entryOf = id => String(id).replace(/^[A-Z_]+\./, '');

function cardInfo(id, upgraded = false) {
  const t = texts().cards, e = entryOf(id), d = INFO.cards[id] || {};
  const vars = (upgraded && d.upgraded) || d.vars || {};
  return {
    kind: 'card', id, upgraded,
    title: (t[`${e}.title`] || e) + (upgraded ? '+' : ''),
    text: render(t[`${e}.description`], vars, d.vars),
    cost: d.cost, type: d.type, rarity: d.rarity,
    art: portraitIndex().has(e.toLowerCase()) ? `/assets/card/${id}` : null,
  };
}

function relicInfo(id) {
  const t = texts().relics, e = entryOf(id), d = INFO.relics[id] || {};
  return { kind: 'relic', id, title: t[`${e}.title`] || e, text: render(t[`${e}.description`], d.vars || {}), rarity: d.rarity };
}

function potionInfo(id) {
  const t = texts().potions, e = entryOf(id), d = INFO.potions[id] || {};
  return { kind: 'potion', id, title: t[`${e}.title`] || e, text: render(t[`${e}.description`], d.vars || {}), rarity: d.rarity };
}

// A fight: its monsters with base HP ranges and move names.
function encounterInfo(id) {
  const L = texts(), e = entryOf(id), d = INFO.encounters[id] || {};
  const monsters = (d.monsters || []).map(mid => {
    const me = entryOf(mid), m = INFO.monsters[mid] || {};
    const moves = Object.keys(L.monsters).filter(k => k.startsWith(`${me}.moves.`) && k.endsWith('.title')).map(k => L.monsters[k]);
    const spine = monsterSpine(mid);
    return { id: mid, name: L.monsters[`${me}.name`] || me, minHp: m.minHp, maxHp: m.maxHp, moves: [...new Set(moves)],
      spine: spine ? { skin: spine.skin, animation: spine.animation } : null };
  });
  return { kind: 'encounter', id, title: L.encounters[`${e}.title`] || e, roomType: d.roomType, gold: [d.minGold, d.maxGold], monsters };
}

function info(kind, id, opts = {}) {
  switch (kind) {
    case 'card': return cardInfo(id, opts.upgraded);
    case 'relic': return relicInfo(id);
    case 'potion': return potionInfo(id);
    case 'encounter': return encounterInfo(id);
    default: return null;
  }
}

module.exports = { info, cardArt, render, monsterSpine, monsterFile };
