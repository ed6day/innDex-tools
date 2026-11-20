using STS2DecisionHelper.Models;

namespace STS2DecisionHelper;

public static class GameStateSerializer
{
    // ── Entry points ──────────────────────────────────────────────────────────

    public static GameStateDto Serialize(object runStateObj, string eventType, string combatId, string runId)
    {
        var player = GetPlayerFromRunState(runStateObj);
        return Build(eventType, combatId, runId,
            player,
            GetFloor(runStateObj),
            GetTurnNumberFromRunState(runStateObj));
    }

    public static GameStateDto SerializeCombat(object cs, string eventType, string combatId, string runId)
    {
        object? player = null;
        try { dynamic dc = cs; player = dc.LocalPlayer; } catch { }
        return Build(eventType, combatId, runId,
            player,
            RunTracker.CurrentFloor,
            GetTurnNumber(cs));
    }

    private static GameStateDto Build(
        string eventType, string combatId, string runId,
        object? player, int floorNumber, int turnNumber)
    {
        int playerHp = 0, playerMaxHp = 0, block = 0;
        var hand        = new List<CardDto>();
        var drawPile    = new List<CardDto>();
        var discardPile = new List<CardDto>();
        var exhaustPile = new List<CardDto>();
        var relics      = new List<string>();
        var powers      = new Dictionary<string, int>();

        if (player != null)
        {
            dynamic dp = player;
            try { playerHp   = (int)dp.CurrentHp; } catch { }
            try { playerMaxHp = (int)dp.MaxHp; }    catch { }
            try { block       = (int)dp.Block; }     catch { }
            try { hand        = GetCardList(dp.Hand); }        catch { }
            try { drawPile    = GetCardList(dp.DrawPile); }    catch { }
            try { discardPile = GetCardList(dp.DiscardPile); } catch { }
            try { exhaustPile = GetCardList(dp.ExhaustPile); } catch { }
            relics = GetRelicNames(player).ToList();
            powers = GetPlayerPowers(player);
        }

        return new GameStateDto
        {
            EventType   = eventType,
            Timestamp   = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            CombatId    = combatId,
            RunId       = runId,
            TurnNumber  = turnNumber,
            Energy      = GetPlayerEnergy(player),
            MaxEnergy   = GetPlayerMaxEnergy(player),
            PlayerHp    = playerHp,
            PlayerMaxHp = playerMaxHp,
            Block       = block,
            FloorNumber = floorNumber,
            Character   = RunTracker.Character,
            Hand        = hand,
            DrawPile    = drawPile,
            DiscardPile = discardPile,
            ExhaustPile = exhaustPile,
            Enemies     = new(),
            Relics      = relics,
            Powers      = powers,
        };
    }

    // ── Player state ──────────────────────────────────────────────────────────

    private static object? GetPlayerFromRunState(object runStateObj)
    {
        try { dynamic rs = runStateObj; return rs.LocalPlayer; } catch { return null; }
    }

    public static int GetPlayerHp(object runStateObj)
    {
        var p = GetPlayerFromRunState(runStateObj);
        if (p == null) return 0;
        try { return (int)((dynamic)p).CurrentHp; } catch { return 0; }
    }

    public static int GetPlayerHpFromCombat(object cs)
    {
        try { dynamic dc = cs; return (int)dc.LocalPlayer.CurrentHp; } catch { return 0; }
    }

    public static int GetBlockFromCombat(object cs)
    {
        try { dynamic dc = cs; return (int)dc.LocalPlayer.Block; } catch { return 0; }
    }

    private static int GetPlayerEnergy(object? player)
    {
        if (player == null) return 0;
        try { dynamic e = ((dynamic)player).Energy; return (int)e.Energy; } catch { return 0; }
    }

    private static int GetPlayerMaxEnergy(object? player)
    {
        if (player == null) return 0;
        try { dynamic e = ((dynamic)player).Energy; return (int)e.MaxEnergy; } catch { }
        try { return (int)((dynamic)player).MaxEnergy; } catch { return 0; }
    }

