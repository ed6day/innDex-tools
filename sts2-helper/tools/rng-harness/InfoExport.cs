using System.Reflection;
using System.Text.Json;
using MegaCrit.Sts2.Core.Modding;
using MegaCrit.Sts2.Core.Models;
using MegaCrit.Sts2.Core.TestSupport;

// Exports the numbers behind card / relic / potion text (DynamicVars, base and upgraded) plus
// monster HP and each encounter's monsters, for the dashboard's hover cards (lib/info.json).
public static class InfoExport
{
    static T Safe<T>(Func<T> f, T fallback) { try { return f(); } catch { return fallback; } }

    static Dictionary<string, decimal> Vars(AbstractModel m) => Safe(() =>
    {
        dynamic d = m;
        var result = new Dictionary<string, decimal>();
        foreach (var kv in d.DynamicVars) result[(string)kv.Key] = (decimal)kv.Value.BaseValue;
        return result;
    }, new Dictionary<string, decimal>());

    public static void Run()
    {
        TestMode.IsOn = true;
        typeof(ModManager).GetProperty("State", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic)!
            .SetValue(null, ModManagerState.Skipped);
        AssemblyInfo.Init();
        ModelDb.Init();

        var cards = new Dictionary<string, object>();
        foreach (var c in ModelDb.AllCardPools.SelectMany(p => p.AllCards).Distinct())
        {
            var upgraded = Safe(() =>
            {
                var m = c.ToMutable();
                m.UpgradeInternal();
                return Vars(m);
            }, null as Dictionary<string, decimal>);
            cards[c.Id.ToString()] = new
            {
                vars = Vars(c),
                upgraded,
                cost = Safe(() => c.EnergyCost.CostsX ? -1 : (int)c.EnergyCost.Canonical, -2),
                type = c.Type.ToString(),
                rarity = c.Rarity.ToString(),
                pool = Safe(() => c.Pool.Id.Entry, ""),
            };
        }

        var relics = ModelDb.AllRelics.ToDictionary(r => r.Id.ToString(), r => new { vars = Vars(r), rarity = r.Rarity.ToString() });
        var potions = ModelDb.AllPotionPools.SelectMany(p => p.AllPotions).Distinct()
            .ToDictionary(p => p.Id.ToString(), p => new { vars = Vars(p), rarity = p.Rarity.ToString() });
        var monsters = ModelDb.AllEncounters.SelectMany(e => Safe(() => e.AllPossibleMonsters.ToList(), new List<MonsterModel>()))
            .Distinct().ToDictionary(m => m.Id.ToString(), m => new { minHp = Safe(() => m.MinInitialHp, 0), maxHp = Safe(() => m.MaxInitialHp, 0) });
        var encounters = ModelDb.AllEncounters.ToDictionary(e => e.Id.ToString(), e => new
        {
            roomType = e.RoomType.ToString(),
            monsters = Safe(() => e.AllPossibleMonsters.Select(m => m.Id.ToString()).ToList(), new List<string>()),
            minGold = Safe(() => e.MinGoldReward, 0),
            maxGold = Safe(() => e.MaxGoldReward, 0),
        });

        Console.WriteLine(JsonSerializer.Serialize(new { cards, relics, potions, monsters, encounters }));
    }
}
