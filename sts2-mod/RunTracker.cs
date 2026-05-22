namespace STS2DecisionHelper;

public static class RunTracker
{
    public static string? CurrentRunId    { get; private set; }
    public static string  Character       { get; private set; } = "";
    public static int     AscensionLevel  { get; private set; }
    public static int     CurrentFloor    { get; private set; }

    public static void StartRun(string runId, object runState)
    {
        CurrentRunId   = runId;
        Character      = GameStateSerializer.GetCharacterName(runState);
        AscensionLevel = 0; // TODO: read from runState — e.g. ((RunState)runState).AscensionLevel
        CurrentFloor   = 0;
    }

    public static void SetFloor(int floor) => CurrentFloor = floor;

    public static void EndRun() => CurrentRunId = null;
}
