const test = require('node:test');
const assert = require('node:assert/strict');
const { RunRngSet, PlayerRngSet } = require('../lib/rng');
const DATA = require('../lib/gamedata.json');
const R = require('../lib/rewards');
const E = require('../lib/events');

function ctxFor(seed) {
  const run = new RunRngSet(seed);
  const player = PlayerRngSet.forSeed(seed, 0);
  const snake = { Rewards: 'rewards', Shops: 'shops', Transformations: 'transformations', NonCombatGeneration: 'non_combat_generation' };
  return R.contextFromSave({
    ascension: 10, current_act_index: 0,
    rng: { seed, rngs: { up_front: run.get('UpFront').toSerializable() } },
    players: [{
      character_id: 'CHARACTER.SILENT',
      rng: { seed: player.seed.toString(), rngs: Object.fromEntries(Object.entries(snake).map(([t, k]) => [k, player.get(t).toSerializable()])) },
      unlock_state: { unlocked_epochs: DATA.epochs },
      relic_grab_bag: { relic_id_lists: { common: ['RELIC.STRIKE_DUMMY'], uncommon: ['RELIC.VAMBRACE'], rare: ['RELIC.WHITE_STAR'] } },
    }],
  });
}

const st = {
  act: 0, gold: 120, hp: 40, maxHp: 70, potions: [], potionModels: [],
  deck: ['STRIKE_SILENT', 'STRIKE_SILENT', 'DEFEND_SILENT', 'NEUTRALIZE', 'SURVIVOR', 'BACKFLIP'].map(id => ({ id: 'CARD.' + id })),
  totalFloor: 8,
};

// Gold recorded in real run histories (single player, game v0.111.0).
const OBSERVED = [
  ['NQ52KD62WD1Q', 'THIS_OR_THAT', 'Plain', 61],
  ['WU4KMXUCKR52', 'THIS_OR_THAT', 'Plain', 63],
  ['JD9E2A6W48QC', 'SUNKEN_STATUE', 'Dive into the water', 115],
  ['J687WYM22SEE', 'SUNKEN_STATUE', 'Dive into the water', 110],
  ['UD0PK79L39R9', 'DENSE_VEGETATION', 'Trudge on', 74],
];

for (const [seed, id, option, gold] of OBSERVED) {
  test(`${id} on ${seed} gives ${gold} gold (from a real run)`, () => {
    const f = E.forecastEvent('EVENT.' + id, ctxFor(seed), st);
    const o = f.options.find(x => x.name === option);
    assert.ok(o.effects.some(t => t.includes(`Gain ${gold} gold`)), o.effects.join('; '));
  });
}

test('event forecasts are deterministic and do not advance the caller state', () => {
  const ctx = ctxFor('2HZ7UB0D8KD2');
  const before = ctx.rngs.Rewards.counter;
  const a = E.forecastEvent('EVENT.WHISPERING_HOLLOW', ctx, st);
  const b = E.forecastEvent('EVENT.WHISPERING_HOLLOW', ctx, st);
  assert.deepEqual(a, b);
  assert.equal(ctx.rngs.Rewards.counter, before);
  assert.equal(a.options[0].potions.length, 2);
});

test('transforms never return the same card and stay in the pool', () => {
  const f = E.forecastEvent('EVENT.AROMA_OF_CHAOS', ctxFor('2HZ7UB0D8KD2'), st);
  for (const t of f.options[0].transforms) {
    assert.notEqual(t.from, t.to);
    assert.ok(DATA.cardPools.SILENT_CARD_POOL.some(c => c.id === t.to));
  }
});

// Ancient offers recorded in real runs (single player, game v0.113).
const ANCIENT_OBSERVED = [
  ['2HZ7UB0D8KD2', 'EVENT.PAEL', ['PAELS_BLOOD', 'PAELS_GROWTH', 'PAELS_TEARS']],
  ['TKWP7T17CUDL', 'EVENT.VAKUU', ['CHOICES_PARADOX', 'FIDDLE', 'PRESERVED_FOG']],
  ['7ULLQN4CLKM8', 'EVENT.VAKUU', ['BLOOD_SOAKED_ROSE', 'LORDS_PARASOL', 'SERE_TALON']],
];

for (const [seed, id, offers] of ANCIENT_OBSERVED) {
  test(`${id} on ${seed} offers what the game offered`, () => {
    const f = E.forecastAncient(id, ctxFor(seed), st);
    assert.deepEqual(f.options.map(o => o.relics[0].replace('RELIC.', '')).sort(), offers);
  });
}

test('act 2 event forecasts run for every ported event', () => {
  const ctx = ctxFor('2HZ7UB0D8KD2');
  const act2 = { ...st, act: 1, gold: 300, potions: ['POTION.FIRE_POTION', 'POTION.SWIFT_POTION'],
    potionModels: [{ id: 'POTION.FIRE_POTION', rarity: 'Common' }, { id: 'POTION.SWIFT_POTION', rarity: 'Common' }],
    relics: ['RELIC.VAJRA', 'RELIC.BAG_OF_MARBLES', 'RELIC.ORNAMENTAL_FAN', 'RELIC.JOSS_PAPER', 'RELIC.PERMAFROST'],
    epochs: new Set(DATA.epochs) };
  for (const id of Object.keys(E.PORTS)) {
    const f = E.forecastEvent('EVENT.' + id, ctx, act2);
    assert.ok(f.options.length > 0, id);
  }
});

test('eligibility rules', () => {
  assert.equal(E.isAllowed('EVENT.STONE_OF_ALL_TIME', st), false, 'act 2 only');
  assert.equal(E.isAllowed('EVENT.WHISPERING_HOLLOW', { ...st, gold: 43 }), false);
  assert.equal(E.isAllowed('EVENT.UNREST_SITE', st), true, 'HP 40/70 is under 70%');
  assert.equal(E.isAllowed('EVENT.UNREST_SITE', { ...st, hp: 60 }), false);
  assert.equal(E.isAllowed('EVENT.WAR_HISTORIAN_REPY', st), false);
});
