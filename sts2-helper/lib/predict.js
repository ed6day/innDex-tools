// Forecasts built on lib/rng.js. Each function mirrors a specific piece of game
// code (named in its comment) and consumes RNG exactly the way the game does,
// working on clones so the caller's RNG state is never advanced.
const {
  Rng, RunRngSet, PlayerRngSet, RUN_RNG_TYPES, PLAYER_RNG_TYPES, RNG_DESCRIPTIONS,
  snakeCase, xxHash64, parseJsonBigSafe,
} = require('./rng');
const { rewardsReport } = require('./rewards');

// ── Card helpers ──────────────────────────────────────────────────────────────

// Card classes with CardKeyword.Innate, from the decompiled models (v0.113.1).
// BASE = always innate; UPGRADED = gains Innate via AddKeyword in OnUpgrade.
const INNATE_BASE = new Set([
  'APOTHEOSIS', 'ASSASSINATE', 'BACKSTAB', 'BOOT_SEQUENCE', 'DRAMATIC_ENTRANCE', 'FOLLY',
  'MIND_BLAST', 'SKY_SHOT', 'SUPPRESS', 'WRITHE',
]);
const INNATE_UPGRADED = new Set([
  'AFTERIMAGE', 'AGGRESSION', 'ARSENAL', 'BEACON_OF_HOPE', 'BIG_BANG', 'CALL_OF_THE_VOID',
  'ENTROPY', 'HELLO_WORLD', 'INFINITE_BLADES', 'JUGGLING', 'LULLABY', 'MACHINE_LEARNING',
  'MAD_SCIENCE', 'SOULBOUND', 'SPEEDSTER', 'TYRANNY',
]);

function cardEntry(card) {
  return String(card.id || '').replace(/^CARD\./, '');
}
function upgradeLevel(card) {
  return card.current_upgrade_level ?? card.upgradeLevel ?? (card.upgraded ? 1 : 0);
}
function enchantmentId(card) {
  const e = card.enchantment;
  return e ? (typeof e === 'string' ? e : e.id || '') : '';
}
function isInnate(card) {
  const entry = cardEntry(card);
  return INNATE_BASE.has(entry) || (INNATE_UPGRADED.has(entry) && upgradeLevel(card) > 0);
}
function startsAtBottom(card) {
  return /IMBUED/.test(enchantmentId(card)); // Enchantment.ShouldStartAtBottomOfDrawPile
}

// CardModel.CompareTo (used by StableShuffle): ModelId ordinal, then upgrade
// level, then enchantment id. Later tie-breakers (affliction, energy cost,
// replay count, dynamic vars) aren't in the save and rarely differ.
function compareCards(a, b) {
  const ida = String(a.id || ''), idb = String(b.id || '');
  if (ida !== idb) return ida < idb ? -1 : 1;
  const ua = upgradeLevel(a), ub = upgradeLevel(b);
  if (ua !== ub) return ua - ub;
  const ea = enchantmentId(a), eb = enchantmentId(b);
  if (ea !== eb) return ea === '' ? -1 : eb === '' ? 1 : ea < eb ? -1 : 1;
  return 0;
}

// ── Draw-pile shuffles ────────────────────────────────────────────────────────

// Player.PopulateCombatState -> CardPile.RandomizeOrderInternal: deck order,
// UnstableShuffle with run Rng.Shuffle. Then on turn 1 (CombatManager):
// Imbued cards to the bottom, Innate cards to the top, hand = max(5, #innate).
function predictOpeningDraw(shuffleRng, deck, { handSize = 5 } = {}) {
  const rng = shuffleRng.clone();
  const childSeed = rng.clone().nextUnsignedLong();
  let pile = rng.unstableShuffle(deck.slice());
  const bottom = pile.filter(startsAtBottom);
  pile = pile.filter(c => !bottom.includes(c)).concat(bottom);
  const innate = pile.filter(c => isInnate(c) && !bottom.includes(c));
  // MoveToTopInternal in list order => the last innate processed ends up on top.
  for (const c of innate) pile = [c, ...pile.filter(x => x !== c)];
  const draw = Math.min(10, Math.max(handSize, innate.length));
  return {
    childSeed: childSeed.toString(),
    drawOrder: pile,
    hand: pile.slice(0, draw),
    innateCount: innate.length,
    rngAfter: rng,
  };
}

// CardPileCmd.Shuffle: (discard + draw) -> StableShuffle with run Rng.Shuffle.
function predictReshuffle(shuffleRng, cards) {
  const rng = shuffleRng.clone();
  const order = rng.stableShuffle(cards.slice(), compareCards);
  return { drawOrder: order, rngAfter: rng };
}

// Every shuffle (opening or reshuffle) pulls exactly one u64 from the Shuffle
// stream as the child seed, so the k-th upcoming shuffle is fixed in advance.
function upcomingShuffleSeeds(shuffleRng, count = 8) {
  const rng = shuffleRng.clone();
  return Array.from({ length: count }, (_, i) => ({
    index: rng.counter + 1,
    childSeed: rng.nextUnsignedLong().toString(),
  }));
}

// ── "?" rooms ─────────────────────────────────────────────────────────────────

const UNKNOWN_BASE_ODDS = { Monster: 0.1, Elite: -1, Treasure: 0.02, Shop: 0.03 };

function oddsFromSave(saveOdds) {
  const o = saveOdds || {};
  return {
    Monster:  Math.fround(o.unknown_map_point_monster_odds_value  ?? UNKNOWN_BASE_ODDS.Monster),
    Elite:    Math.fround(o.unknown_map_point_elite_odds_value    ?? UNKNOWN_BASE_ODDS.Elite),
    Treasure: Math.fround(o.unknown_map_point_treasure_odds_value ?? UNKNOWN_BASE_ODDS.Treasure),
    Shop:     Math.fround(o.unknown_map_point_shop_odds_value     ?? UNKNOWN_BASE_ODDS.Shop),
  };
}

