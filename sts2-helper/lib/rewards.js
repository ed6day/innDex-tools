// Card / potion generation and Neow, ported from the game (v0.113.1):
// CardFactory.CreateForReward, CardRarityOdds, PotionFactory, Neow.GenerateInitialOptions.
// Pool order, rarities and unlock epochs come from lib/gamedata.json, exported from
// the game's own ModelDb by tools/rng-harness (`dotnet run -- data`).
const { Rng, RunRngSet, PlayerRngSet, xxHash64, parseJsonBigSafe } = require('./rng');
const DATA = require('./gamedata.json');

const MASK64 = (1n << 64n) - 1n;

// AscensionLevel.Scarcity = 7; GetValueIfAscension(level, a, b) => ascension >= level ? a : b
const SCARCITY = 7;
const scarce = (ctx, a, b) => (ctx.ascension >= SCARCITY ? a : b);

// ── Context ───────────────────────────────────────────────────────────────────

// Everything generation depends on, read from current_run.save. Rngs are clones.
function contextFromSave(save) {
  if (typeof save === 'string') save = parseJsonBigSafe(save);
  const p = save.players[0];
  const player = PlayerRngSet.fromSave(p.rng);
  return {
    character: p.character_id,
    ascension: save.ascension ?? 0,
    actIndex: save.current_act_index ?? 0,
    players: save.players.length,
    epochs: new Set(p.unlock_state?.unlocked_epochs || []),
    runSeed: RunRngSet.fromSave(save.rng).seed,
    rngs: {
      Rewards: player.get('Rewards').clone(),
      NonCombatGeneration: player.get('NonCombatGeneration').clone(),
      Transformations: player.get('Transformations').clone(),
      Shops: player.get('Shops').clone(),
    },
    cardRarityOffset: Math.fround(p.odds?.card_rarity_odds_value ?? -0.05),
    potionOddsValue: Math.fround(p.odds?.potion_reward_odds_value ?? 0.4),
    // RelicGrabBag deques, fixed at run start from the UpFront stream.
    grabBag: Object.fromEntries(Object.entries(p.relic_grab_bag?.relic_id_lists || {}).map(([k, v]) => [k, v.slice()])),
  };
}

// ── Pools ─────────────────────────────────────────────────────────────────────

const constraintFor = ctx => (ctx.players > 1 ? 'MultiplayerOnly' : 'SingleplayerOnly');
const unlocked = (entry, epochs) => entry.gates && entry.gates.every(e => epochs.has(e));

// CardPoolModel.GetUnlockedCards(unlockState, runState.CardMultiplayerConstraint)
function unlockedCards(ctx, poolName) {
  const banned = constraintFor(ctx) === 'SingleplayerOnly' ? 'MultiplayerOnly' : 'SingleplayerOnly';
  return DATA.cardPools[poolName].filter(c => unlocked(c, ctx.epochs) && c.mp !== banned);
}

function characterPools(ctx) {
  return DATA.characters[ctx.character];
}

// PotionFactory.GetPotionOptions: character pool, then shared pool.
function potionOptions(ctx) {
  const pools = characterPools(ctx);
  return [...DATA.potionPools[pools.potionPool], ...DATA.potionPools.SHARED_POTION_POOL]
    .filter(p => unlocked(p, ctx.epochs));
}

// ── Cards ─────────────────────────────────────────────────────────────────────

const RARITY_WRAP = { Basic: 'Common', Common: 'Uncommon', Uncommon: 'Rare', Rare: 'Common' };

function baseOdds(ctx, type, rarity) {
  const t = {
    RegularEncounter: { Uncommon: 0.37, Rare: scarce(ctx, 0.0149, 0.03) },
    EliteEncounter:   { Uncommon: 0.4,  Rare: scarce(ctx, 0.05, 0.1) },
    BossEncounter:    { Uncommon: 0,    Rare: 1 },
    Shop:             { Uncommon: 0.37, Rare: scarce(ctx, 0.045, 0.09) },
    Uniform:          { Uncommon: 0.33, Rare: 0.33 },
  }[type];
  return Math.fround(t[rarity]);
}

