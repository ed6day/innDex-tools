using System.Reflection;
using System.Text.Json;
using MegaCrit.Sts2.Core.Helpers;
using MegaCrit.Sts2.Core.Map;
using MegaCrit.Sts2.Core.Modding;
using MegaCrit.Sts2.Core.Models;
using MegaCrit.Sts2.Core.Random;
using MegaCrit.Sts2.Core.TestSupport;

// Generates an act map with the game's own StandardActMap, in current_run.save's saved_map shape.
// Usage: map <seed> <actIndex> <actId e.g. ACT.HIVE> <ascension> <players> <hasSecondBoss 0|1>
// Mirrors StandardActMap.CreateFor: Rng(runSeed, "act_{n}_map"). Ascension-dependent counts
// (Swarming Elites) are applied by hand because headless RunManager reports no run in progress.
public static class MapExport
{
    static readonly Dictionary<MapPointType, string> TypeNames = new()
    {
        [MapPointType.Monster] = "monster", [MapPointType.Elite] = "elite", [MapPointType.Unknown] = "unknown",
        [MapPointType.RestSite] = "rest_site", [MapPointType.Shop] = "shop", [MapPointType.Treasure] = "treasure",
        [MapPointType.Boss] = "boss", [MapPointType.Ancient] = "ancient",
    };

    public static void Run(string[] args)
    {
        string seed = args[1];
        int actIndex = int.Parse(args[2]);
        string actId = args[3];
        int ascension = int.Parse(args[4]);
        bool multiplayer = int.Parse(args[5]) > 1;
        bool secondBoss = args[6] == "1";

        TestMode.IsOn = true;
        typeof(ModManager).GetProperty("State", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic)!
            .SetValue(null, ModManagerState.Skipped);
        AssemblyInfo.Init();
        ModelDb.Init();

        var act = ModelDb.GetById<ActModel>(ModelId.Deserialize(actId));
        var rng = new Rng(StringHelper.GetDeterministicHashCode(seed), $"act_{actIndex + 1}_map");
        var counts = act.GetMapPointTypes(rng);
        int elites = (int)Math.Round(5f * (ascension >= 1 ? 1.6f : 1f)); // AscensionLevel.SwarmingElites = 1
        typeof(MapPointTypeCounts).GetField("<NumOfElites>k__BackingField", BindingFlags.Instance | BindingFlags.NonPublic)!
            .SetValue(counts, elites);
        var map = new StandardActMap(rng, act, multiplayer, false, secondBoss, counts);

        object Point(MapPoint p) => new
        {
            coord = new { col = p.coord.col, row = p.coord.row },
            type = TypeNames.TryGetValue(p.PointType, out var t) ? t : p.PointType.ToString().ToLowerInvariant(),
            children = p.Children.Select(c => new { col = c.coord.col, row = c.coord.row }).ToList(),
        };

        var points = map.GetAllMapPoints()
            .Where(p => p != map.StartingMapPoint && p != map.BossMapPoint && p != map.SecondBossMapPoint)
            .Select(Point).ToList();
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            width = map.GetColumnCount(),
            height = map.GetRowCount(),
            start = Point(map.StartingMapPoint),
            boss = Point(map.BossMapPoint),
            second_boss = map.SecondBossMapPoint == null ? null : Point(map.SecondBossMapPoint),
            points,
        }));
    }
}
