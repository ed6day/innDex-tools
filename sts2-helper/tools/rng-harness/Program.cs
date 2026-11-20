using System.Text.Json;
using MegaCrit.Sts2.Core.Entities.Rngs;
using MegaCrit.Sts2.Core.Extensions;
using MegaCrit.Sts2.Core.Helpers;
using MegaCrit.Sts2.Core.Random;
using MegaCrit.Sts2.Core.Runs;

// Dumps test vectors from the game's own RNG classes so the JS port can be checked bit-for-bit.
// `dotnet run -- data` exports card/potion pool data instead (see DataExport.cs).
if (args.Length > 0 && args[0] == "data") { DataExport.Run(); return; }
var seeds = new[] { "0K789M7XN0", "ABC123DEF456", "Z", "", "THIS_SEED_IS_LONGER_THAN_32_BYTES_XYZ", "old1234" };
var outSeeds = new List<object>();
foreach (var seed in seeds)
{
    var run = new RunRngSet(seed);
    var streams = new Dictionary<string, object>();
    foreach (var t in Enum.GetValues<RunRngType>())
    {
        var r = run.GetRng(t);
        var init = r.ToSerializable();
        var ulongs = Enumerable.Range(0, 4).Select(_ => r.NextUnsignedLong().ToString()).ToList();
        var ints = Enumerable.Range(0, 6).Select(i => r.NextInt(i + 2)).ToList();
        var range = Enumerable.Range(0, 4).Select(i => r.NextInt(-3, 10 + i)).ToList();
        var floats = Enumerable.Range(0, 4).Select(_ => r.NextFloat()).ToList();
        var bools = Enumerable.Range(0, 6).Select(_ => r.NextBool()).ToList();
        var doubles = Enumerable.Range(0, 2).Select(_ => r.NextDouble()).ToList();
        var shuffled = Enumerable.Range(0, 12).ToList().UnstableShuffle(r);
        var stable = new List<int> { 5, 3, 9, 1, 1, 7, 2 }.StableShuffle(r);
        var after = r.ToSerializable();
        streams[t.ToString()] = new
        {
            name = StringHelper.SnakeCase(t.ToString()),
            init = new { init.counter, s0 = init.state0.ToString(), s1 = init.state1.ToString(), s2 = init.state2.ToString(), s3 = init.state3.ToString() },
            ulongs, ints, range, floats, bools, doubles, shuffled, stable,
            after = new { after.counter, s0 = after.state0.ToString() },
        };
    }
    var player = new PlayerRngSet(StringHelper.GetDeterministicHashCode(seed));
    var pstreams = new Dictionary<string, object>();
    foreach (var t in Enum.GetValues<PlayerRngType>())
    {
        var r = player.GetRng(t);
        pstreams[t.ToString()] = new { name = StringHelper.SnakeCase(t.ToString()), first = r.NextUnsignedLong().ToString() };
    }
    outSeeds.Add(new { seed, hash = run.Seed.ToString(), streams, player = pstreams });
}
// Real save-format snippets, serialized with the game's own JSON options.
var saveRun = new RunRngSet("0K789M7XN0");
for (int i = 0; i < 3; i++) saveRun.Shuffle.NextUnsignedLong();
saveRun.UnknownMapPoint.NextFloat();
var savePlayer = new PlayerRngSet(StringHelper.GetDeterministicHashCode("0K789M7XN0"));
savePlayer.Rewards.NextInt(100);
var gameOpts = MegaCrit.Sts2.Core.Saves.JsonSerializationUtility.Options;
var saveSnippet = new
{
    rng = JsonSerializer.Serialize(saveRun.ToSerializable(), gameOpts),
    playerRng = JsonSerializer.Serialize(savePlayer.ToSerializable(), gameOpts),
    nextShuffle = saveRun.Shuffle.NextUnsignedLong().ToString(),
    nextUnknown = saveRun.UnknownMapPoint.NextFloat(),
    nextRewards = savePlayer.Rewards.NextUnsignedLong().ToString(),
};
var opts = new JsonSerializerOptions { WriteIndented = true };
Console.WriteLine(JsonSerializer.Serialize(new
{
    canon = SeedHelper.CanonicalizeSeed(" oi0k789m7xn0 "),
    seeds = outSeeds,
    save = saveSnippet,
}, opts));
