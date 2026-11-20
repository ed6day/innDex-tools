// Bit-exact port of Slay the Spire 2's seeded RNG (MegaCrit.Sts2.Core.Random).
//
// Pipeline, as decompiled from sts2.dll (v0.113.1):
//   seed string ("0K789M7XN0")  --XxHash64(utf8, seed 0)-->  run seed (u64)
//   each RunRngType stream:      new Rng(runSeed + XxHash64(snake_case(name)))
//   each PlayerRngType stream:   new Rng(playerSeed + XxHash64(snake_case(name)))
//                                where playerSeed = XxHash64(seedString) + playerSlotIndex
//   Rng(u64)                     --SplitMix64 x4-->  xoshiro256** state (s0..s3)
//
// All 64-bit math uses BigInt; doubles are produced exactly as .NET does, so
// NextInt / NextFloat results match the game bit-for-bit.

const MASK64 = (1n << 64n) - 1n;
const u64 = x => x & MASK64;
const rotl = (x, k) => u64((x << BigInt(k)) | (x >> BigInt(64 - k)));

// ── XxHash64 (System.IO.Hashing.XxHash64.HashToUInt64, seed 0) ────────────────

const P1 = 0x9E3779B185EBCA87n;
const P2 = 0xC2B2AE3D27D4EB4Fn;
const P3 = 0x165667B19E3779F9n;
const P4 = 0x85EBCA77C2B2AE63n;
const P5 = 0x27D4EB2F165667C5n;

function readU64(b, i) {
  let v = 0n;
  for (let k = 7; k >= 0; k--) v = (v << 8n) | BigInt(b[i + k]);
  return v;
}
function readU32(b, i) {
  return BigInt((b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0);
}
const xxRound = (acc, lane) => u64(rotl(u64(acc + u64(lane * P2)), 31) * P1);
const xxMerge = (h, v) => u64(u64(h ^ xxRound(0n, v)) * P1 + P4);

function xxHash64(input, seed = 0n) {
  const b = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  const len = b.length;
  let i = 0;
  let h;
  if (len >= 32) {
    let v1 = u64(seed + P1 + P2), v2 = u64(seed + P2), v3 = seed, v4 = u64(seed - P1);
    for (; i + 32 <= len; i += 32) {
      v1 = xxRound(v1, readU64(b, i));
      v2 = xxRound(v2, readU64(b, i + 8));
      v3 = xxRound(v3, readU64(b, i + 16));
      v4 = xxRound(v4, readU64(b, i + 24));
    }
    h = u64(rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18));
    h = xxMerge(xxMerge(xxMerge(xxMerge(h, v1), v2), v3), v4);
  } else {
    h = u64(seed + P5);
  }
  h = u64(h + BigInt(len));
  for (; i + 8 <= len; i += 8) {
    h ^= xxRound(0n, readU64(b, i));
    h = u64(rotl(h, 27) * P1 + P4);
  }
  if (i + 4 <= len) {
    h ^= u64(readU32(b, i) * P1);
    h = u64(rotl(h, 23) * P2 + P3);
    i += 4;
  }
  for (; i < len; i++) {
    h ^= u64(BigInt(b[i]) * P5);
    h = u64(rotl(h, 11) * P1);
  }
  h ^= h >> 33n; h = u64(h * P2);
  h ^= h >> 29n; h = u64(h * P3);
  h ^= h >> 32n;
  return h;
}

// ── String helpers (StringHelper / SeedHelper) ────────────────────────────────

// StringHelper.SnakeCase: Regex "([A-Za-z0-9]|\G(?!^))([A-Z])" -> "$1_$2", lower-cased.
function snakeCase(txt) {
  return txt.trim().replace(/([A-Za-z0-9])(?=[A-Z])/g, '$1_').toLowerCase();
}

// SeedHelper.CanonicalizeSeed: what the game does to a typed-in seed.
function canonicalizeSeed(seed) {
  return seed.toUpperCase().replace(/O/g, '0').replace(/I/g, '1').trim();
}

const SEED_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

// ── MegaRandom: xoshiro256** seeded by SplitMix64 ────────────────────────────

