namespace STS2DecisionHelper;

public static class RunTracker
{
    public static string? CurrentRunId       { get; private set; }
    public static string  Character          { get; private set; } = "";
    public static int     AscensionLevel     { get; private set; }
    public static int     CurrentFloor       { get; private set; }

    public static void StartRun(string runId, string character, int ascensionLevel)
    {
        CurrentRunId   = runId;
        Character      = character;
        AscensionLevel = ascensionLevel;
        CurrentFloor   = 0;
    }

    public static void SetFloor(int floor) => CurrentFloor = floor;

    public static void EndRun() => CurrentRunId = null;
}