// CardRarityOdds.RollWithBaseOdds / RollWithoutChangingFutureOdds(offset)
function rollRarity(ctx, type, rng, offset = null) {
  const r = rng.nextFloat();
  const rare = offset == null ? baseOdds(ctx, type, 'Rare') : Math.fround(baseOdds(ctx, type, 'Rare') + offset);
  if (r < rare) return { roll: r, rarity: 'Rare' };
  if (r < Math.fround(baseOdds(ctx, type, 'Uncommon') + rare)) return { roll: r, rarity: 'Uncommon' };
  return { roll: r, rarity: 'Common' };
}

// CardFactory.GetNextAllowedRarity (including its wrap-around stop condition)
function nextAllowedRarity(rarity, allowed) {
  const start = rarity;
  while (!allowed.has(rarity) && rarity !== 'None') {
    rarity = RARITY_WRAP[rarity] || 'None';
    if (rarity === start) return 'None';
  }
  return rarity;
}

// CardFactory.CreateForReward(player, count, options).
// opts: { pools: [poolName], rarityOdds, source: 'Encounter'|'Other', filter, noUpgradeRoll, rng }
function createCardsForReward(ctx, count, opts) {
  const rng = opts.rng || ctx.rngs.Rewards;
  const chosen = [];
  for (let i = 0; i < count; i++) {
    let options = opts.pools.flatMap(p => unlockedCards(ctx, p));
    if (opts.filter) options = options.filter(opts.filter);
    options = options.filter(c => !chosen.some(x => x.id === c.id));
    let items, rarityRoll = null;
    if (opts.rarityOdds === 'Uniform') {
      items = options.filter(c => c.rarity !== 'Basic' && c.rarity !== 'Ancient');
    } else {
      // Encounter rewards use (and grow) the pity offset; other sources use base odds.
      const useOffset = opts.source === 'Encounter' && ['RegularEncounter', 'EliteEncounter', 'BossEncounter'].includes(opts.rarityOdds);
      const offset = useOffset ? (opts.rarityOdds === 'BossEncounter' ? 0 : ctx.cardRarityOffset) : null;
      const rolled = rollRarity(ctx, opts.rarityOdds, ctx.rngs.Rewards, offset);
      rarityRoll = rolled.roll;
      if (useOffset) {
        ctx.cardRarityOffset = rolled.rarity === 'Rare'
          ? Math.fround(-0.05)
          : Math.min(Math.fround(ctx.cardRarityOffset + scarce(ctx, Math.fround(0.005), Math.fround(0.01))), Math.fround(0.4));
      }
      const rarity = nextAllowedRarity(rolled.rarity, new Set(options.map(c => c.rarity)));
      items = options.filter(c => c.rarity === rarity);
    }
    const card = rng.nextItem(items);
    let upgraded = false;
    if (!opts.noUpgradeRoll) {
      // RollForUpgrade: (decimal)NextFloat() <= baseChance(0) + actIndex * scaling (non-rares)
      const roll = Number(rng.nextFloat().toPrecision(7));
      if (card.upgradable) {
        const odds = card.rarity === 'Rare' ? 0 : ctx.actIndex * scarce(ctx, 0.125, 0.25);
        upgraded = roll <= odds;
      }
    }
    chosen.push({ id: card.id, rarity: card.rarity, type: card.type, upgraded, rarityRoll });
  }
  return chosen;
}

// ── Potions ───────────────────────────────────────────────────────────────────

// PotionFactory.CreateRandomPotions: rarity by one NextFloat, then NextItem of that rarity.
function createRandomPotions(ctx, count, rng) {
  const list = potionOptions(ctx).slice();
  const out = [];
  for (let i = 0; i < count; i++) {
    const r = rng.nextFloat();
    const rarity = r <= Math.fround(0.1) ? 'Rare' : r <= Math.fround(0.35) ? 'Uncommon' : 'Common';
    const item = rng.nextItem(list.filter(p => p.rarity === rarity));
    out.push(item ? { id: item.id, rarity } : null);
    if (item) list.splice(list.indexOf(item), 1);
  }
  return out;
}

