namespace STS2DecisionHelper.Models;

public class GameStateDto
{
    public string EventType    { get; init; } = "";
    public long   Timestamp    { get; init; }
    public string CombatId     { get; init; } = "";
    public string RunId        { get; init; } = "";
    public int    TurnNumber   { get; init; }
    public int    Energy       { get; init; }
    public int    MaxEnergy    { get; init; }
    public int    PlayerHp     { get; init; }
    public int    PlayerMaxHp  { get; init; }
    public int    Block        { get; init; }
    public int    FloorNumber  { get; init; }
    public string Character    { get; init; } = "";

    public List<CardDto>   Hand        { get; init; } = new();
    public List<CardDto>   DrawPile    { get; init; } = new();
    public List<CardDto>   DiscardPile { get; init; } = new();
    public List<CardDto>   ExhaustPile { get; init; } = new();
    public List<EnemyDto>  Enemies     { get; init; } = new();
    public List<string>    Relics      { get; init; } = new();
    public Dictionary<string, int> Powers { get; init; } = new();
}

public class CardDto
{
    public string Id       { get; init; } = "";
    public string Name     { get; init; } = "";
    public string Type     { get; init; } = "";  // Attack | Skill | Power | Curse | Status
    public int    Cost     { get; init; }         // -1 = X cost
    public int    Damage   { get; init; }
    public int    Block    { get; init; }
    public bool   Upgraded { get; init; }
}

public class EnemyDto
{
    public string Id          { get; init; } = "";
    public string Name        { get; init; } = "";
    public int    CurrentHp   { get; init; }
    public int    MaxHp       { get; init; }
    public string IntentType  { get; init; } = "Unknown";  // Attack | Defend | Block | Buff | Debuff | Unknown
    public int    IntentValue { get; init; }
    public Dictionary<string, int> Powers { get; init; } = new();
}
