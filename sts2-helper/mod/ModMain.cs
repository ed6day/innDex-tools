using System.Reflection;
using MegaCrit.Sts2.Core.Combat;
using MegaCrit.Sts2.Core.Logging;
using MegaCrit.Sts2.Core.Modding;
using MegaCrit.Sts2.Core.Runs;
using STS2RitsuLib;
using STS2RitsuLib.Interop;

namespace STS2DecisionHelper;

[ModInitializer(nameof(Initialize))]
public static class ModMain
{
    public const string ModId = "STS2DecisionHelper";
    public static Logger Logger { get; private set; } = null!;

    public static void Initialize()
    {
        var assembly = Assembly.GetExecutingAssembly();
        Logger = RitsuLibFramework.CreateLogger(ModId);
        ModTypeDiscoveryHub.RegisterModAssembly(ModId, assembly);

        StateHttpClient.Initialize("http://localhost:3000");

        // ── Run lifecycle ──────────────────────────────────────────────────
        RitsuLibFramework.SubscribeLifecycle<RunStartedEvent>(OnRunStarted);
        RitsuLibFramework.SubscribeLifecycle<RunEndedEvent>(OnRunEnded);
        RitsuLibFramework.SubscribeLifecycle<RoomEnteredEvent>(OnRoomEntered);

        // ── Combat lifecycle ───────────────────────────────────────────────
        RitsuLibFramework.SubscribeLifecycle<CombatStartingEvent>(OnCombatStarting);
        RitsuLibFramework.SubscribeLifecycle<CombatEndedEvent>(OnCombatEnded);
        RitsuLibFramework.SubscribeLifecycle<CombatVictoryEvent>(OnCombatVictory);

        // ── Turn lifecycle ─────────────────────────────────────────────────
        RitsuLibFramework.SubscribeLifecycle<SideTurnStartingEvent>(OnTurnStarting);
        RitsuLibFramework.SubscribeLifecycle<SideTurnStartedEvent>(OnTurnStarted);

        // ── Card events ────────────────────────────────────────────────────
        RitsuLibFramework.SubscribeLifecycle<CardPlayedEvent>(OnCardPlayed);
        RitsuLibFramework.SubscribeLifecycle<CardDrawnEvent>(OnCardDrawn);

        Logger.Info($"[{ModId}] Initialised — streaming to http://localhost:3000");
    }

    // ── Run handlers ───────────────────────────────────────────────────────────

    private static void OnRunStarted(RunStartedEvent evt)
    {
        var runId = $"run-{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}";
        RunTracker.StartRun(runId, evt.RunState);
        _ = StateHttpClient.PostRunStartAsync(runId, RunTracker.Character, RunTracker.AscensionLevel);
        PostRunState("run_start", evt.RunState);
    }

    private static void OnRunEnded(RunEndedEvent evt)
    {
        if (RunTracker.CurrentRunId is null) return;
        var outcome = evt.IsVictory ? "win" : evt.IsAbandoned ? "abandoned" : "death";
        _ = StateHttpClient.PostRunEndAsync(
            RunTracker.CurrentRunId,
            outcome,
            GameStateSerializer.GetScoreFromRun(evt.Run),
            RunTracker.CurrentFloor,
            null,
            GameStateSerializer.GetRelicNamesFromRun(evt.Run));
        RunTracker.EndRun();
    }

    private static void OnRoomEntered(RoomEnteredEvent evt)
    {
        RunTracker.SetFloor(GameStateSerializer.GetFloor(evt.RunState));
        if (RunTracker.CurrentRunId is not null)
        {
            _ = StateHttpClient.PostDeckSnapshotAsync(
                RunTracker.CurrentRunId,
                RunTracker.CurrentFloor,
                "floor_entry",
                GameStateSerializer.GetFullDeck(evt.RunState));
        }
        PostRunState("room_entered", evt.RunState);
    }

    // ── Combat handlers ────────────────────────────────────────────────────────