// ── Combat rewards ────────────────────────────────────────────────────────────

// RewardsSet.GenerateRewardsFor + Populate, for Monster / Elite rooms. Rewards-stream order:
// potion-drop roll (PotionRewardOdds.Roll), gold NextInt, potion (if dropped), 3 cards.
// The gold range depends on the encounter, but it always consumes exactly one value.
function predictCombatRewards(ctx, roomType, potionOddsValue) {
  const rng = ctx.rngs.Rewards;
  const bonus = roomType === 'Elite' ? Math.fround(0.25) : 0;
  const potionRoll = rng.nextFloat();
  const potionDropped = potionRoll < Math.fround(Math.fround(potionOddsValue) + Math.fround(bonus * 0.5));
  rng.nextInt(10, 11); // GoldReward.Populate
  const potion = potionDropped ? createRandomPotions(ctx, 1, rng)[0] : null;
  const cards = createCardsForReward(ctx, 3, {
    pools: [characterPools(ctx).cardPool],
    rarityOdds: roomType === 'Elite' ? 'EliteEncounter' : 'RegularEncounter',
    source: 'Encounter',
  });
  return { roomType, potionRoll, potionChance: potionOddsValue + bonus * 0.5, potionDropped, potion, cards };
}

// ── Relics ────────────────────────────────────────────────────────────────────

// RelicFactory.RollRarity: one NextFloat — <0.5 common, <0.83 uncommon, else rare.
// Then RelicGrabBag.PullFromFront, falling back common -> uncommon -> rare when a deque is empty.
// (Ignores RemoveDisallowedRelicsFromDeques, which rarely matters early in a run.)
function pullRelicForReward(ctx, rng = ctx.rngs.Rewards) {
  const roll = rng.nextFloat();
  let rarity = roll < Math.fround(0.5) ? 'common' : roll < Math.fround(0.83) ? 'uncommon' : 'rare';
  const next = { shop: 'common', common: 'uncommon', uncommon: 'rare' };
  while (rarity && !(ctx.grabBag[rarity] || []).length) rarity = next[rarity];
  return rarity ? ctx.grabBag[rarity].shift() : null;
}

// Pickup (AfterObtained) effects that change what you get or which RNG is used.
// Returns what was gained; relics gained recursively get their pickups applied too.
const RELIC_PICKUPS = {
  LARGE_CAPSULE: ctx => {
    const relics = [pullRelicForReward(ctx), pullRelicForReward(ctx)].filter(Boolean);
    const pool = DATA.cardPools[characterPools(ctx).cardPool].filter(c => c.rarity === 'Basic');
    const basic = prefix => pool.find(c => c.id.startsWith('CARD.' + prefix))?.id;
    return { relics, cards: [basic('STRIKE'), basic('DEFEND')].filter(Boolean) };
  },
  NEOWS_SACRIFICE: () => ({ potions: ['POTION.AMBERGRIS'], cards: ['CARD.GUILTY'] }),
};

function obtainRelic(ctx, relicId, gained) {
  gained.relics.push(relicId);
  const fn = RELIC_PICKUPS[relicId.replace(/^RELIC\./, '')];
  if (!fn) return;
  const got = fn(ctx);
  gained.cards.push(...(got.cards || []));
  gained.potions.push(...(got.potions || []));
  for (const r of got.relics || []) obtainRelic(ctx, r, gained);
}

// ── Neow ──────────────────────────────────────────────────────────────────────

const NEOW_CURSES = ['CURSED_PEARL', 'DOWSING_ROD', 'HEFTY_TABLET', 'LARGE_CAPSULE', 'LEAFY_POULTICE',
  'NEOWS_BONES', 'NEOWS_SACRIFICE', 'PRECARIOUS_SHEARS', 'SILKEN_TRESS', 'SILVER_CRUCIBLE'];
const NEOW_POSITIVE = ['ARCANE_SCROLL', 'BOOMING_CONCH', 'FISHING_ROD', 'GOLDEN_PEARL', 'KALEIDOSCOPE',
  'LEAD_PAPERWEIGHT', 'LOST_COFFER', 'MASSIVE_SCROLL', 'NEOWS_TORMENT', 'NEW_LEAF', 'PHIAL_HOLSTER',
  'PRECISE_SCISSORS', 'SCROLL_BOXES', 'WINGED_BOOTS'];
