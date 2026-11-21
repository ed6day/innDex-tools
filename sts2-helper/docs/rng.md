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

## Rewards (lib/rewards.js)

Card pools in game order, rarities and unlock epochs are exported from the game's own
`ModelDb` into `lib/gamedata.json` (`cd tools/rng-harness && dotnet run -- data`). On top of that:

- **Neow.** The event has its own RNG, `runSeed + XxHash64("NEOW")`. It picks 1 drawback relic,
  then shuffles the positive pool (Lava Rock/Small Capsule, Oyster/Humidifier, Talisman/Pomander
  coin flips added) and takes 2. Massive Scroll is multiplayer-only; Kaleidoscope needs every
  character unlocked. Lost Coffer, Arcane Scroll, Phial Holster and Neow's Bones outcomes are
  computed from the player streams.
- **Fight rewards.** Rewards-stream order is potion-drop roll, gold (always one value), the
  potion if one dropped, then each card's rarity roll, pick and upgrade roll. Fight rewards use
  the pity offset saved as `card_rarity_odds_value`. Ascension 7+ ("Scarcity") lowers rare odds.
- **Relic pulls** (Large Capsule, relic rewards) also use the Rewards stream: one NextFloat
  for rarity (<0.5 common, <0.83 uncommon, else rare), then the front of that rarity's
  pre-shuffled bag (`relic_grab_bag` in the save). Each Neow option therefore gets its own
  "first fight if picked" forecast.
- Verified in game (seed `NWN2GVX68PT5`): the Neow options, the Neow's Bones result including
  the Large Capsule pulls (Vambrace, Tuning Fork), and the first two fights' card rewards.
- Not modelled: relics that change reward options (Dingy Rug, Prismatic Gem, Scroll Boxes),
  shops, transforms, and the random pickups of Lead Paperweight, Hefty Tablet, Silken Tress,
  Small Capsule, Fishing Rod, Kaleidoscope, New Leaf, Leafy Poultice and Scroll Boxes.

## Map, fights, events and shops (lib/route.js, Map tab)

At run start (UpFront stream) each act gets fixed, ordered lists of normal encounters, elites,
events and a boss; the save stores them with "visited" counters. The n-th normal fight of the
act is `normal_encounter_ids[visited + n]`, and likewise for elites. Events work the same way,
skipping ones already seen. Neow counts as the first event. The current act's map is in the
save (`acts[i].saved_map`).

The route simulator walks a planned path and consumes every stream in the game's order:
`?` rolls (UnknownMapPoint), fight rewards (Rewards, with the potion-drop odds carried
forward), elite relic pulls, treasure gold (Rewards) and chest relic (TreasureRoomRelics +
shared bag), and shop stock (Shops).

Shops: 2 relic rarity rolls; 3 relics from the **back** of the relic bag (price ×0.85–1.15);
3 potions (×0.95–1.05); 5 character cards (Attack, Attack, Skill, Skill, Power: rarity, pick,
upgrade roll, price); 2 colorless cards (Uncommon, Rare); then 1 character card on half-price
sale. Card removal costs 75 + 25 per removal, or 100 + 50 at Ascension 6+.

Events that can hand out rewards (27 of 73) are flagged, because what they use depends on the
option you pick. Forecasts after them are marked uncertain.

Verified in game (seed `2HZ7UB0D8KD2`): the Hefty Tablet choices, the first fight's cards and
potion after Hefty Tablet, the Fuzzy Wurm Crawler fight's cards, and the first `?` event.
Not yet verified: shop stock.

### Future acts

Later acts' maps aren't in the save until you arrive, but they're deterministic:
`StandardActMap.CreateFor` uses `Rng(runSeed, "act_{n}_map")`. The game's own generator is
run headless (`tools/rng-harness`, `map` mode, built on demand by `lib/mapgen.js`). The elite
count from Ascension 1+ ("Swarming Elites": round(5 × 1.6) = 8) is applied by hand. The act 2
map generated this way matched the game's map exactly (59/59 nodes). Routes chain across acts:
the RNG state at the end of one act's planned route (to the boss) starts the next. Act 3 has a
second boss at Ascension 10.

Boss fights give 3 rares (pity offset 0, resets afterwards). Verified: the act 1 boss reward
on seed `2HZ7UB0D8KD2` (Nightmare, Storm of Steel, Serpent Form, plus a potion). Gremlin fights
can steal gold; winning it back adds a gold reward that shifts later fights by one Rewards draw.

## Events (lib/events.js)

Each event gets its own RNG, `runSeed + playerSlot + XxHash64(event id)`, created when you
enter it. Rolls happen in the order `CalculateVars`, then `GenerateInitialOptions`, then the
option you pick. Gold amounts, relic rarities, the card Slippery Bridge offers, Tablet of
Truth's upgrades and transform results are fixed by the seed. Potions and cards granted by
events come from the player's Rewards stream.

The next event comes from the act's list, skipping events already seen and those whose
`IsAllowed` rule fails. Many rules are act-gated (Stone of All Time and Museum of Torture are
act 2 only), and others depend on gold, HP or potions, so the order is judged on your current
state.

Ported: every event that can appear in act 1. Validated against run histories: on game
builds 0.109 and later, every recorded This or That, Sunken Statue and Dense Vegetation gold
amount matches when that gold option was taken. Builds before 0.109 seeded events
differently.

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