    public static int GetEnergy(object cs)
    {
        try { dynamic dc = cs; return GetPlayerEnergy(dc.LocalPlayer); } catch { return 0; }
    }

    public static int GetFloor(object runStateObj)
    {
        try { dynamic rs = runStateObj; return (int)rs.FloorNum; } catch { return 0; }
    }

    public static int GetScore(object runStateObj)
    {
        try { dynamic rs = runStateObj; return (int)rs.Score; } catch { return 0; }
    }

    public static string GetCharacterName(object runStateObj)
    {
        try { dynamic rs = runStateObj; return (string)(rs.LocalPlayer?.CharacterId ?? ""); }
        catch { return ""; }
    }

    private static int GetTurnNumberFromRunState(object runStateObj)
    {
        try { dynamic rs = runStateObj; return GetTurnNumber(rs.CombatState); } catch { return 0; }
    }

    private static int GetTurnNumber(object? cs)
    {
        try { dynamic dc = cs; return (int)dc.TurnsTaken; } catch { return 0; }
    }

    // ── Card piles ────────────────────────────────────────────────────────────

    private static List<CardDto> GetCardList(object? pile)
    {
        if (pile == null) return new();
        try
        {
            dynamic p = pile;
            var result = new List<CardDto>();
            foreach (var card in p.Cards)
                result.Add(MapCard(card));
            return result;
        }
        catch { return new(); }
    }

    public static List<CardDto> GetHand(object runStateObj)
    {
        var p = GetPlayerFromRunState(runStateObj);
        if (p == null) return new();
        try { dynamic dp = p; return GetCardList(dp.Hand); } catch { return new(); }
    }

    public static List<CardDto> GetDrawPile(object runStateObj)
    {
        var p = GetPlayerFromRunState(runStateObj);
        if (p == null) return new();
        try { dynamic dp = p; return GetCardList(dp.DrawPile); } catch { return new(); }
    }

    public static List<CardDto> GetDiscardPile(object runStateObj)
    {
        var p = GetPlayerFromRunState(runStateObj);
        if (p == null) return new();
        try { dynamic dp = p; return GetCardList(dp.DiscardPile); } catch { return new(); }
    }

    public static List<CardDto> GetExhaustPile(object runStateObj)
    {
        var p = GetPlayerFromRunState(runStateObj);
        if (p == null) return new();
        try { dynamic dp = p; return GetCardList(dp.ExhaustPile); } catch { return new(); }
    }

    public static List<CardDto> GetFullDeck(object runStateObj)
    {
        var all = new List<CardDto>();
        all.AddRange(GetHand(runStateObj));
        all.AddRange(GetDrawPile(runStateObj));
        all.AddRange(GetDiscardPile(runStateObj));
        return all;
    }

    private static CardDto MapCard(object? card)
    {
        if (card == null) return new CardDto();
        try
        {
            dynamic c = card;
            int cost;
            try { cost = (bool)c.CostsX ? -1 : (int)c.CanonicalEnergyCost; }
            catch { try { cost = (int)c.Cost; } catch { cost = 0; } }

            string type;
            try { type = c.Type.ToString(); } catch { type = ""; }

            int dmg;
            try { dmg = (int)c.BaseDamage; } catch { dmg = 0; }

            int blk;
            try { blk = (int)c.Block; } catch { blk = 0; }

            bool upgraded;
            try { upgraded = (bool)c.Upgraded; } catch { try { upgraded = (bool)c.IsUpgraded; } catch { upgraded = false; } }

            string id;
            try { id = c.Id.ToString(); } catch { id = ""; }

            string name;
            try { name = (string)c.Name; } catch { name = ""; }

            return new CardDto { Id = id, Name = name, Type = type, Cost = cost, Damage = dmg, Block = blk, Upgraded = upgraded };
        }
        catch { return new CardDto(); }
    }

    public static string GetCardId(object cardPlay)
    {
        try { dynamic cp = cardPlay; return cp.Card.Id.ToString(); }
        catch { return ""; }
    }

    // ── Enemies ───────────────────────────────────────────────────────────────

