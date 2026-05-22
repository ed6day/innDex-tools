using System.Text;
using System.Text.Json;
using STS2DecisionHelper.Models;

namespace STS2DecisionHelper;

public static class StateHttpClient
{
    private static HttpClient? _http;
    private static string _baseUrl = "http://localhost:3000";

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public static void Initialize(string baseUrl = "http://localhost:3000")
    {
        _baseUrl = baseUrl.TrimEnd('/');
        _http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
    }

    public static async Task PostStateAsync(GameStateDto dto)
    {
        await PostJsonAsync("/api/sts2/state", new { eventType = dto.EventType, state = dto });
    }

    public static async Task PostCombatStartAsync(string combatId, string character, int floorNumber, IEnumerable<string> enemySet, int startHp)
    {
        await PostJsonAsync("/api/sts2/combat/start", new { combatId, character, floorNumber, enemySet, startHp });
    }

    public static async Task PostCombatEndAsync(string combatId, int endHp, string outcome)
    {
        await PostJsonAsync("/api/sts2/combat/end", new { combatId, endHp, outcome });
    }

    public static async Task PostTurnAsync(string combatId, int turnNumber, int energyAvailable, int energyUsed,
        IEnumerable<string> cardsPlayed, int blockGained, int damageDealt, int damageTaken)
    {
        await PostJsonAsync("/api/sts2/turn", new
        {
            combatId, turnNumber, energyAvailable, energyUsed,
            cardsPlayed, blockGained, damageDealt, damageTaken
        });
    }

    public static async Task PostRunStartAsync(string runId, string character, int ascensionLevel)
    {
        await PostJsonAsync("/api/sts2/run/start", new { runId, character, ascensionLevel });
    }

    public static async Task PostRunEndAsync(string runId, string outcome, int score, int floorReached,
        string? causeOfDeath, IEnumerable<string> relics)
    {
        await PostJsonAsync("/api/sts2/run/end", new { runId, outcome, score, floorReached, causeOfDeath, relics });
    }

    public static async Task PostDeckSnapshotAsync(string runId, int floor, string snapshotTrigger, IEnumerable<CardDto> deck)
    {
        await PostJsonAsync("/api/sts2/run/deck-snapshot", new { runId, floor, snapshotTrigger, deck });
    }

    private static async Task PostJsonAsync(string path, object payload)
    {
        if (_http is null) return;
        try
        {
            var json    = JsonSerializer.Serialize(payload, JsonOpts);
            var content = new StringContent(json, Encoding.UTF8, "application/json");
            await _http.PostAsync(_baseUrl + path, content).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            // RitsuLib.Logger.Warning($"[STS2DecisionHelper] HTTP error: {ex.Message}");
            _ = ex; // suppress until RitsuLib namespace is confirmed
        }
    }
}
