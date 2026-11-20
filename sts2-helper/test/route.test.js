const test = require('node:test');
const assert = require('node:assert/strict');
const { RunRngSet, PlayerRngSet } = require('../lib/rng');
const DATA = require('../lib/gamedata.json');
const { mapFromSave, simulateRoute, lookahead } = require('../lib/route');

// A small act: start -> (1,1) monster -> (1,2) unknown -> (1,3) shop -> (1,4) elite -> boss.
function save() {
  const seed = '2HZ7UB0D8KD2';
  const run = new RunRngSet(seed);
  const player = PlayerRngSet.forSeed(seed, 0);
  const snake = { Rewards: 'rewards', Shops: 'shops', Transformations: 'transformations', NonCombatGeneration: 'non_combat_generation' };
  const pt = (col, row, type, children = []) => ({ coord: { col, row }, type, children: children.map(([c, r]) => ({ col: c, row: r })) });
  return {
    ascension: 10, current_act_index: 0,
    rng: { seed, rngs: Object.fromEntries(['UnknownMapPoint', 'TreasureRoomRelics'].map(t => [t, run.get(t).toSerializable()])) },
    odds: {},
    visited_map_coords: [{ col: 0, row: 0 }],
    map_point_history: [[{ map_point_type: 'ancient', rooms: [{ room_type: 'event' }] }]],
    shared_relic_grab_bag: { relic_id_lists: { common: ['RELIC.BAG_OF_MARBLES'], uncommon: [], rare: [] } },
    acts: [{
      id: 'ACT.OVERGROWTH',
      rooms: {
        normal_encounter_ids: ['ENCOUNTER.A_WEAK', 'ENCOUNTER.B_WEAK'], normal_encounters_visited: 0,
        elite_encounter_ids: ['ENCOUNTER.E1_ELITE'], elite_encounters_visited: 0,
        event_ids: ['EVENT.NEOW_PLACEHOLDER', 'EVENT.SAPPHIRE_SEED', 'EVENT.THIS_OR_THAT'], events_visited: 1,
        boss_id: 'ENCOUNTER.BOSS_BOSS',
      },
      saved_map: {
        width: 3, height: 5,
        start: pt(0, 0, 'ancient', [[1, 1]]),
        points: [pt(1, 1, 'monster', [[1, 2]]), pt(1, 2, 'unknown', [[1, 3]]), pt(1, 3, 'shop', [[1, 4]]), pt(1, 4, 'elite', [[1, 5]])],
        boss: pt(1, 5, 'boss'),
      },
    }],
    players: [{
      character_id: 'CHARACTER.SILENT',
      rng: { seed: player.seed.toString(), rngs: Object.fromEntries(Object.entries(snake).map(([t, k]) => [k, player.get(t).toSerializable()])) },
      odds: { card_rarity_odds_value: -0.05, potion_reward_odds_value: 0.4 },
      unlock_state: { unlocked_epochs: DATA.epochs },
      relic_grab_bag: { relic_id_lists: { common: ['RELIC.STRIKE_DUMMY', 'RELIC.PENDULUM'], uncommon: ['RELIC.VAMBRACE'], rare: ['RELIC.WHITE_STAR'], shop: ['RELIC.CHEMICAL_X'] } },
      deck: [],
    }],
  };
}

test('map is read from the save', () => {
  const m = mapFromSave(save());
  assert.equal(m.current, '0,0');
  assert.deepEqual(m.nodes['1,2'].children, ['1,3']);
});

test('route walks fights in list order and stops at missing edges', () => {
  const r = simulateRoute(save(), ['1,1', '1,2', '1,3', '1,4', '9,9']);
  assert.equal(r.steps.length, 4);
  assert.equal(r.steps[0].encounter, 'ENCOUNTER.A_WEAK');
  assert.equal(r.steps[0].rewards.cards.length, 3);
  assert.equal(r.steps[2].roomType, 'Shop');
  assert.equal(r.steps[2].shop.cards.length, 7);
  assert.equal(r.steps[2].shop.cards.filter(c => c.onSale).length, 1);
  assert.equal(r.steps[3].encounter, 'ENCOUNTER.E1_ELITE');
  assert.ok(r.steps[3].rewards.relic, 'elites drop a relic');
});

test('route is deterministic and matches the path-independent first fight', () => {
  const a = simulateRoute(save(), ['1,1']).steps[0].rewards;
  const b = lookahead(save()).normalFightRewards[0];
  assert.deepEqual(a.cards, b.cards);
});

test('events come from the list after the ones already visited', () => {
  const L = lookahead(save());
  assert.equal(L.events[0].id, 'EVENT.SAPPHIRE_SEED');
  assert.equal(L.events[1].mayShiftRewards, true);
});
