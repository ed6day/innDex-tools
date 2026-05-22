using STS2DecisionHelper.Models;

namespace STS2DecisionHelper;

// Maps RitsuLib game-state types to our DTOs.
// Property names here are GUESSES based on STS2 modding conventions —
// confirm against RitsuLib source before building:
//   https://github.com/BAKAOLC/STS2-RitsuLib
// The structure will not change; only the property access paths may differ.
public static class GameStateSerializer
{
    public static GameStateDto Serialize(
        IGameState gs,
        string eventType,
        string combatId,
        string runId)
    {
        return new GameStateDto
        {
            EventType   = eventType,
            Timestamp   = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            CombatId    = combatId,
            RunId       = runId,
            TurnNumber  = gs.TurnNumber,
            Energy      = gs.Energy,
            MaxEnergy   = gs.MaxEnergy,
            PlayerHp    = gs.Player.CurrentHp,
            PlayerMaxHp = gs.Player.MaxHp,
            Block       = gs.Player.Block,
            FloorNumber = gs.FloorNumber,
            Character   = gs.Player.CharacterName,

            Hand        = gs.Hand.Select(MapCard).ToList(),
            DrawPile    = gs.DrawPile.Select(MapCard).ToList(),
            DiscardPile = gs.DiscardPile.Select(MapCard).ToList(),
            ExhaustPile = gs.ExhaustPile.Select(MapCard).ToList(),
            Enemies     = gs.Enemies.Select(MapEnemy).ToList(),
            Relics      = gs.Relics.Select(r => r.DisplayName).ToList(),
            Powers      = gs.Player.Powers.ToDictionary(p => p.DisplayName, p => p.Amount),
        };
    }

    public static CardDto MapCardPublic(ICard c) => MapCard(c);

    private static CardDto MapCard(ICard c) => new()
    {
        Id       = c.CardId,
        Name     = c.DisplayName,
        Type     = c.CardType.ToString(),
        Cost     = c.EnergyCost,
        Damage   = c.BaseDamage,
        Block    = c.BaseBlock,
        Upgraded = c.IsUpgraded,
    };

    private static EnemyDto MapEnemy(IEnemy e) => new()
    {
        Id          = e.EnemyId,
        Name        = e.DisplayName,
        CurrentHp   = e.CurrentHp,
        MaxHp       = e.MaxHp,
        IntentType  = e.Intent?.Type.ToString() ?? "Unknown",
        IntentValue = e.Intent?.Value ?? 0,
        Powers      = e.Powers.ToDictionary(p => p.DisplayName, p => p.Amount),
    };
}