    public static List<EnemyDto> GetEnemies(object runStateObj)
    {
        try { dynamic rs = runStateObj; return MapEnemies(rs.CombatState?.Monsters?.Monsters); }
        catch { return new(); }
    }

    public static List<EnemyDto> GetEnemiesFromCombat(object cs)
    {
        try { dynamic dc = cs; return MapEnemies(dc.Monsters?.Monsters); } catch { return new(); }
    }

    private static List<EnemyDto> MapEnemies(object? monsters)
    {
        if (monsters == null) return new();
        try
        {
            var result = new List<EnemyDto>();
            foreach (var m in (System.Collections.IEnumerable)monsters)
                result.Add(MapEnemy(m));
            return result;
        }
        catch { return new(); }
    }

    private static EnemyDto MapEnemy(object? monster)
    {
        if (monster == null) return new EnemyDto();
        try
        {
            dynamic e = monster;

            string id;   try { id   = e.Id.ToString(); }  catch { id   = ""; }
            string name; try { name = (string)e.Name; }   catch { name = ""; }
            int hp;      try { hp   = (int)e.CurrentHp; } catch { hp   = 0; }
            int maxHp;   try { maxHp = (int)e.MaxHp; }    catch { maxHp = 0; }
            int block;   try { block = (int)e.Block; }     catch { block = 0; }

            string intentType = "Unknown";
            int    intentVal  = 0;
            try
            {
                var intent = ((System.Collections.IEnumerable)e.Intents).Cast<object>().FirstOrDefault();
                if (intent != null)
                {
                    dynamic di = intent;
                    try { intentType = di.IntentType.ToString(); } catch { }
                    try { intentVal  = (int)di.Damage; } catch { try { intentVal = (int)di.BaseDamage; } catch { } }
                }
            }
            catch { }

            var powers = new Dictionary<string, int>();
            try
            {
                foreach (var p in (System.Collections.IEnumerable)e.Powers)
                {
                    try { dynamic dp = p; powers[dp.Name.ToString()] = (int)dp.Amount; } catch { }
                }
            }
            catch { }

            return new EnemyDto
            {
                Id = id, Name = name, CurrentHp = hp, MaxHp = maxHp,
                IntentType = intentType, IntentValue = intentVal, Powers = powers,
            };
        }
        catch { return new EnemyDto(); }
    }

    public static IEnumerable<string> GetEnemyNames(object runStateObj)
        => GetEnemies(runStateObj).Select(e => e.Name);

    // ── Relics & powers ───────────────────────────────────────────────────────

    public static IEnumerable<string> GetRelicNames(object player)
    {
        try
        {
            var result = new List<string>();
            dynamic dp = player;
            foreach (var r in (System.Collections.IEnumerable)dp.Relics)
            {
                try { dynamic dr = r; result.Add(dr.Name.ToString()); } catch { }
            }
            return result;
        }
        catch { return Enumerable.Empty<string>(); }
    }

    public static Dictionary<string, int> GetPlayerPowers(object player)
    {
        try
        {
            var result = new Dictionary<string, int>();
            dynamic dp = player;
            foreach (var p in (System.Collections.IEnumerable)dp.Powers)
            {
                try { dynamic dpow = p; result[dpow.Name.ToString()] = (int)dpow.Amount; } catch { }
            }
            return result;
        }
        catch { return new(); }
    }

    // ── Run-end helpers ───────────────────────────────────────────────────────

    public static int GetScoreFromRun(object serializableRun)
    {
        try { dynamic r = serializableRun; return (int)r.Score; } catch { return 0; }
    }

    public static IEnumerable<string> GetRelicNamesFromRun(object serializableRun)
    {
        try
        {
            dynamic r = serializableRun;
            var result = new List<string>();
            foreach (var relic in (System.Collections.IEnumerable)r.Relics)
            {
                try { dynamic dr = relic; result.Add(dr.Name.ToString()); } catch { }
            }
            return result;
        }
        catch { return Enumerable.Empty<string>(); }
    }
}