// Neow.AllPossibleOptions order (used by Neow's Bones)
const NEOW_ALL = [...NEOW_CURSES, ...NEOW_POSITIVE, 'LAVA_ROCK', 'NEOWS_TALISMAN', 'NUTRITIOUS_OYSTER',
  'POMANDER', 'SMALL_CAPSULE', 'STONE_HUMIDIFIER'];
const CURSE_EXCLUDES = {
  CURSED_PEARL: ['GOLDEN_PEARL'], HEFTY_TABLET: ['ARCANE_SCROLL'], LEAFY_POULTICE: ['NEW_LEAF'],
  PRECARIOUS_SHEARS: ['PRECISE_SCISSORS'], NEOWS_SACRIFICE: ['PHIAL_HOLSTER', 'LOST_COFFER'],
};
const CHARACTER_EPOCHS = ['SILENT1_EPOCH', 'REGENT1_EPOCH', 'NECROBINDER1_EPOCH', 'DEFECT1_EPOCH', 'FOOL1_EPOCH'];

// RelicModel.IsAllowedAtNeow for the Neow relics.
function allowedAtNeow(ctx, relic) {
  if (relic === 'MASSIVE_SCROLL') return ctx.players > 1;
  if (relic === 'SILVER_CRUCIBLE' || relic === 'WINGED_BOOTS') return ctx.players === 1;
  if (relic === 'KALEIDOSCOPE') return CHARACTER_EPOCHS.every(e => ctx.epochs.has(e));
  if (relic === 'SCROLL_BOXES') {
    const cards = unlockedCards(ctx, characterPools(ctx).cardPool);
    return cards.filter(c => c.rarity === 'Common').length >= 4 && cards.filter(c => c.rarity === 'Uncommon').length >= 2;
  }
  return true;
}

// Neow.GenerateInitialOptions — event Rng = runSeed + slot + XxHash64("NEOW").
function neowOptions(ctx, slot = 0) {
  const rng = new Rng((ctx.runSeed + BigInt(slot) + xxHash64('NEOW')) & MASK64);
  const curse = rng.nextItem(NEOW_CURSES.filter(r => allowedAtNeow(ctx, r)));
  let list = NEOW_POSITIVE.filter(r => !(CURSE_EXCLUDES[curse] || []).includes(r));
  if (curse !== 'LARGE_CAPSULE') list.push(rng.nextBool() ? 'LAVA_ROCK' : 'SMALL_CAPSULE');
  list.push(rng.nextBool() ? 'NUTRITIOUS_OYSTER' : 'STONE_HUMIDIFIER');
  list.push(rng.nextBool() ? 'NEOWS_TALISMAN' : 'POMANDER');
  list = list.filter(r => allowedAtNeow(ctx, r));
  const shuffled = rng.unstableShuffle(list.slice());
  return [shuffled[0], shuffled[1], curse];
}

