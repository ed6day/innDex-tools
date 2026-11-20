// Checks lib/rng.js against vectors produced by the game's own sts2.dll
// (RunRngSet / PlayerRngSet / ListExtensions). Run: node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const vectors = require('./rng-vectors.json');
const {
  RunRngSet, PlayerRngSet, Rng, snakeCase, canonicalizeSeed, parseJsonBigSafe,
} = require('../lib/rng');

test('canonicalizeSeed matches SeedHelper', () => {
  assert.equal(canonicalizeSeed(' oi0k789m7xn0 '), vectors.canon);
});

for (const v of vectors.seeds) {
  test(`run rng streams for seed "${v.seed}"`, () => {
    const run = new RunRngSet(v.seed);
    assert.equal(run.seed.toString(), v.hash, 'seed hash');

    for (const [type, s] of Object.entries(v.streams)) {
      assert.equal(snakeCase(type), s.name, `${type} snake_case`);
      const r = run.get(type);
      const init = r.toSerializable();
      assert.deepEqual(
        [init.s0, init.s1, init.s2, init.s3],
        [s.init.s0, s.init.s1, s.init.s2, s.init.s3],
        `${type} initial state`);

      assert.deepEqual(s.ulongs.map(() => r.nextUnsignedLong().toString()), s.ulongs, `${type} ulongs`);
      assert.deepEqual(s.ints.map((_, i) => r.nextInt(i + 2)), s.ints, `${type} NextInt(n)`);
      assert.deepEqual(s.range.map((_, i) => r.nextInt(-3, 10 + i)), s.range, `${type} NextInt(min,max)`);
      assert.deepEqual(s.floats.map(() => r.nextFloat()), s.floats.map(Math.fround), `${type} NextFloat`);
      assert.deepEqual(s.bools.map(() => r.nextBool()), s.bools, `${type} NextBool`);
      assert.deepEqual(s.doubles.map(() => r.nextDouble()), s.doubles, `${type} NextDouble`);
      assert.deepEqual(r.unstableShuffle([...Array(12).keys()]), s.shuffled, `${type} UnstableShuffle`);
      assert.deepEqual(r.stableShuffle([5, 3, 9, 1, 1, 7, 2], (a, b) => a - b), s.stable, `${type} StableShuffle`);
      assert.equal(r.counter, s.after.counter, `${type} counter`);
      assert.equal(r.toSerializable().s0, s.after.s0, `${type} final state`);
    }
  });

  test(`player rng streams for seed "${v.seed}"`, () => {
    const player = PlayerRngSet.forSeed(v.seed, 0);
    for (const [type, s] of Object.entries(v.player)) {
      assert.equal(snakeCase(type), s.name);
      assert.equal(player.get(type).nextUnsignedLong().toString(), s.first, `${type} first value`);
    }
  });
}

test('save state round-trips through fromSerializable', () => {
  const a = new RunRngSet('0K789M7XN0').get('Shuffle');
  a.nextInt(10); a.nextInt(10);
  const b = Rng.fromSerializable(a.toSerializable());
  assert.equal(b.counter, 2);
  assert.equal(b.nextUnsignedLong(), a.nextUnsignedLong());
});

test('reads RNG state from real save-format JSON (snake_case keys, bare u64s)', () => {
  const runSave = parseJsonBigSafe(vectors.save.rng);
  const run = RunRngSet.fromSave(runSave);
  assert.equal(run.stringSeed, '0K789M7XN0');
  assert.equal(run.get('Shuffle').counter, 3);
  assert.equal(run.get('Shuffle').nextUnsignedLong().toString(), vectors.save.nextShuffle);
  assert.equal(run.get('UnknownMapPoint').nextFloat(), Math.fround(vectors.save.nextUnknown));

  const player = PlayerRngSet.fromSave(parseJsonBigSafe(vectors.save.playerRng));
  assert.equal(player.get('Rewards').nextUnsignedLong().toString(), vectors.save.nextRewards);
});

test('parseJsonBigSafe keeps u64 precision', () => {
  const parsed = parseJsonBigSafe('{"s0": 18374653080775439450, "n": 5, "a": [12126468664649763763]}');
  assert.equal(parsed.s0, '18374653080775439450');
  assert.equal(parsed.n, 5);
  assert.equal(parsed.a[0], '12126468664649763763');
});
