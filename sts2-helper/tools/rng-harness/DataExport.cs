using System.Reflection;
using System.Text.Json;
using MegaCrit.Sts2.Core.Entities.Cards;
using MegaCrit.Sts2.Core.Modding;
using MegaCrit.Sts2.Core.Models;
using MegaCrit.Sts2.Core.TestSupport;
using MegaCrit.Sts2.Core.Timeline;
using MegaCrit.Sts2.Core.Unlocks;

// Exports card / potion pool data (game order, rarity, unlock epochs) for lib/gamedata.json.
// ModelDb can be initialised headless; anything that logs (ModelIdSerializationCache,
// odds rolls) can't, because the logger calls into native Godot.
public static class DataExport
{
    static T Safe<T>(Func<T> f, T fallback) { try { return f(); } catch { return fallback; } }

    public static void Run()
    {
        TestMode.IsOn = true;
        typeof(ModManager).GetProperty("State", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic)!
            .SetValue(null, ModManagerState.Skipped);
        AssemblyInfo.Init();
        ModelDb.Init();

        var allEpochs = EpochModel.AllEpochIds.ToList();
        var everything = new UnlockState(allEpochs, Array.Empty<ModelId>(), 1);

        // A card/potion is gated by epoch E if it disappears when only E is locked.
        Dictionary<string, List<string>> GatesFor<T>(Func<UnlockState, IEnumerable<T>> unlocked, Func<T, string> id)
        {
            var full = unlocked(everything).Select(id).ToHashSet();
            var gates = full.ToDictionary(x => x, _ => new List<string>());
            foreach (var e in allEpochs)
            {
                var without = unlocked(new UnlockState(allEpochs.Where(x => x != e), Array.Empty<ModelId>(), 1)).Select(id).ToHashSet();
                foreach (var x in full.Where(x => !without.Contains(x))) gates[x].Add(e);
            }
            return gates;
        }

        var cardPools = new Dictionary<string, object>();
        foreach (var pool in ModelDb.AllCardPools)
        {
            var gates = GatesFor(u => pool.GetUnlockedCards(u, CardMultiplayerConstraint.None), (CardModel c) => c.Id.ToString());
            cardPools[pool.Id.Entry] = pool.AllCards.Select(c => new
            {
                id = c.Id.ToString(),
                rarity = c.Rarity.ToString(),
                type = c.Type.ToString(),
                mp = c.MultiplayerConstraint.ToString(),
                upgradable = c.IsUpgradable,
                cost = Safe(() => c.EnergyCost.CostsX ? -1 : (int)c.EnergyCost.Canonical, -2),
                removable = Safe(() => c.IsRemovable, true),
                transformable = Safe(() => c.IsTransformable, true),
                gates = gates.TryGetValue(c.Id.ToString(), out var g) ? g : null, // null = never unlocked here
            }).ToList();
        }

        var potionPools = new Dictionary<string, object>();
        foreach (var pool in ModelDb.AllPotionPools)
        {
            var gates = GatesFor(u => pool.GetUnlockedPotions(u), (PotionModel p) => p.Id.ToString());
            potionPools[pool.Id.Entry] = pool.AllPotions.Select(p => new
            {
                id = p.Id.ToString(),
                rarity = p.Rarity.ToString(),
                gates = gates.TryGetValue(p.Id.ToString(), out var g) ? g : null,
            }).ToList();
        }

        var relics = ModelDb.AllRelics.ToDictionary(r => r.Id.ToString(), r => new
        {
            rarity = r.Rarity.ToString(),
            tradable = Safe(() => r.IsTradable, false),
            inShops = Safe(() => r.IsAllowedInShops, true),
        });

        var characters = ModelDb.AllCharacters.ToDictionary(
            c => c.Id.ToString(),
            c => new { cardPool = c.CardPool.Id.Entry, potionPool = c.PotionPool.Id.Entry });

        Console.WriteLine(JsonSerializer.Serialize(new { epochs = allEpochs, characters, cardPools, potionPools, relics },
            new JsonSerializerOptions { WriteIndented = false }));
    }
}