// What picking each Neow relic gives, for the relics whose pickup is random.
// Each option is computed from fresh clones: you can only pick one.
const NEOW_OUTCOMES = {
  LOST_COFFER: ctx => {
    const cards = createCardsForReward(ctx, 3, {
      pools: [characterPools(ctx).cardPool], rarityOdds: 'RegularEncounter', source: 'Other',
    });
    const [potion] = createRandomPotions(ctx, 1, ctx.rngs.Rewards);
    return { cardChoice: cards, potions: [potion] };
  },
  ARCANE_SCROLL: ctx => ({
    cards: createCardsForReward(ctx, 1, {
      pools: [characterPools(ctx).cardPool], rarityOdds: 'Uniform', source: 'Other',
      filter: c => c.rarity === 'Rare', noUpgradeRoll: true,
    }),
  }),
  PHIAL_HOLSTER: ctx => ({ potionSlots: 1, potions: createRandomPotions(ctx, 2, ctx.rngs.NonCombatGeneration) }),
  NEOWS_BONES: ctx => {
    const rng = ctx.rngs.NonCombatGeneration;
    const relics = rng.unstableShuffle(NEOW_ALL.filter(r => r !== 'NEOWS_BONES' && allowedAtNeow(ctx, r))).slice(0, 2);
    const curses = DATA.cardPools.CURSE_CARD_POOL
      .filter(c => unlocked(c, ctx.epochs) && !NOT_MODIFIER_CURSES.has(c.id))
      .map(c => c.id).sort();
    // Both relics are obtained from the rewards screen (pickups run), then the curse is rolled.
    const gained = { relics: [], cards: [], potions: [] };
    for (const r of relics) obtainRelic(ctx, 'RELIC.' + r, gained);
    return { relics: gained.relics, extraCards: gained.cards, potions: gained.potions.map(id => ({ id })), curses: [rng.nextItem(curses)] };
  },
};
// CardModel.CanBeGeneratedByModifiers == false
const NOT_MODIFIER_CURSES = new Set(['CARD.ASCENDERS_BANE', 'CARD.BAD_LUCK', 'CARD.CURSE_OF_THE_BELL',
  'CARD.ENTHRALLED', 'CARD.FOLLY', 'CARD.GREED', 'CARD.POOR_SLEEP', 'CARD.SPORE_MIND']);

function cloneCtx(ctx) {
  return {
    ...ctx,
    rngs: Object.fromEntries(Object.entries(ctx.rngs).map(([k, r]) => [k, r.clone()])),
    grabBag: Object.fromEntries(Object.entries(ctx.grabBag || {}).map(([k, v]) => [k, v.slice()])),
  };
}

// Each option: what it gives, and the first normal fight's rewards if you pick it
// (options that pull relics or cards shift the shared Rewards stream).
function neowReport(save) {
  const ctx = contextFromSave(save);
  return neowOptions(ctx).map(relic => {
    const c = cloneCtx(ctx);
    let outcome = null;
    if (NEOW_OUTCOMES[relic]) {
      outcome = NEOW_OUTCOMES[relic](c);
    } else if (RELIC_PICKUPS[relic]) {
      const gained = { relics: [], cards: [], potions: [] };
      obtainRelic(c, 'RELIC.' + relic, gained);
      outcome = { relics: gained.relics.slice(1), extraCards: gained.cards, potions: gained.potions.map(id => ({ id })) };
    }
    const modelled = Boolean(outcome) || !HAS_RANDOM_PICKUP.has(relic);
    return {
      relic: 'RELIC.' + relic,
      outcome,
      firstFight: modelled ? predictCombatRewards(c, 'Monster', c.potionOddsValue) : null,
    };
  });
}

// Neow relics whose pickup uses RNG we don't model yet (their first-fight forecast is unknown).
const HAS_RANDOM_PICKUP = new Set(['FISHING_ROD', 'KALEIDOSCOPE', 'NEW_LEAF', 'LEAFY_POULTICE', 'SCROLL_BOXES',
  'LEAD_PAPERWEIGHT', 'HEFTY_TABLET', 'SILKEN_TRESS',
  'SMALL_CAPSULE', 'MASSIVE_SCROLL']);

// Reward forecasts for a current_run.save. Neow is included only before it's resolved.
function rewardsReport(save) {
  if (typeof save === 'string') save = parseJsonBigSafe(save);
  const ctx = contextFromSave(save);
  if (!DATA.characters[ctx.character]) return null;
  const history = (save.map_point_history || []).flat();
  const potionOdds = save.players[0].odds?.potion_reward_odds_value ?? 0.4;
  return {
    neow: history.length === 0 && ctx.actIndex === 0 ? neowReport(save) : null,
    nextMonster: predictCombatRewards(cloneCtx(ctx), 'Monster', potionOdds),
    nextElite: predictCombatRewards(cloneCtx(ctx), 'Elite', potionOdds),
  };
}

module.exports = {
  contextFromSave, cloneCtx, unlockedCards, potionOptions,
  createCardsForReward, createRandomPotions, rollRarity, predictCombatRewards,
  neowOptions, neowReport, rewardsReport, allowedAtNeow,
};
