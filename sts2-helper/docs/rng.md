# How Slay the Spire 2 randomness works

Reverse-engineered from the game's own `sts2.dll` (build v0.113.1, decompiled with ILSpy).
`lib/rng.js` is a bit-exact JavaScript port; `test/rng.test.js` checks it against values
produced by the game's own classes (see "Re-validating after a game patch").

## From seed to random numbers

```
"DZFE623V9B8T"                       seed shown top-right in game (alphabet 0-9 A-Z minus I, O)
   │  XxHash64(UTF-8 bytes, seed 0)
   ▼
run seed (u64)
   │  + XxHash64("shuffle")            one named stream per purpose (snake_case enum name)
   ▼
stream seed (u64)
   │  SplitMix64 ×4
   ▼
xoshiro256** state (s0..s3)  ──►  NextDouble = (next >> 11) · 2⁻⁵³
                                   NextInt(n) = (int)(NextDouble · n)
                                   NextFloat  = (float)NextDouble
```

Typed seeds are canonicalised first: upper-cased, `O`→`0`, `I`→`1`, trimmed.
Seeds beginning `old` use a legacy string hash for the run streams only.

## The 16 streams

Every stream is independent, so using one never shifts another — e.g. drinking a potion
can't change your card rewards, and how you fight can't change which monsters you'll meet.

| Owner  | Stream                   | Drives |
|--------|--------------------------|--------|
| run    | `up_front`               | Generated at run start: maps, encounters, events, relic offers |
| run    | `shuffle`                | Every draw-pile shuffle; random-position card inserts |
| run    | `unknown_map_point`      | What a `?` room becomes |
| run    | `combat_card_generation` | Cards created in combat (Attack Potion…) |
| run    | `combat_potion_generation` | Potions created in combat |
| run    | `combat_card_selection`  | Random card picks in combat (True Grit…) |
| run    | `combat_energy_costs`    | Random costs (Confusion, Snecko Eye) |
| run    | `combat_targets`         | Random targeting |
| run    | `monster_ai`             | Random monster moves |
| run    | `niche`                  | One-off modifiers |
| run    | `combat_orbs`            | Random orbs |
| run    | `treasure_room_relics`   | Multiplayer treasure tie-breaks |
| player | `rewards`                | Card/potion rewards, potion drop chance |
| player | `shops`                  | Shop stock |
| player | `transformations`        | Transform results |
| player | `non_combat_generation`  | Out-of-combat generation |

Player streams are seeded from `XxHash64(seed) + playerSlot` (slot 0 in single player).

## What the helper predicts (Seed tab)

- **`?` rooms.** Each `?` uses exactly one `NextFloat` of `unknown_map_point`. Base odds are
  Monster 10%, Treasure 2%, Shop 3%, the rest Event. The type rolled resets to base; every
  other type's odds grow by its base value. So the n-th `?` of the run is fixed by the seed.
  Not modelled yet: relics that change these odds, and the first-ever-run tutorial override.
- **Next fight's opening hand.** Combat start shuffles the deck (in save order) with one
  `shuffle` value as a child seed (Fisher–Yates from the back). Then Imbued cards go to the
  bottom, Innate cards to the top. Each mid-fight reshuffle sorts the pile first
  (card id, upgrade, enchantment) and shuffles with the next `shuffle` value.
- **Stream table.** How many numbers each stream has used and the next five values.

## Why the save file matters

`current_run.save` stores every stream's live state (`counter`, `s0..s3`) and the `?` odds.
The game writes it on entering a room — *before* rolling the room type and before setting
up combat — and again after each fight or event. Starting from that state makes the
forecasts exact; the seed alone only gives the state at run start.

The u64 states are bare JSON numbers above 2⁵³, so the server parses with
`parseJsonBigSafe` instead of `JSON.parse`, which would silently round them.

## Validation

- `npm test`: 21 tests. Every stream for six seeds (including a legacy `old` seed and a
  >32-byte seed) matches the game's own output, as does save-format parsing.
- Live run, seed `DZFE623V9B8T`: the seed-only forecast said the first two `?` rooms would be
  Event, Event; the game gave Sunken Statue and This or That. The odds the game then saved
  (0.3 / 0.06 / 0.089999996 / −3) match the forecast to the last float bit.
- Still to confirm in game: the opening-hand forecast (it depends on save deck order matching
  in-game deck order).

## Re-validating after a game patch

```
cd tools/rng-harness
dotnet run -c Release > ../../test/rng-vectors.json
cd ../..
npm test
```

Remove any Sentry log line printed above the JSON before running the tests. If the tests fail,
decompile `sts2.dll` and diff `MegaCrit.Sts2.Core.Random/*`, `RunRngSet`, `ListExtensions`
and `UnknownMapPointOdds`.