// UnknownMapPointOdds.Roll — one NextFloat per "?" room. Rolled type resets to
// base odds; every other allowed type's odds grow by its base value.
// Ignores relic hooks (ModifyUnknownMapPointRoomTypes / ModifyOddsIncrease...)
// and the first-ever-run tutorial override.
function rollUnknownRoom(rng, odds, blacklist = []) {
  const allowed = new Set(['Monster', 'Elite', 'Treasure', 'Shop', 'Event'].filter(t => !blacklist.includes(t)));
  let roomType = allowed.has('Event') ? 'Event' : [...allowed][0];
  const roll = rng.nextFloat();
  let acc = 0;
  for (const [type, odd] of Object.entries(odds)) {
    if (!allowed.has(type) || odd < 0) continue;
    acc = Math.fround(acc + odd);
    if (roll <= acc) { roomType = type; break; }
  }
  const before = { ...odds };
  for (const [type, base] of Object.entries(UNKNOWN_BASE_ODDS)) {
    const fbase = Math.fround(base);
    if (type === roomType) odds[type] = fbase;
    else if (allowed.has(type)) odds[type] = Math.fround(odds[type] + fbase);
  }
  return { roll, roomType, oddsBefore: before };
}

function predictUnknownRooms(unknownRng, saveOdds, count = 8) {
  const rng = unknownRng.clone();
  const odds = oddsFromSave(saveOdds);
  return Array.from({ length: count }, (_, i) => {
    const r = rollUnknownRoom(rng, odds);
    const pos = Object.entries(r.oddsBefore).filter(([, v]) => v > 0);
    const chance = Object.fromEntries(pos.map(([k, v]) => [k, v]));
    chance.Event = Math.max(0, 1 - pos.reduce((s, [, v]) => s + v, 0));
    return { n: i + 1, roll: r.roll, roomType: r.roomType, chance };
  });
}

// ── Reports ───────────────────────────────────────────────────────────────────

function streamSummary(name, rng, kind) {
  const peek = rng.clone();
  return {
    name,
    kind,
    key: snakeCase(name),
    description: RNG_DESCRIPTIONS[name] || '',
    counter: rng.counter,
    state: rng.toSerializable(),
    next: Array.from({ length: 5 }, () => peek.nextDouble()),
  };
}

// Everything derivable from the seed string alone (state at run start).
function seedReport(seedString, { slotIndex = 0 } = {}) {
  const run = new RunRngSet(seedString);
  const player = PlayerRngSet.forSeed(seedString, slotIndex);
  return {
    seed: seedString,
    seedHash: run.seed.toString(),
    seedHashHex: '0x' + run.seed.toString(16).padStart(16, '0'),
    streams: [
      ...RUN_RNG_TYPES.map(t => streamSummary(t, run.get(t), 'run')),
      ...PLAYER_RNG_TYPES.map(t => streamSummary(t, player.get(t), 'player')),
    ],
    shuffleSeeds: upcomingShuffleSeeds(run.get('Shuffle'), 8),
    unknownRooms: predictUnknownRooms(run.get('UnknownMapPoint'), null, 10),
  };
}

// Exact forecasts from a current_run.save (raw JSON text or a big-safe parsed object).
function saveReport(save) {
  if (typeof save === 'string') save = parseJsonBigSafe(save);
  if (!save?.rng?.seed) return null;
  const run = RunRngSet.fromSave(save.rng);
  const p = save.players?.[0];
  const player = p?.rng ? PlayerRngSet.fromSave(p.rng) : PlayerRngSet.forSeed(save.rng.seed, 0);
  const deck = (p?.deck || []).map(c => ({ ...c }));
  const opening = deck.length ? predictOpeningDraw(run.get('Shuffle'), deck) : null;
  return {
    seed: save.rng.seed,
    seedHash: run.seed.toString(),
    seedHashHex: '0x' + run.seed.toString(16).padStart(16, '0'),
    streams: [
      ...RUN_RNG_TYPES.map(t => streamSummary(t, run.get(t), 'run')),
      ...PLAYER_RNG_TYPES.map(t => streamSummary(t, player.get(t), 'player')),
    ],
    openingDraw: opening && {
      childSeed: opening.childSeed,
      hand: opening.hand.map(cardView),
      drawOrder: opening.drawOrder.map(cardView),
      innateCount: opening.innateCount,
    },
    shuffleSeeds: upcomingShuffleSeeds(run.get('Shuffle'), 8),
    unknownRooms: predictUnknownRooms(run.get('UnknownMapPoint'), save.odds, 10),
    rewards: safeRewards(save),
  };
}

// Card/potion forecasts need the exported game data; never let them break the RNG report.
function safeRewards(save) {
  try { return rewardsReport(save); } catch (err) { return { error: err.message }; }
}

function cardView(c) {
  const lvl = upgradeLevel(c);
  return {
    id: c.id,
    name: prettyName(cardEntry(c)) + (lvl > 0 ? '+'.repeat(lvl) : ''),
    upgraded: lvl > 0,
    enchantment: enchantmentId(c) || undefined,
    innate: isInnate(c),
  };
}

function prettyName(entry) {
  return entry.split('_').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
}

module.exports = {
  compareCards, isInnate,
  predictOpeningDraw, predictReshuffle, upcomingShuffleSeeds,
  rollUnknownRoom, predictUnknownRooms, oddsFromSave,
  seedReport, saveReport,
  Rng, xxHash64,
};
