using System.Reflection;
using MegaCrit.Sts2.Core.Logging;
using MegaCrit.Sts2.Core.Modding;
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
        PostState("run_start", evt.RunState);
    }

    private static void OnRunEnded(RunEndedEvent evt)
    {
        if (RunTracker.CurrentRunId is null) return;
        _ = StateHttpClient.PostRunEndAsync(
            RunTracker.CurrentRunId,
            GameStateSerializer.GetRunOutcome(evt),
            GameStateSerializer.GetScore(evt.RunState),
            RunTracker.CurrentFloor,
            GameStateSerializer.GetCauseOfDeath(evt),
            GameStateSerializer.GetRelicNames(evt.RunState));
        RunTracker.EndRun();
        PostState("run_end", evt.RunState);
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
        PostState("room_entered", evt.RunState);
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
            CombatTracker.StartHp);
        PostState("combat_start", evt.RunState);
    }

    private static void OnCombatEnded(CombatEndedEvent evt)
    {
        if (CombatTracker.CurrentCombatId is null) return;
        _ = StateHttpClient.PostCombatEndAsync(
            CombatTracker.CurrentCombatId,
            GameStateSerializer.GetPlayerHp(evt.RunState),
            "lose");
        CombatTracker.EndCombat();
        PostState("combat_end", evt.RunState);
    }

    private static void OnCombatVictory(CombatVictoryEvent evt)
    {
        if (CombatTracker.CurrentCombatId is null) return;
        _ = StateHttpClient.PostCombatEndAsync(
            CombatTracker.CurrentCombatId,
            GameStateSerializer.GetPlayerHp(evt.RunState),
            "win");
        CombatTracker.EndCombat();
        PostState("combat_victory", evt.RunState);
    }

    // ── Turn handlers ──────────────────────────────────────────────────────────

    private static void OnTurnStarting(SideTurnStartingEvent evt)
    {
        CombatTracker.StartTurn(
            GameStateSerializer.GetEnergy(evt.RunState),
            GameStateSerializer.GetPlayerHp(evt.RunState),
            GameStateSerializer.GetBlock(evt.RunState));
        PostState("turn_start", evt.RunState);
    }

    private static void OnTurnStarted(SideTurnStartedEvent evt)
    {
        // Hand is fully drawn at this point — send a second update
        PostState("turn_ready", evt.RunState);
    }

    // ── Card handlers ──────────────────────────────────────────────────────────

    private static void OnCardPlayed(CardPlayedEvent evt)
    {
        CombatTracker.RecordCardPlayed(GameStateSerializer.GetCardId(evt));
        PostState("card_played", evt.RunState);
    }

    private static void OnCardDrawn(CardDrawnEvent evt)
    {
        PostState("card_drawn", evt.RunState);
    }

    // ── Shared helper ──────────────────────────────────────────────────────────

    private static void PostState(string eventType, object runState)
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
            Logger.Warning($"[{ModId}] State serialization error: {ex.Message}");
        }
    }
}
