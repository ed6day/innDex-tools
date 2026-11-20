const test = require('node:test');
const assert = require('node:assert/strict');
const vectors = require('./rng-vectors.json');
const DATA = require('../lib/gamedata.json');
const {
  contextFromSave, cloneCtx, unlockedCards, createCardsForReward, createRandomPotions,
  neowOptions, rewardsReport,
} = require('../lib/rewards');

const ALL_EPOCHS = DATA.epochs;

function saveText({ epochs = ALL_EPOCHS, character = 'CHARACTER.SILENT', ascension = 10 } = {}) {
  return `{"ascension": ${ascension}, "current_act_index": 0, "rng": ${vectors.save.rng},
    "players": [{"character_id": "${character}", "rng": ${vectors.save.playerRng},
      "odds": {"card_rarity_odds_value": -0.05, "potion_reward_odds_value": 0.4},
      "unlock_state": {"unlocked_epochs": ${JSON.stringify(epochs)}}, "deck": []}]}`;
}

test('exported game data has every character pool', () => {
  for (const c of Object.values(DATA.characters)) {
    assert.ok(DATA.cardPools[c.cardPool].length > 80, c.cardPool);
    assert.ok(DATA.potionPools[c.potionPool].length > 0, c.potionPool);
  }
});

test('locked epochs remove their cards from the pool', () => {
  const all = contextFromSave(saveText());
  const locked = contextFromSave(saveText({ epochs: ALL_EPOCHS.filter(e => e !== 'SILENT7_EPOCH') }));
  const a = unlockedCards(all, 'SILENT_CARD_POOL').map(c => c.id);
  const b = unlockedCards(locked, 'SILENT_CARD_POOL').map(c => c.id);
  assert.ok(a.includes('CARD.BLADE_OF_INK'));
  assert.ok(!b.includes('CARD.BLADE_OF_INK'));
});

test('card rewards are distinct, unlocked and deterministic', () => {
  const ctx = contextFromSave(saveText());
  const opts = { pools: ['SILENT_CARD_POOL'], rarityOdds: 'RegularEncounter', source: 'Encounter' };
  const a = createCardsForReward(cloneCtx(ctx), 3, opts);
  const b = createCardsForReward(cloneCtx(ctx), 3, opts);
  assert.deepEqual(a, b);
  assert.equal(new Set(a.map(c => c.id)).size, 3);
  assert.ok(a.every(c => ['Common', 'Uncommon', 'Rare'].includes(c.rarity)));
});

test('uniform rare filter only yields rares; potions come from unlocked pools', () => {
  const ctx = contextFromSave(saveText());
  const [card] = createCardsForReward(cloneCtx(ctx), 1, {
    pools: ['SILENT_CARD_POOL'], rarityOdds: 'Uniform', source: 'Other',
    filter: c => c.rarity === 'Rare', noUpgradeRoll: true,
  });
  assert.equal(card.rarity, 'Rare');
  const potions = createRandomPotions(cloneCtx(ctx), 2, cloneCtx(ctx).rngs.NonCombatGeneration);
  assert.equal(potions.length, 2);
  assert.notEqual(potions[0].id, potions[1].id);
});

test('Neow options respect singleplayer and unlock rules', () => {
  const opts = neowOptions(contextFromSave(saveText()));
  assert.equal(opts.length, 3);
  assert.ok(!opts.includes('MASSIVE_SCROLL'));
  const noKaleido = neowOptions(contextFromSave(saveText({ epochs: ['SILENT1_EPOCH'] })));
  assert.ok(!noKaleido.includes('KALEIDOSCOPE'));
});

// Observed in game on 2026-11-20 (seed NWN2GVX68PT5, Silent, A10, all epochs): picking
// Neow's Bones gave Neow's Sacrifice + Large Capsule (-> Vambrace, Tuning Fork), Regret,
// and the first fight offered Deflect / Acrobatics / Bubble Bubble with no potion.
test('replays a real Neow + first fight from the game', () => {
  const { RunRngSet, PlayerRngSet } = require('../lib/rng');
  const seed = 'NWN2GVX68PT5';
  const run = new RunRngSet(seed);
  const player = PlayerRngSet.forSeed(seed, 0);
  const snake = { Rewards: 'rewards', Shops: 'shops', Transformations: 'transformations', NonCombatGeneration: 'non_combat_generation' };
  const save = {
    ascension: 10, current_act_index: 0,
    rng: { seed, rngs: { up_front: run.get('UpFront').toSerializable() } },
    players: [{
      character_id: 'CHARACTER.SILENT',
      rng: { seed: player.seed.toString(), rngs: Object.fromEntries(Object.entries(snake).map(([t, k]) => [k, player.get(t).toSerializable()])) },
      odds: { card_rarity_odds_value: -0.05, potion_reward_odds_value: 0.4 },
      unlock_state: { unlocked_epochs: ALL_EPOCHS },
      relic_grab_bag: { relic_id_lists: { common: ['RELIC.STRIKE_DUMMY'], uncommon: ['RELIC.VAMBRACE', 'RELIC.TUNING_FORK', 'RELIC.MERCURY_HOURGLASS'], rare: ['RELIC.WHITE_STAR'] } },
      deck: [],
    }],
  };
  const neow = rewardsReport(save).neow;
  assert.deepEqual(neow.map(o => o.relic), ['RELIC.LOST_COFFER', 'RELIC.ARCANE_SCROLL', 'RELIC.NEOWS_BONES']);
  const bones = neow[2];
  assert.deepEqual(bones.outcome.relics, ['RELIC.NEOWS_SACRIFICE', 'RELIC.LARGE_CAPSULE', 'RELIC.VAMBRACE', 'RELIC.TUNING_FORK']);
  assert.deepEqual(bones.outcome.curses, ['CARD.REGRET']);
  assert.deepEqual(bones.firstFight.cards.map(c => c.id).sort(), ['CARD.ACROBATICS', 'CARD.BUBBLE_BUBBLE', 'CARD.DEFLECT']);
  assert.equal(bones.firstFight.potionDropped, false);
});

test('rewardsReport includes Neow before it is resolved', () => {
  const r = rewardsReport(saveText());
  assert.equal(r.neow.length, 3);
  assert.equal(r.nextMonster.cards.length, 3);
  assert.equal(r.nextElite.roomType, 'Elite');
});
