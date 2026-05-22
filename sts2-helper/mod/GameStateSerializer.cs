// ─────────────────────────────────────────────────────────────────────────────
// GameStateSerializer — maps STS2 RunState to our HTTP DTOs.
//
// HOW TO FILL THIS IN:
//   1. Build once to let the DLL reference resolve
//   2. Open the decompiled sts2.dll in ILSpy / dnSpy / Rider
//   3. Browse to the RunState / AbstractCreature / AbstractCard types
//   4. Replace every "TODO: ..." comment with the real property access
//
// The STS2 Modding MCP (https://github.com/elliotttate/sts2-modding-mcp)
// lets you browse decompiled game classes with AI assistance if you want
// a faster way to find the right property names.
// ─────────────────────────────────────────────────────────────────────────────

using STS2DecisionHelper.Models;

namespace STS2DecisionHelper;

public static class GameStateSerializer
{
    public static GameStateDto Serialize(object runState, string eventType, string combatId, string runId)
    {
        return new GameStateDto
        {
            EventType   = eventType,
            Timestamp   = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            CombatId    = combatId,
            RunId       = runId,
            TurnNumber  = GetTurnNumber(runState),
            Energy      = GetEnergy(runState),
            MaxEnergy   = GetMaxEnergy(runState),
            PlayerHp    = GetPlayerHp(runState),
            PlayerMaxHp = GetPlayerMaxHp(runState),
            Block       = GetBlock(runState),
            FloorNumber = GetFloor(runState),
            Character   = GetCharacterName(runState),
            Hand        = GetHand(runState),
            DrawPile    = GetDrawPile(runState),
            DiscardPile = GetDiscardPile(runState),
            ExhaustPile = GetExhaustPile(runState),
            Enemies     = GetEnemies(runState),
            Relics      = GetRelicNames(runState).ToList(),
            Powers      = GetPlayerPowers(runState),
        };
    }

    // ── Player state ──────────────────────────────────────────────────────────

    public static int GetPlayerHp(object runState)
    {
        // TODO: return ((RunState)runState).Player.CurrentHp;
        return 0;
    }

    public static int GetPlayerMaxHp(object runState)
    {
        // TODO: return ((RunState)runState).Player.MaxHp;
        return 0;
    }

    public static int GetBlock(object runState)
    {
        // TODO: return ((RunState)runState).Player.Block;
        return 0;
    }

    public static int GetEnergy(object runState)
    {
        // TODO: return ((RunState)runState).Player.Energy.Energy;
        return 0;
    }

    public static int GetMaxEnergy(object runState)
    {
        // TODO: return ((RunState)runState).Player.Energy.MaxEnergy;
        return 0;
    }

    public static int GetTurnNumber(object runState)
    {
        // TODO: return ((RunState)runState).CombatState?.TurnNumber ?? 0;
        return 0;
    }

    public static string GetCharacterName(object runState)
    {
        // TODO: return ((RunState)runState).Player.GetType().Name;
        return "";
    }

    public static int GetFloor(object runState)
    {
        // TODO: return ((RunState)runState).FloorNum;
        return 0;
    }

    public static int GetScore(object runState)
    {
        // TODO: return ((RunState)runState).Score;
        return 0;
    }

    // ── Card piles ────────────────────────────────────────────────────────────

    public static List<CardDto> GetHand(object runState)
    {
        // TODO: return ((RunState)runState).Player.Hand.Group.Select(MapCard).ToList();
        return new List<CardDto>();
    }

    public static List<CardDto> GetDrawPile(object runState)
    {
        // TODO: return ((RunState)runState).Player.DrawPile.Group.Select(MapCard).ToList();
        return new List<CardDto>();
    }

    public static List<CardDto> GetDiscardPile(object runState)
    {
        // TODO: return ((RunState)runState).Player.DiscardPile.Group.Select(MapCard).ToList();
        return new List<CardDto>();
    }

    public static List<CardDto> GetExhaustPile(object runState)
    {
        // TODO: return ((RunState)runState).Player.ExhaustPile.Group.Select(MapCard).ToList();
        return new List<CardDto>();
    }

    public static List<CardDto> GetFullDeck(object runState)
    {
        var all = new List<CardDto>();
        all.AddRange(GetHand(runState));
        all.AddRange(GetDrawPile(runState));
        all.AddRange(GetDiscardPile(runState));
        return all;
    }

    public static CardDto MapCardPublic(object card) => MapCard(card);

    private static CardDto MapCard(object card)
    {
        // TODO: cast to AbstractCard (or whatever the base card type is) and read properties
        // Example:
        //   var c = (AbstractCard)card;
        //   return new CardDto { Id = c.CardID, Name = c.Name, Type = c.Type.ToString(),
        //                        Cost = c.Cost, Damage = c.BaseDamage, Block = c.BaseBlock,
        //                        Upgraded = c.Upgraded };
        return new CardDto();
    }

    // ── Enemies ───────────────────────────────────────────────────────────────

    public static List<EnemyDto> GetEnemies(object runState)
    {
        // TODO: return ((RunState)runState).CombatState?.Monsters.Monsters.Select(MapEnemy).ToList()
        //            ?? new List<EnemyDto>();
        return new List<EnemyDto>();
    }

    public static IEnumerable<string> GetEnemyNames(object runState)
    {
        return GetEnemies(runState).Select(e => e.Name);
    }

    private static EnemyDto MapEnemy(object enemy)
    {
        // TODO: cast to AbstractMonster and read properties
        // Example:
        //   var e = (AbstractMonster)enemy;
        //   return new EnemyDto { Id = e.Id, Name = e.Name,
        //                         CurrentHp = e.CurrentHp, MaxHp = e.MaxHp,
        //                         IntentType = e.Intent.ToString(), IntentValue = e.IntentDmg };
        return new EnemyDto();
    }

    // ── Relics & powers ───────────────────────────────────────────────────────

    public static IEnumerable<string> GetRelicNames(object runState)
    {
        // TODO: return ((RunState)runState).Player.Relics.Select(r => r.Name);
        return Enumerable.Empty<string>();
    }

    public static Dictionary<string, int> GetPlayerPowers(object runState)
    {
        // TODO: return ((RunState)runState).Player.Powers.ToDictionary(p => p.Name, p => p.Amount);
        return new Dictionary<string, int>();
    }

    // ── Run-end helpers ───────────────────────────────────────────────────────

    public static string GetRunOutcome(RunEndedEvent evt)
    {
        // TODO: inspect evt to determine win/death/abandoned
        // Example: return evt.Victory ? "win" : "death";
        return "unknown";
    }

    public static string? GetCauseOfDeath(RunEndedEvent evt)
    {
        // TODO: return evt.KilledBy?.Name;
        return null;
    }

    // ── Card event helpers ────────────────────────────────────────────────────

    public static string GetCardId(CardPlayedEvent evt)
    {
        // TODO: return evt.Card.CardID;
        return "";
    }
}