    private static void OnCombatStarting(CombatStartingEvent evt)
    {
        var combatId = $"{RunTracker.CurrentRunId ?? "unknown"}-floor-{RunTracker.CurrentFloor}";
        CombatTracker.StartCombat(combatId, GameStateSerializer.GetPlayerHp(evt.RunState));
        _ = StateHttpClient.PostCombatStartAsync(
            combatId,
            RunTracker.Character,
            RunTracker.CurrentFloor,
            GameStateSerializer.GetEnemyNames(evt.RunState),
            CombatTracker.HpAtTurnStart);
        PostRunState("combat_start", evt.RunState);
    }

    private static void OnCombatEnded(CombatEndedEvent evt)
    {
        if (CombatTracker.CurrentCombatId is null) return;
        _ = StateHttpClient.PostCombatEndAsync(
            CombatTracker.CurrentCombatId,
            GameStateSerializer.GetPlayerHp(evt.RunState),
            "lose");
        CombatTracker.EndCombat();
        PostRunState("combat_end", evt.RunState);
    }

    private static void OnCombatVictory(CombatVictoryEvent evt)
    {
        if (CombatTracker.CurrentCombatId is null) return;
        _ = StateHttpClient.PostCombatEndAsync(
            CombatTracker.CurrentCombatId,
            GameStateSerializer.GetPlayerHp(evt.RunState),
            "win");
        CombatTracker.EndCombat();
        PostRunState("combat_victory", evt.RunState);
    }

    // ── Turn handlers ──────────────────────────────────────────────────────────

    private static void OnTurnStarting(SideTurnStartingEvent evt)
    {
        if (evt.Side != CombatSide.Player) return;
        // Use dynamic to bypass ICombatState reference missing from sts2 v0.103.2
        dynamic de = evt;
        object cs = de.CombatState;
        CombatTracker.StartTurn(
            GameStateSerializer.GetEnergy(cs),
            GameStateSerializer.GetPlayerHpFromCombat(cs),
            GameStateSerializer.GetBlockFromCombat(cs));
        PostCombatState("turn_start", cs);
    }

    private static void OnTurnStarted(SideTurnStartedEvent evt)
    {
        if (evt.Side != CombatSide.Player) return;
        dynamic de = evt;
        object cs = de.CombatState;
        PostCombatState("turn_ready", cs);
    }

    // ── Card handlers ──────────────────────────────────────────────────────────

    private static void OnCardPlayed(CardPlayedEvent evt)
    {
        CombatTracker.RecordCardPlayed(GameStateSerializer.GetCardId(evt.CardPlay));
        dynamic de = evt;
        object cs = de.CombatState;
        PostCombatState("card_played", cs);
    }

    private static void OnCardDrawn(CardDrawnEvent evt)
    {
        dynamic de = evt;
        object cs = de.CombatState;
        PostCombatState("card_drawn", cs);
    }

    // ── Shared helpers ─────────────────────────────────────────────────────────

    private static void PostRunState(string eventType, object runState)
    {
        try
        {
            var dto = GameStateSerializer.Serialize(
                runState,
                eventType,
                CombatTracker.CurrentCombatId ?? "",
                RunTracker.CurrentRunId ?? "");
            _ = StateHttpClient.PostStateAsync(dto);
        }
        catch (Exception ex)
        {
            Logger.Warn($"[{ModId}] State serialization error: {ex.Message}");
        }
    }

    private static void PostCombatState(string eventType, object combatState)
    {
        try
        {
            var dto = GameStateSerializer.SerializeCombat(
                combatState,
                eventType,
                CombatTracker.CurrentCombatId ?? "",
                RunTracker.CurrentRunId ?? "");
            _ = StateHttpClient.PostStateAsync(dto);
        }
        catch (Exception ex)
        {
            Logger.Warn($"[{ModId}] Combat state serialization error: {ex.Message}");
        }
    }
}
