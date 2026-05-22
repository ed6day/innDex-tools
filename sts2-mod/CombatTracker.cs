namespace STS2DecisionHelper;

// Accumulates per-turn state between hook calls without blocking the game loop.
public static class CombatTracker
{
    public static string? CurrentCombatId  { get; private set; }
    public static int     CurrentTurn      { get; private set; }
    public static int     EnergyAtTurnStart { get; private set; }
    public static int     HpAtTurnStart    { get; private set; }
    public static int     BlockAtTurnStart  { get; private set; }

    private static readonly List<string> _cardsPlayedThisTurn = new();
    private static int _damageDealtThisTurn;
    private static int _damageTakenThisTurn;

    public static IReadOnlyList<string> CardsPlayed => _cardsPlayedThisTurn.AsReadOnly();
    public static int DamageDealt   => _damageDealtThisTurn;
    public static int DamageTaken   => _damageTakenThisTurn;

    public static void StartCombat(string id, int startHp)
    {
        CurrentCombatId   = id;
        CurrentTurn       = 0;
        HpAtTurnStart     = startHp;
        _cardsPlayedThisTurn.Clear();
        _damageDealtThisTurn = 0;
        _damageTakenThisTurn = 0;
    }

    public static void StartTurn(int energyAvailable, int currentHp, int currentBlock)
    {
        CurrentTurn++;
        EnergyAtTurnStart = energyAvailable;
        HpAtTurnStart     = currentHp;
        BlockAtTurnStart  = currentBlock;
        _cardsPlayedThisTurn.Clear();
        _damageDealtThisTurn = 0;
        _damageTakenThisTurn = 0;
    }

    public static void RecordCardPlayed(string cardId)    => _cardsPlayedThisTurn.Add(cardId);
    public static void RecordDamageDealt(int amount)      => _damageDealtThisTurn += amount;
    public static void RecordDamageTaken(int amount)      => _damageTakenThisTurn += amount;

    public static int EnergyUsed(int currentEnergy)       => EnergyAtTurnStart - currentEnergy;
    public static int BlockGained(int currentBlock)        => currentBlock - BlockAtTurnStart;

    public static void EndCombat() => CurrentCombatId = null;
}
