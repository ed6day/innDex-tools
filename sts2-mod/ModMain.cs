// ╔══════════════════════════════════════════════════════════════════╗
// ║  STS2 Decision Helper — ModMain                                  ║
// ║  Built with ModSmith + RitsuLib for Slay the Spire 2             ║
// ║                                                                  ║
// ║  IMPORTANT: Hook names and event argument types are based on     ║
// ║  STS2 modding conventions. Verify exact names against the        ║
// ║  RitsuLib source before building:                                ║
// ║    https://github.com/BAKAOLC/STS2-RitsuLib                     ║
// ╚══════════════════════════════════════════════════════════════════╝

using STS2DecisionHelper.Models;

namespace STS2DecisionHelper;

[ModInitializer]
public class ModMain
{
    public static void Initialize()
    {
        StateHttpClient.Initialize("http://localhost:3000");

        // ── Run lifecycle ──────────────────────────────────────────
        RitsuLib.Events.OnRunStart   += OnRunStart;
        RitsuLib.Events.OnRunEnd     += OnRunEnd;
        RitsuLib.Events.OnFloorEntry += OnFloorEntry;

        // ── Combat lifecycle ───────────────────────────────────────
        RitsuLib.Events.OnCombatStart += OnCombatStart;
        RitsuLib.Events.OnCombatEnd   += OnCombatEnd;

        // ── Turn lifecycle ─────────────────────────────────────────
        RitsuLib.Events.OnTurnStart += OnTurnStart;
        RitsuLib.Events.OnTurnEnd   += OnTurnEnd;

        // ── Card events ────────────────────────────────────────────
        RitsuLib.Events.OnCardDrawn  += OnCardDrawn;
        RitsuLib.Events.OnCardPlayed += OnCardPlayed;

        // ── Enemy events ───────────────────────────────────────────
        RitsuLib.Events.OnEnemyIntentSet += OnEnemyIntentSet;
    }

    // ── Run handlers ──────────────────────────────────────────────────────────

    private static void OnRunStart(RunStartEvent e)
    {
        var runId = $"run-{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}";
        RunTracker.StartRun(runId, e.GameState.Player.CharacterName, e.AscensionLevel);
        _ = StateHttpClient.PostRunStartAsync(runId, RunTracker.Character, RunTracker.AscensionLevel);
        PostState("run_start", e.GameState);
    }

    private static void OnRunEnd(RunEndEvent e)
    {
        if (RunTracker.CurrentRunId is null) return;
        _ = StateHttpClient.PostRunEndAsync(
            RunTracker.CurrentRunId,
            e.Outcome.ToString().ToLowerInvariant(),
            e.Score,
            RunTracker.CurrentFloor,
            e.CauseOfDeath,
            e.GameState.Relics.Select(r => r.DisplayName));
        RunTracker.EndRun();
        PostState("run_end", e.GameState);
    }

    private static void OnFloorEntry(FloorEntryEvent e)
    {
        RunTracker.SetFloor(e.FloorNumber);
        if (RunTracker.CurrentRunId is not null)
        {
            _ = StateHttpClient.PostDeckSnapshotAsync(
                RunTracker.CurrentRunId,
                e.FloorNumber,
                "floor_entry",
                e.GameState.DrawPile
                    .Concat(e.GameState.Hand)
                    .Concat(e.GameState.DiscardPile)
                    .Select(c => GameStateSerializer.MapCardPublic(c)));
        }
        PostState("floor_entry", e.GameState);
    }

    // ── Combat handlers ───────────────────────────────────────────────────────

    private static void OnCombatStart(CombatStartEvent e)
    {
        var combatId = $"{RunTracker.CurrentRunId ?? "unknown"}-floor-{RunTracker.CurrentFloor}";
        var enemies  = e.GameState.Enemies.Select(en => en.DisplayName).ToList();
        CombatTracker.StartCombat(combatId, e.GameState.Player.CurrentHp);
        _ = StateHttpClient.PostCombatStartAsync(combatId, RunTracker.Character, RunTracker.CurrentFloor, enemies, e.GameState.Player.CurrentHp);
        PostState("combat_start", e.GameState);
    }

    private static void OnCombatEnd(CombatEndEvent e)
    {
        if (CombatTracker.CurrentCombatId is null) return;
        var outcome = e.Victory ? "win" : "lose";
        _ = StateHttpClient.PostCombatEndAsync(CombatTracker.CurrentCombatId, e.GameState.Player.CurrentHp, outcome);
        CombatTracker.EndCombat();
        PostState("combat_end", e.GameState);
    }

    // ── Turn handlers ─────────────────────────────────────────────────────────

    private static void OnTurnStart(TurnStartEvent e)
    {
        CombatTracker.StartTurn(e.GameState.Energy, e.GameState.Player.CurrentHp, e.GameState.Player.Block);
        PostState("turn_start", e.GameState);
    }

    private static void OnTurnEnd(TurnEndEvent e)
    {
        if (CombatTracker.CurrentCombatId is not null)
        {
            _ = StateHttpClient.PostTurnAsync(
                CombatTracker.CurrentCombatId,
                CombatTracker.CurrentTurn,
                CombatTracker.EnergyAtTurnStart,
                CombatTracker.EnergyUsed(e.GameState.Energy),
                CombatTracker.CardsPlayed,
                CombatTracker.BlockGained(e.GameState.Player.Block),
                CombatTracker.DamageDealt,
                CombatTracker.DamageTaken);
        }
        PostState("turn_end", e.GameState);
    }

    // ── Card handlers ─────────────────────────────────────────────────────────

    private static void OnCardDrawn(CardDrawnEvent e)
    {
        PostState("card_drawn", e.GameState);
    }

    private static void OnCardPlayed(CardPlayedEvent e)
    {
        CombatTracker.RecordCardPlayed(e.Card.CardId);
        if (e.Card.CardType.ToString() == "Attack")
            CombatTracker.RecordDamageDealt(e.DamageDealt);
        PostState("card_played", e.GameState);
    }

    // ── Enemy handlers ────────────────────────────────────────────────────────

    private static void OnEnemyIntentSet(EnemyIntentSetEvent e)
    {
        PostState("enemy_intent", e.GameState);
    }

    // ── Shared helper ─────────────────────────────────────────────────────────

    private static void PostState(string eventType, IGameState gs)
    {
        var dto = GameStateSerializer.Serialize(
            gs,
            eventType,
            CombatTracker.CurrentCombatId ?? "",
            RunTracker.CurrentRunId ?? "");
        _ = StateHttpClient.PostStateAsync(dto);
    }
}