function splitmix64(state) {
  state.x = u64(state.x + 0x9E3779B97F4A7C15n);
  let z = state.x;
  z = u64((z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n);
  z = u64((z ^ (z >> 27n)) * 0x94D049BB133111EBn);
  return z ^ (z >> 31n);
}

class MegaRandom {
  constructor(seed = 0n) {
    const st = { x: u64(BigInt(seed)) };
    this.s0 = splitmix64(st);
    this.s1 = splitmix64(st);
    this.s2 = splitmix64(st);
    this.s3 = splitmix64(st);
  }

  static fromState(s0, s1, s2, s3) {
    const r = Object.create(MegaRandom.prototype);
    Object.assign(r, { s0: BigInt(s0), s1: BigInt(s1), s2: BigInt(s2), s3: BigInt(s3) });
    return r;
  }

  nextULong() {
    let { s0, s1, s2, s3 } = this;
    const result = u64(rotl(u64(s1 * 5n), 7) * 9n);
    const t = u64(s1 << 17n);
    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 ^= t;
    s3 = rotl(s3, 45);
    Object.assign(this, { s0, s1, s2, s3 });
    return result;
  }

  // (ulong >> 11) * 2^-53 — exact in an IEEE double, same as .NET.
  nextDouble() {
    return Number(this.nextULong() >> 11n) * 1.1102230246251565e-16;
  }

  // NextInner(int): (int)(NextDouble() * maxValue)
  next(maxValue) {
    if (maxValue < 1) throw new RangeError('maxValue must be > 0');
    return Math.trunc(this.nextDouble() * maxValue);
  }

  nextRange(minValue, maxValue) {
    if (minValue >= maxValue) throw new RangeError('maxValue must be > minValue');
    return Math.trunc(this.nextDouble() * (maxValue - minValue)) + minValue;
  }
}

// ── Rng: the game-facing wrapper with a call counter ─────────────────────────

class Rng {
  constructor(seed = 0n) {
    this.seed = u64(BigInt(seed));
    this.counter = 0;
    this.random = new MegaRandom(this.seed);
  }

  // Rng(ulong seed, string name) => seed + hash(name)
  static named(seed, name) {
    return new Rng(u64(BigInt(seed) + xxHash64(name)));
  }

  // From a save-file SerializableRng block: { counter, s0, s1, s2, s3 }
  static fromSerializable(s) {
    const r = Object.create(Rng.prototype);
    r.seed = null;
    r.counter = s.counter ?? 0;
    r.random = MegaRandom.fromState(s.s0, s.s1, s.s2, s.s3);
    return r;
  }

  clone() {
    const r = Object.create(Rng.prototype);
    r.seed = this.seed;
    r.counter = this.counter;
    const { s0, s1, s2, s3 } = this.random;
    r.random = MegaRandom.fromState(s0, s1, s2, s3);
    return r;
  }

  toSerializable() {
    const { s0, s1, s2, s3 } = this.random;
    return { counter: this.counter, s0: s0.toString(), s1: s1.toString(), s2: s2.toString(), s3: s3.toString() };
  }

  nextBool() { this.counter++; return this.random.next(2) === 0; }

  // NextInt(max) and NextInt(min, max)
  nextInt(a = 0x7fffffff, b) {
    if (b === undefined) { this.counter++; return this.random.next(a); }
    if (a >= b) throw new RangeError('Minimum must be lower than maximum.');
    this.counter++;
    return this.random.nextRange(a, b);
  }

  nextUnsignedLong() { this.counter++; return this.random.nextULong(); }

  nextDouble(min, max) {
    this.counter++;
    const d = this.random.nextDouble();
    return min === undefined ? d : d * (max - min) + min;
  }

  // NextFloat(max) / NextFloat(min, max): (float)(NextDouble() * (max-min) + min)
  nextFloat(a = 1, b) {
    const [min, max] = b === undefined ? [0, a] : [a, b];
    this.counter++;
    // (max - min) is float arithmetic in C# before widening to double.
    return Math.fround(this.random.nextDouble() * Math.fround(Math.fround(max) - Math.fround(min)) + Math.fround(min));
  }

  nextItem(items) {
    const arr = Array.from(items);
    if (arr.length === 0) return undefined;
    return arr[this.nextInt(0, arr.length)];
  }

  // Rng.WeightedNextItem — float accumulation, like the game.
  weightedNextItem(items, weightOf) {
    const r = this.nextFloat();
    let total = 0;
    for (const it of items) total = Math.fround(total + Math.fround(weightOf(it)));
    let acc = Math.fround(r * total);
    for (const it of items) {
      acc = Math.fround(acc - Math.fround(weightOf(it)));
      if (acc <= 0) return it;
    }
    return undefined;
  }

  // ListExtensions.UnstableShuffle: consumes ONE value from this rng (a child seed),
  // then Fisher–Yates from the back using the child rng. Shuffles `list` in place.
  unstableShuffle(list) {
    const child = new Rng(this.nextUnsignedLong());
    for (let n = list.length - 1; n > 0; n--) {
      const j = child.nextInt(n + 1);
      const tmp = list[n]; list[n] = list[j]; list[j] = tmp;
    }
    return list;
  }

  // ListExtensions.StableShuffle: sort first (so input order doesn't matter), then shuffle.
  stableShuffle(list, compare) {
    list.sort(compare);
    return this.unstableShuffle(list);
  }
}

// ── Rng sets ──────────────────────────────────────────────────────────────────

// Order matters only for display; names are hashed via snake_case(enum name).
const RUN_RNG_TYPES = [
  'UpFront', 'Shuffle', 'UnknownMapPoint', 'CombatCardGeneration', 'CombatPotionGeneration',
  'CombatCardSelection', 'CombatEnergyCosts', 'CombatTargets', 'MonsterAi', 'Niche',
  'CombatOrbs', 'TreasureRoomRelics',
];
const PLAYER_RNG_TYPES = ['Rewards', 'Shops', 'Transformations', 'NonCombatGeneration'];

const RNG_DESCRIPTIONS = {
  UpFront:                'Generated at run start: monsters you will fight, events, relic offers',
  Shuffle:                'Draw-pile shuffles (combat start + every reshuffle), random-position card inserts',
  UnknownMapPoint:        'What a "?" room turns into',
  CombatCardGeneration:   'Cards created in combat (e.g. Attack Potion)',
  CombatPotionGeneration: 'Potions created in combat (e.g. Alchemize)',
  CombatCardSelection:    'Random card picks in combat (e.g. True Grit)',
  CombatEnergyCosts:      'Random energy costs (Confusion, Snecko Eye)',
  CombatTargets:          'Random targeting (Bouncing Flask, Sword Boomerang)',
  MonsterAi:              'Random monster move choices',
  Niche:                  'One-off modifiers (e.g. Cursed Run)',
  CombatOrbs:             'Random orbs (e.g. Chaos)',
  TreasureRoomRelics:     'Multiplayer treasure tie-breaks',
  Rewards:                'Card / potion rewards and whether a potion drops',
  Shops:                  'Shop inventory',
  Transformations:        'What a transformed card becomes',
  NonCombatGeneration:    'Out-of-combat card/potion generation',
};

// Accepts "shuffle" (save format), "Shuffle", or a numeric enum index.
function rngTypeFromKey(types, key) {
  if (/^\d+$/.test(key)) return types[+key];
  return types.find(t => t === key || snakeCase(t) === key);
}

function hashSeed(seedString) {
  if (seedString.startsWith('old')) {
    // Legacy seeds: StringHelper.GetDeterministicHashCodeOld, cast (uint).
    const s = seedString.slice(3);
    let a = 352654597 | 0, b = a;
    for (let i = 0; i < s.length; i += 2) {
      a = (Math.imul(a, 33) ^ s.charCodeAt(i)) | 0;
      if (i === s.length - 1) break;
      b = (Math.imul(b, 33) ^ s.charCodeAt(i + 1)) | 0;
    }
    return BigInt((a + Math.imul(b, 1566083941)) >>> 0);
  }
  return xxHash64(seedString);
}

class RunRngSet {
  constructor(seedString) {
    this.stringSeed = seedString;
    this.seed = hashSeed(seedString);
    this.rngs = {};
    for (const t of RUN_RNG_TYPES) this.rngs[t] = Rng.named(this.seed, snakeCase(t));
  }

  // save.rng = { seed: "...", rngs: { "shuffle": {counter,s0..s3}, ... } }
  // (keys are snake_case via SnakeCaseJsonStringEnumConverter)
  static fromSave(saveRng) {
    const set = new RunRngSet(saveRng.seed);
    for (const [k, v] of Object.entries(saveRng.rngs || {})) {
      const key = rngTypeFromKey(RUN_RNG_TYPES, k);
      if (key) set.rngs[key] = Rng.fromSerializable(v);
    }
    return set;
  }

  get(type) { return this.rngs[type]; }
}

class PlayerRngSet {
  constructor(seed) {
    this.seed = u64(BigInt(seed));
    this.rngs = {};
    for (const t of PLAYER_RNG_TYPES) this.rngs[t] = Rng.named(this.seed, snakeCase(t));
  }

  // Player.cs: new PlayerRngSet(GetDeterministicHashCode(seed) + slotIndex).
  // Always XxHash64 of the raw string — legacy "old" seeds are NOT special-cased here.
  static forSeed(seedString, slotIndex = 0) {
    return new PlayerRngSet(u64(xxHash64(seedString) + BigInt(slotIndex)));
  }

  static fromSave(savePlayerRng) {
    const set = new PlayerRngSet(BigInt(savePlayerRng.seed));
    for (const [k, v] of Object.entries(savePlayerRng.rngs || {})) {
      const key = rngTypeFromKey(PLAYER_RNG_TYPES, k);
      if (key) set.rngs[key] = Rng.fromSerializable(v);
    }
    return set;
  }

  get(type) { return this.rngs[type]; }
}

// ── Save-file parsing ─────────────────────────────────────────────────────────

// The save stores u64 RNG state as bare JSON numbers > 2^53, which JSON.parse
// silently rounds. Quote every long integer before parsing so we keep them exact.
function parseJsonBigSafe(text) {
  return JSON.parse(text.replace(/([:\[,]\s*)(-?\d{16,})(?=\s*[,\]}])/g, '$1"$2"'));
}

module.exports = {
  xxHash64, snakeCase, canonicalizeSeed, hashSeed, SEED_ALPHABET,
  MegaRandom, Rng, RunRngSet, PlayerRngSet,
  RUN_RNG_TYPES, PLAYER_RNG_TYPES, RNG_DESCRIPTIONS,
  parseJsonBigSafe,
};
