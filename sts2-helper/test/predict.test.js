const test = require('node:test');
const assert = require('node:assert/strict');
const { RunRngSet } = require('../lib/rng');
const {
  predictOpeningDraw, predictReshuffle, predictUnknownRooms, seedReport, saveReport,
} = require('../lib/predict');

const deck = [
  ...Array(5).fill({ id: 'CARD.STRIKE_IRONCLAD' }),
  ...Array(4).fill({ id: 'CARD.DEFEND_IRONCLAD' }),
  { id: 'CARD.BASH' },
  { id: 'CARD.BACKSTAB' }, // innate
].map(c => ({ ...c }));

test('opening draw is deterministic and does not advance the caller rng', () => {
  const shuffle = new RunRngSet('0K789M7XN0').get('Shuffle');
  const a = predictOpeningDraw(shuffle, deck);
  const b = predictOpeningDraw(shuffle, deck);
  assert.equal(shuffle.counter, 0);
  assert.deepEqual(a.drawOrder.map(c => c.id), b.drawOrder.map(c => c.id));
  assert.equal(a.drawOrder.length, deck.length);
  assert.equal(a.hand.length, 5);
  assert.equal(a.hand[0].id, 'CARD.BACKSTAB', 'innate card is drawn first');
  assert.equal(a.rngAfter.counter, 1, 'one shuffle = one Shuffle-stream value');
});

test('reshuffle result is independent of input order (StableShuffle)', () => {
  const shuffle = new RunRngSet('ABC').get('Shuffle');
  const x = predictReshuffle(shuffle, deck).drawOrder.map(c => c.id);
  const y = predictReshuffle(shuffle, deck.slice().reverse()).drawOrder.map(c => c.id);
  assert.deepEqual(x, y);
});

test('"?" room odds evolve like UnknownMapPointOdds', () => {
  const rolls = predictUnknownRooms(new RunRngSet('0K789M7XN0').get('UnknownMapPoint'), null, 30);
  assert.equal(rolls.length, 30);
  assert.ok(rolls.every(r => ['Event', 'Monster', 'Treasure', 'Shop'].includes(r.roomType)));
  // Odds for a type reset after it is rolled and otherwise grow.
  for (let i = 1; i < rolls.length; i++) {
    const prev = rolls[i - 1], cur = rolls[i];
    if (prev.roomType === 'Monster') assert.equal(cur.chance.Monster, Math.fround(0.1));
    else assert.ok(cur.chance.Monster > prev.chance.Monster);
  }
});

test('seedReport lists all 16 streams', () => {
  const r = seedReport('0K789M7XN0');
  assert.equal(r.seedHash, '13615732048376606717');
  assert.equal(r.streams.length, 16);
});

test('saveReport reads a current_run.save-shaped document', () => {
  const vectors = require('./rng-vectors.json');
  const text = `{"rng": ${vectors.save.rng}, "odds": {"unknown_map_point_monster_odds_value": 0.2},
    "players": [{"deck": [{"id": "CARD.BASH"}, {"id": "CARD.STRIKE_IRONCLAD", "current_upgrade_level": 1}],
                 "rng": ${vectors.save.playerRng}}]}`;
  const r = saveReport(text);
  assert.equal(r.seed, '0K789M7XN0');
  assert.equal(r.streams.find(s => s.name === 'Shuffle').counter, 3);
  assert.equal(r.openingDraw.hand.length, 2);
  assert.equal(r.shuffleSeeds[0].childSeed, vectors.save.nextShuffle);
  assert.equal(r.unknownRooms[0].roll, Math.fround(vectors.save.nextUnknown));
  assert.equal(r.unknownRooms[0].chance.Monster, Math.fround(0.2));
});
