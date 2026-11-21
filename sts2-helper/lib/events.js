// "?" event forecasts, ported per event from MegaCrit.Sts2.Core.Models.Events (v0.113.1).
// Every event gets its own Rng = runSeed + playerSlot + XxHash64(event id) (EventModel.BeginEvent),
// so its rolls are fixed by the seed. Draw order inside an event: CalculateVars, then
// GenerateInitialOptions, then the chosen option. Options are computed on separate clones.
const { Rng, xxHash64 } = require('./rng');
const R = require('./rewards');
const DATA = require('./gamedata.json');

const MASK64 = (1n << 64n) - 1n;

// ── Card lookups ──────────────────────────────────────────────────────────────

const CARD_INFO = {};
for (const [pool, cards] of Object.entries(DATA.cardPools)) {
  for (const c of cards) if (!CARD_INFO[c.id]) CARD_INFO[c.id] = { ...c, pool };
}
const info = id => CARD_INFO[id] || { id, rarity: 'Common', removable: true, transformable: true, upgradable: true };
const tradable = id => DATA.relics?.[id]?.tradable ?? false;

// Character card pools you've unlocked (UnlockState.CharacterCardPools).
const CHARACTER_UNLOCK = { IRONCLAD_CARD_POOL: null, SILENT_CARD_POOL: 'SILENT1_EPOCH', REGENT_CARD_POOL: 'REGENT1_EPOCH',
  NECROBINDER_CARD_POOL: 'NECROBINDER1_EPOCH', DEFECT_CARD_POOL: 'DEFECT1_EPOCH', FOOL_CARD_POOL: 'FOOL1_EPOCH' };
const unlockedCharacterPools = epochs => Object.entries(CHARACTER_UNLOCK).filter(([, e]) => !e || epochs.has(e)).map(([p]) => p);

// CardFactory.GetDefaultTransformationOptions + GetFilteredTransformationOptions.
function transformOptions(ctx, cardId) {
  const c = info(cardId);
  const special = ['Event', 'Ancient', 'Token', 'Quest'].includes(c.rarity) || c.type === 'Quest';
  const pool = special ? 'COLORLESS_CARD_POOL' : c.pool;
  let opts = R.unlockedCards(ctx, pool);
  if (!['Status', 'Curse'].includes(c.rarity)) opts = opts.filter(o => ['Common', 'Uncommon', 'Rare'].includes(o.rarity));
  return opts.filter(o => o.id !== cardId);
}

// "Transform a card of your choice": the result for each distinct card you could pick.
function transformPreview(ctx, rng, deck) {
  const seen = new Set();
  const out = [];
  for (const card of deck) {
    // Unremovable cards (Ascender's Bane, Folly...) aren't offered for transforms either.
    if (seen.has(card.id) || !info(card.id).transformable || !info(card.id).removable) continue;
    seen.add(card.id);
    const r = rng.clone();
    out.push({ from: card.id, to: r.nextItem(transformOptions(ctx, card.id))?.id });
  }
  return out;
}

// ── Eligibility (EventModel.IsAllowed overrides) ──────────────────────────────

// st: { act, gold, hp, maxHp, potions: [ids], deck: [cards], totalFloor }
// Returns true/false; `needs` explains state-dependent rules.
const RULES = {
  AMALGAMATOR: { ok: st => st.deck.filter(c => /^CARD\.STRIKE_/.test(c.id)).length >= 2 && st.deck.filter(c => /^CARD\.DEFEND_/.test(c.id)).length >= 2, needs: '2+ Strikes and 2+ Defends' },
  BRAIN_LEECH: { ok: st => st.act < 2 },
  COLOSSAL_FLOWER: { ok: st => st.hp >= 19, needs: 'HP 19+' },
  CRYSTAL_SPHERE: { ok: st => st.gold >= 100 && st.act > 0, needs: '100+ gold' },
  DOLL_ROOM: { ok: st => st.act === 1 },
  ENDLESS_CONVEYOR: { ok: st => st.gold >= 120, needs: '120+ gold' },
  FAKE_MERCHANT: { ok: st => st.act >= 1 && (st.gold >= 100 || st.potions.includes('POTION.FOUL_POTION')), needs: '100+ gold' },
  LUMINOUS_CHOIR: { ok: st => st.gold >= 149, needs: 'gold ≥ the tribute (100–149)' },
  MORPHIC_GROVE: { ok: st => st.gold >= 100 && st.deck.filter(c => info(c.id).transformable).length >= 2, needs: '100+ gold' },
  MUSEUM_OF_TORTURE: { ok: st => st.act === 1 },
  POTION_COURIER: { ok: st => st.act > 0 },
  PUNCH_OFF: { ok: st => st.totalFloor >= 6 },
  RANWID_THE_ELDER: { ok: st => st.act > 0 && st.gold >= 100 && st.potions.length > 0 && st.relics.some(tradable), needs: '100+ gold, a potion' },
  RELIC_TRADER: { ok: st => st.act > 0 && st.relics.filter(tradable).length >= 5, needs: '5+ tradable relics' },
  COLORFUL_PHILOSOPHERS: { ok: st => unlockedCharacterPools(st.epochs).filter(p => p !== 'FOOL_CARD_POOL').length > 1 },
  ROOM_FULL_OF_CHEESE: { ok: st => st.act < 2 },
  ROUND_TEA_PARTY: { ok: st => st.hp >= 12, needs: 'HP 12+' },
  SLIPPERY_BRIDGE: { ok: st => st.totalFloor > 6 && st.deck.some(c => info(c.id).removable), needs: 'floor 7+' },
  STONE_OF_ALL_TIME: { ok: st => st.act === 1 && st.potions.length > 0 },
  SYMBIOTE: { ok: st => st.act > 0 },
  TEA_MASTER: { ok: st => st.act < 2 && st.gold >= 150, needs: '150+ gold' },
  THE_FUTURE_OF_POTIONS: { ok: st => st.potions.length >= 2, needs: '2+ potions' },
  THE_LEGENDS_WERE_TRUE: { ok: st => st.act === 0 && st.deck.length > 0 && st.hp >= 10, needs: 'HP 10+' },
  THERMAE_NONUPEIPE: { ok: st => st.gold > 175 && st.hp <= st.maxHp * 0.75, needs: '176+ gold, HP ≤ 75%' },
  TRASH_HEAP: { ok: st => st.hp > 5, needs: 'HP 6+' },
  UNREST_SITE: { ok: st => st.hp <= st.maxHp * 0.7, needs: 'HP ≤ 70%' },
  WAR_HISTORIAN_REPY: { ok: () => false },
  WATERLOGGED_SCRIPTORIUM: { ok: st => st.gold >= 55, needs: '55+ gold' },
  WELCOME_TO_WONGOS: { ok: st => st.act === 1 && st.gold >= 100, needs: '100+ gold' },
  WHISPERING_HOLLOW: { ok: st => st.gold >= 44, needs: '44+ gold' },
  WOOD_CARVINGS: { ok: st => st.deck.some(c => info(c.id).rarity === 'Basic' && info(c.id).removable) },
  WUPPY_IN_TROUBLE: { ok: () => true, needs: 'enough HP' },
  ZEN_WEAVER: { ok: st => st.gold >= 125, needs: '125+ gold' },
};

function isAllowed(id, st) {
  const rule = RULES[id.replace(/^EVENT\./, '')];
  return rule ? rule.ok(st) : true;
}
const needs = id => RULES[id.replace(/^EVENT\./, '')]?.needs || null;

// ── Event ports ───────────────────────────────────────────────────────────────

const relicPull = (ctx, rng) => R.pullRelicForReward(ctx, rng);
const fmt = id => String(id || '').replace(/^[A-Z_]+\./, '');

const PORTS = {
  SAPPHIRE_SEED: () => ({
    options: [
      { name: 'Eat', effects: ['Heal 9', 'Upgrade a card of your choice'] },
      { name: 'Plant', effects: ['Enchant a card with Sown'] },
    ],
  }),

  THIS_OR_THAT: e => {
    const gold = e.rng.nextInt(41, 69);
    const o = e.branch();
    return {
      options: [
        { name: 'Plain', effects: ['Lose 6 HP', `Gain ${gold} gold`] },
        { name: 'Ornate', relics: [relicPull(o.ctx, o.rng)], effects: ['Gain the relic below', 'Add the curse Clumsy'], shiftsRelicBag: true },
      ],
    };
  },

  WHISPERING_HOLLOW: e => {
    const cost = 35 + e.rng.nextInt(-9, 10);
    const g = e.branch(), h = e.branch();
    // Two PotionRewards, each populated on its own from the Rewards stream.
    const potions = [R.createRandomPotions(g.ctx, 1, g.ctx.rngs.Rewards)[0], R.createRandomPotions(g.ctx, 1, g.ctx.rngs.Rewards)[0]];
    return {
      options: [
        { name: 'Gold', effects: [`Pay ${cost} gold for 2 potions`], potions, shiftsRewards: true },
        { name: 'Hug', effects: ['Lose 9 HP', 'Transform a card of your choice'], transforms: transformPreview(h.ctx, h.rng, e.deck) },
      ],
    };
  },

  JUNGLE_MAZE_ADVENTURE: e => {
    const solo = Math.trunc(150 + e.rng.nextFloat(-15, 15));
    const join = Math.trunc(50 + e.rng.nextFloat(-15, 15));
    return {
      options: [
        { name: 'Solo quest', effects: ['Lose 18 HP', `Gain ${solo} gold`] },
        { name: 'Join forces', effects: [`Gain ${join} gold`] },
      ],
    };
  },

  SLIPPERY_BRIDGE: e => {
    // Each Hold On re-rolls the card to lose (skipping the previous card's type) and costs 1 more HP.
    const chain = [];
    const skipped = new Set();
    let last = null;
    for (let i = 0; i < 4; i++) {
      let list = last == null
        ? e.deck.filter(c => info(c.id).rarity !== 'Basic')
        : e.deck.filter(c => c.id !== last.id);
      list = list.filter(c => info(c.id).removable && !skipped.has(c));
      if (!list.length) list = e.deck.filter(c => info(c.id).removable);
      const pick = e.rng.nextItem(list);
      if (last) skipped.add(last);
      chain.push({ card: pick.id, hpLossToSkip: 3 + i });
      last = pick;
    }
    return {
      options: [
        { name: 'Overcome', effects: [`Remove ${fmt(chain[0].card)} from your deck`] },
        { name: 'Hold on', effects: chain.slice(0, -1).map((c, i) => `Lose ${c.hpLossToSkip} HP, then the card offered becomes ${fmt(chain[i + 1].card)}`) },
      ],
    };
  },

  MORPHIC_GROVE: e => {
    const g = e.branch();
    return {
      options: [
        { name: 'Loner', effects: ['Gain 5 Max HP'] },
        { name: 'Group', effects: ['Lose all your gold', 'Transform 2 cards of your choice (first pick shown)'], transforms: transformPreview(g.ctx, g.rng, e.deck) },
      ],
    };
  },

  THE_FUTURE_OF_POTIONS: e => {
    const potions = e.st.potionModels.slice(0, 3);
    const types = potions.map(p => e.rng.nextItem(
      p.rarity === 'Common' || p.rarity === 'Token' ? ['Attack', 'Skill'] : ['Attack', 'Skill', 'Power']));
    return {
      options: potions.map((p, i) => {
        const b = e.branch();
        const rarity = { Rare: 'Rare', Event: 'Rare', Uncommon: 'Uncommon' }[p.rarity] || 'Common';
        const cards = R.createCardsForReward(b.ctx, 3, {
          pools: [DATA.characters[b.ctx.character].cardPool], rarityOdds: 'Uniform', source: 'Other',
          filter: c => c.rarity === rarity && c.type === types[i], noUpgradeRoll: true,
        }).map(c => ({ ...c, upgraded: true }));
        return { name: `Trade ${fmt(p.id)}`, effects: [`Choose 1 upgraded ${rarity} ${types[i]}`], cardChoice: cards, shiftsRewards: true };
      }),
    };
  },

  WELLSPRING: e => {
    const b = e.branch();
    const potion = b.ctx.rngs.Rewards.nextItem(R.potionOptions(b.ctx));
    return {
      options: [
        { name: 'Bottle', effects: ['Gain the potion below'], potions: [potion], shiftsRewards: true },
        { name: 'Bathe', effects: ['Remove a card of your choice', 'Add the curse Guilty'] },
      ],
    };
  },

  UNREST_SITE: e => {
    const k = e.branch();
    return {
      options: [
        { name: 'Rest', effects: [`Heal ${e.st.maxHp - e.st.hp}`, 'Add the curse Poor Sleep'] },
        { name: 'Kill', effects: ['Lose 8 Max HP', 'Gain the relic below'], relics: [relicPull(k.ctx, k.rng)], shiftsRelicBag: true },
      ],
    };
  },

  SELF_HELP_BOOK: () => ({
    options: [
      { name: 'Read the back', effects: ['Enchant an Attack with Sharp 2'] },
      { name: 'Read a passage', effects: ['Enchant a Skill with Nimble 2'] },
      { name: 'Read the entire book', effects: ['Enchant a Power with Swift 2'] },
    ],
  }),

  TABLET_OF_TRUTH: e => {
    // Each Decipher upgrades a random upgradable card (event Rng); costs 3, 6, 12, 24 Max HP, then all.
    const upgradable = e.deck.filter(c => info(c.id).upgradable && !(c.current_upgrade_level > 0)).slice();
    const costs = [3, 6, 12, 24];
    const lines = [];
    for (let i = 0; i < 4 && upgradable.length; i++) {
      const pick = e.rng.nextItem(upgradable);
      upgradable.splice(upgradable.indexOf(pick), 1);
      lines.push(`Decipher ${i + 1}: lose ${costs[i]} Max HP, upgrade ${fmt(pick.id)}`);
    }
    lines.push(`Decipher 5: lose ${e.st.maxHp - 1 - costs.reduce((a, b) => a + b, 0)}+ Max HP, upgrade everything`);
    return { options: [{ name: 'Decipher', effects: lines }, { name: 'Smash', effects: ['Heal 20'] }] };
  },

  ROOM_FULL_OF_CHEESE: e => {
    const b = e.branch();
    const cards = R.createCardsForReward(b.ctx, 8, {
      pools: [DATA.characters[b.ctx.character].cardPool], rarityOdds: 'Uniform', source: 'Other',
      filter: c => c.rarity === 'Common', noUpgradeRoll: true,
    });
    return {
      options: [
        { name: 'Gorge', effects: ['Pick 2 of these 8 commons'], cardChoice: cards, shiftsRewards: true },
        { name: 'Search', effects: ['Lose 14 HP', 'Gain Chosen Cheese'] },
      ],
    };
  },

  TEA_MASTER: () => ({
    options: [
      { name: 'Bone Tea', effects: ['Pay 50 gold', 'Gain Bone Tea'] },
      { name: 'Ember Tea', effects: ['Pay 150 gold', 'Gain Ember Tea'] },
      { name: 'Tea of Discourtesy', effects: ['Gain Tea of Discourtesy'] },
    ],
  }),

  WOOD_CARVINGS: () => ({
    options: [
      { name: 'Bird', effects: ['Transform a Basic card into Peck'] },
      { name: 'Snake', effects: ['Enchant a card with Slither'] },
      { name: 'Torus', effects: ['Transform a Basic card into Toric Toughness'] },
    ],
  }),

  DENSE_VEGETATION: e => {
    const gold = e.rng.nextInt(61, 100);
    return {
      options: [
        { name: 'Trudge on', effects: ['Lose 8 HP', `Gain ${gold} gold`] },
        { name: 'Rest', effects: ['Heal (as a rest site)', 'Then fight an event combat'], shiftsRewards: true },
      ],
    };
  },

  LUMINOUS_CHOIR: e => {
    const cost = 149 - e.rng.nextInt(0, 50);
    const t = e.branch();
    return {
      options: [
        { name: 'Reach into the flesh', effects: ['Remove 2 cards of your choice', 'Add the curse Spore Mind'] },
        { name: 'Offer tribute', effects: [`Pay ${cost} gold`, 'Gain the relic below'], relics: [relicPull(t.ctx, t.rng)], shiftsRelicBag: true },
      ],
    };
  },

  THE_LEGENDS_WERE_TRUE: e => {
    const b = e.branch();
    const potion = b.ctx.rngs.Rewards.nextItem(R.potionOptions(b.ctx));
    return {
      options: [
        { name: 'Nab the map', effects: ['Add Spoils Map to your deck'] },
        { name: 'Slowly find an exit', effects: ['Lose 8 HP', 'Gain the potion below'], potions: [potion], shiftsRewards: true },
      ],
    };
  },

  SUNKEN_STATUE: e => {
    const gold = 111 + e.rng.nextInt(-10, 11);
    return {
      options: [
        { name: 'Grab the sword', effects: ['Gain Sword of Stone'] },
        { name: 'Dive into the water', effects: [`Gain ${gold} gold`, 'Lose 7 HP'] },
      ],
    };
  },

  AROMA_OF_CHAOS: e => {
    const b = e.branch();
    return {
      options: [
        { name: 'Let go', effects: ['Transform a card of your choice'], transforms: transformPreview(b.ctx, b.rng, e.deck) },
        { name: 'Maintain control', effects: ['Upgrade a card of your choice'] },
      ],
    };
  },
};

// ── Act 2 events ──────────────────────────────────────────────────────────────

const charPool = ctx => DATA.characters[ctx.character].cardPool;
// CardCreationOptions.ForNonCombatWithDefaultOdds: regular-fight odds, no upgrade roll.
const defaultOdds = (pools, filter) => ({ pools, rarityOdds: 'RegularEncounter', source: 'Other', filter, noUpgradeRoll: true });
const MODIFIER_CURSES = () => DATA.cardPools.CURSE_CARD_POOL
  .filter(c => !['CARD.ASCENDERS_BANE', 'CARD.BAD_LUCK', 'CARD.CURSE_OF_THE_BELL', 'CARD.ENTHRALLED', 'CARD.FOLLY',
    'CARD.GREED', 'CARD.POOR_SLEEP', 'CARD.SPORE_MIND'].includes(c.id))
  .map(c => c.id).sort();
// ModelId ordering for StableShuffle of relics.
const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

Object.assign(PORTS, {
  BUGSLAYER: () => ({
    options: [
      { name: 'Extermination', effects: ['Add Exterminate to your deck'] },
      { name: 'Squash', effects: ['Add Squash to your deck'] },
    ],
  }),

  COLORFUL_PHILOSOPHERS: e => {
    // Other characters' pools in a fixed colour order; random ones removed until 3 remain.
    const order = ['NECROBINDER_CARD_POOL', 'IRONCLAD_CARD_POOL', 'REGENT_CARD_POOL', 'FOOL_CARD_POOL', 'SILENT_CARD_POOL', 'DEFECT_CARD_POOL'];
    const unlocked = unlockedCharacterPools(e.st.epochs);
    const pools = order.filter(p => p !== charPool(e.ctx) && unlocked.includes(p));
    while (pools.length > Math.min(3, pools.length) || pools.length > 3) pools.splice(e.rng.nextInt(pools.length), 1);
    return {
      options: pools.map(pool => {
        const b = e.branch();
        // Three card rewards: 3 Commons, 3 Uncommons, 3 Rares (uniform odds, with upgrade rolls).
        const cards = ['Common', 'Uncommon', 'Rare'].flatMap(r => R.createCardsForReward(b.ctx, 3, {
          pools: [pool], rarityOdds: 'Uniform', source: 'Other', filter: c => c.rarity === r,
        }));
        return { name: fmt(pool).replace('_CARD_POOL', ''), effects: ['Three card rewards from this colour: pick 1 Common, 1 Uncommon, 1 Rare'], cardChoice: cards, shiftsRewards: true };
      }),
    };
  },

  SYMBIOTE: e => {
    const b = e.branch();
    return {
      options: [
        { name: 'Approach', effects: ['Enchant a card with Corrupted'] },
        { name: 'Kill with fire', effects: ['Transform a card of your choice'], transforms: transformPreview(b.ctx, b.rng, e.deck) },
      ],
    };
  },

  RELIC_TRADER: e => {
    // Your tradable relics: StableShuffle (sorted by id, then shuffled) and the first 3 offered;
    // the 3 new relics come from your relic bag with rarities rolled on the event Rng.
    const owned = e.rng.stableShuffle(e.st.relics.filter(tradable), byId).slice(0, 3);
    const fresh = owned.map(() => relicPull(e.ctx, e.rng));
    return {
      options: owned.map((r, i) => ({ name: `Trade ${fmt(r)}`, effects: [`Give up ${fmt(r)}`, 'Gain the relic below'], relics: [fresh[i]], shiftsRelicBag: true })),
    };
  },

  COLOSSAL_FLOWER: () => ({
    options: [
      { name: 'Extract now', effects: ['Gain 35 gold'] },
      { name: 'Reach deeper once', effects: ['Lose 5 HP', 'Then extract for 75 gold'] },
      { name: 'Reach deeper twice', effects: ['Lose 5 + 6 HP', 'Then 135 gold, or lose 7 more HP for Pollinous Core'] },
    ],
  }),

  RANWID_THE_ELDER: e => {
    const potion = e.rng.nextItem(e.st.potions);
    const relic = e.rng.nextItem(e.st.relics.filter(tradable));
    const p = e.branch(), g = e.branch(), r = e.branch();
    return {
      options: [
        { name: `Give ${fmt(potion)}`, effects: ['Gain the relic below'], relics: [relicPull(p.ctx, p.rng)], shiftsRelicBag: true },
        { name: 'Give 100 gold', effects: ['Gain the relic below'], relics: [relicPull(g.ctx, g.rng)], shiftsRelicBag: true },
        { name: `Give ${fmt(relic)}`, effects: ['Gain the 2 relics below'], relics: [relicPull(r.ctx, r.rng), relicPull(r.ctx, r.rng)], shiftsRelicBag: true },
      ],
    };
  },

  WELCOME_TO_WONGOS: e => {
    // Shop-allowed relics from the front of your relic bag (no rarity roll).
    const front = rarity => (e.ctx.grabBag[rarity] || []).find(id => DATA.relics?.[id]?.inShops !== false);
    const upgraded = e.deck.filter(c => c.current_upgrade_level > 0);
    const downgrade = upgraded.length ? e.rng.nextItem(upgraded) : null;
    return {
      options: [
        { name: 'Bargain bin', effects: ['Pay 100 gold', 'Gain the common relic below'], relics: [front('common')], shiftsRelicBag: true },
        { name: 'Featured item', effects: ['Pay 200 gold', 'Gain the rare relic below'], relics: [front('rare')], shiftsRelicBag: true },
        { name: 'Mystery box', effects: ["Pay 300 gold", "Gain Wongo's Mystery Ticket"] },
        { name: 'Leave', effects: [downgrade ? `${fmt(downgrade.id)} is downgraded` : 'Nothing happens (no upgraded cards)'] },
      ],
    };
  },

  DOLL_ROOM: e => {
    const dolls = ['RELIC.DAUGHTER_OF_THE_WIND', 'RELIC.MR_STRUGGLES', 'RELIC.BING_BONG'];
    const a = e.branch(), b = e.branch();
    return {
      options: [
        { name: 'Pick at random', effects: ['Gain the doll below'], relics: [a.rng.nextItem(dolls)] },
        { name: 'Take some time', effects: ['Lose 5 HP', 'Choose between the 2 dolls below'], relics: b.rng.stableShuffle(dolls.slice(), byId).slice(0, 2) },
        { name: 'Examine', effects: ['Lose 15 HP', 'Choose any of the 3 dolls'] },
      ],
    };
  },

  AMALGAMATOR: () => ({
    options: [
      { name: 'Combine Strikes', effects: ['Remove 2 basic Strikes', 'Add Ultimate Strike'] },
      { name: 'Combine Defends', effects: ['Remove 2 basic Defends', 'Add Ultimate Defend'] },
    ],
  }),

  ZEN_WEAVER: () => ({
    options: [
      { name: 'Breathing techniques', effects: ['Pay 25 gold', 'Add Enlightenment'] },
      { name: 'Emotional awareness', effects: ['Pay 125 gold', 'Remove 1 card'] },
      { name: 'Arachnid acupuncture', effects: ['Pay 250 gold', 'Remove 2 cards'] },
    ],
  }),

  THE_LANTERN_KEY: () => ({
    options: [
      { name: 'Return the key', effects: ['Gain 100 gold'] },
      { name: 'Keep the key', effects: ['Fight the Mysterious Knight', 'Win: normal fight rewards plus the Lantern Key card'], shiftsRewards: true },
    ],
  }),

  LOST_WISP: e => {
    const gold = 60 + e.rng.nextInt(-15, 16);
    return {
      options: [
        { name: 'Claim', effects: ['Gain the Lost Wisp relic', 'Add the curse Decay'] },
        { name: 'Search', effects: [`Gain ${gold} gold`] },
      ],
    };
  },

  FIELD_OF_MAN_SIZED_HOLES: () => ({
    options: [
      { name: 'Resist', effects: ['Remove 2 cards', 'Add the curse Normality'] },
      { name: 'Enter your hole', effects: ['Enchant a card with Perfect Fit'] },
    ],
  }),

  STONE_OF_ALL_TIME: e => {
    const potion = e.rng.nextItem(e.st.potions);
    return {
      options: [
        { name: 'Lift', effects: [`Drink ${fmt(potion)} (it's discarded)`, 'Gain 10 Max HP'] },
        { name: 'Push', effects: ['Lose 6 HP', 'Enchant a card with Vigorous 8'] },
      ],
    };
  },

  SPIRIT_GRAFTER: () => ({
    options: [
      { name: 'Let it in', effects: ['Heal 25', 'Add Metamorphosis'] },
      { name: 'Rejection', effects: ['Upgrade a card', 'Lose 10 HP'] },
    ],
  }),

  MUSEUM_OF_TORTURE: e => {
    const relic = e.rng.nextItem(['RELIC.OBSIDIAN_VICE', 'RELIC.THUMBSCREW', 'RELIC.TORMENTOUS_COLLAR']);
    const curse = e.branch().ctx.rngs.NonCombatGeneration.nextItem(MODIFIER_CURSES());
    return {
      options: [
        { name: 'Take the relic', effects: ['Gain the relic below', `Add the curse ${fmt(curse)}`], relics: [relic] },
        { name: 'Break out', effects: ['Lose 10 Max HP'] },
      ],
    };
  },

  BRAIN_LEECH: e => {
    const s = e.branch(), r = e.branch();
    return {
      options: [
        { name: 'Share knowledge', effects: ['Pick 1 of these 5 cards'], cardChoice: R.createCardsForReward(s.ctx, 5, defaultOdds([charPool(s.ctx)])), shiftsRewards: true },
        { name: 'Rip', effects: ['Lose 5 HP', 'A colorless card reward'], cardChoice: R.createCardsForReward(r.ctx, 3, defaultOdds(['COLORLESS_CARD_POOL'])), shiftsRewards: true },
      ],
    };
  },

  POTION_COURIER: e => {
    const b = e.branch();
    const potion = b.ctx.rngs.Rewards.nextItem(R.potionOptions(b.ctx).filter(p => p.rarity === 'Uncommon'));
    return {
      options: [
        { name: 'Grab potions', effects: ['Gain 3 Foul Potions'] },
        { name: 'Ransack', effects: ['Gain the potion below'], potions: [potion], shiftsRewards: true },
      ],
    };
  },

  INFESTED_AUTOMATON: e => {
    const s = e.branch(), t = e.branch();
    return {
      options: [
        { name: 'Study', effects: ['Add this Power'], cardChoice: R.createCardsForReward(s.ctx, 1, defaultOdds([charPool(s.ctx)], c => c.type === 'Power')), shiftsRewards: true },
        { name: 'Touch the core', effects: ['Add this 0-cost card'], cardChoice: R.createCardsForReward(t.ctx, 1, defaultOdds([charPool(t.ctx)], c => c.cost === 0)), shiftsRewards: true },
      ],
    };
  },

  CRYSTAL_SPHERE: e => {
    const cost = 50 + e.rng.nextInt(1, 50);
    return {
      options: [
        { name: 'Uncover the future', effects: [`Pay ${cost} gold`, 'Play the sphere minigame (3 picks)'] },
        { name: 'Payment plan', effects: ['Add the curse Debt', 'Play the sphere minigame (6 picks)'] },
      ],
    };
  },

  FAKE_MERCHANT: e => {
    const fakes = ['ANCHOR', 'BLOOD_VIAL', 'HAPPY_FLOWER', 'LEES_WAFFLE', 'MANGO', 'ORICHALCUM', 'SNECKO_EYE', 'STRIKE_DUMMY', 'VENERABLE_TEA_SET']
      .map(x => 'RELIC.FAKE_' + x);
    const stock = e.rng.unstableShuffle(fakes).slice(0, 6);
    return {
      options: [
        { name: 'Browse', effects: ['Sells these fake relics (~50 gold each)', 'Their prices use the Shops stream: real shop forecasts after this shift'], relics: stock },
        { name: 'Throw a Foul Potion', effects: ['Fight the merchant'], shiftsRewards: true },
      ],
    };
  },
});

// ── Ancients ──────────────────────────────────────────────────────────────────

// What each ancient relic does when you take it (from its AfterObtained); passive ones
// just point at the tooltip. None of these use the Rewards stream on pickup.
const ANCIENT_RELIC_EFFECTS = {
  PAELS_HORN: ['Add 2 Relax'],
  PAELS_CLAW: ['Enchant every eligible card with Goopy'],
  PAELS_TOOTH: ['Remove up to 5 upgradable cards (kept by the relic)'],
  PAELS_GROWTH: ['Enchant a card with Clone 4'],
  PAELS_WING: ['Card rewards gain a Sacrifice option; every 2nd sacrifice gives a relic (uses the Rewards stream)'],
  BLOOD_SOAKED_ROSE: ['Add the curse Enthralled'],
  PRESERVED_FOG: ['Remove 3 cards', 'Add the curse Folly'],
  SERE_TALON: ['Lose 9 Max HP', 'Add 3 Wish'],
  DISTINGUISHED_CAPE: ['Add 2 random curses (below)', 'Add 3 Apparition'],
};

const ANCIENTS = {
  PAEL: e => {
    const deck = e.deck;
    const pool1 = ['PAELS_FLESH', 'PAELS_HORN', 'PAELS_TEARS'];
    let pool2 = ['PAELS_WING'];
    // Claw needs 3+ Goopy-enchantable cards (approximated as 3+ cards); Tooth needs 5+ removable.
    if (deck.length >= 3) pool2.push('PAELS_CLAW');
    if (deck.filter(c => info(c.id).removable).length >= 5) pool2.push('PAELS_TOOTH');
    pool2 = [...pool2, ...pool2, 'PAELS_GROWTH']; // AddRange(itself): Growth has half the weight
    const pool3 = ['PAELS_EYE', 'PAELS_BLOOD', 'PAELS_LEGION'];
    return [e.rng.nextItem(pool1), e.rng.nextItem(pool2), e.rng.nextItem(pool3)];
  },
  VAKUU: e => [
    e.rng.nextItem(['BLOOD_SOAKED_ROSE', 'WHISPERING_EARRING', 'FIDDLE']),
    e.rng.nextItem(['PRESERVED_FOG', 'SERE_TALON', 'DISTINGUISHED_CAPE']),
    e.rng.nextItem(['CHOICES_PARADOX', 'MUSIC_BOX', 'LORDS_PARASOL', 'JEWELED_MASK']),
  ],
};

// An act's Ancient (not Neow, which lib/rewards.js handles): its 3 relic offers.
function forecastAncient(ancientId, ctx, st) {
  const entry = ancientId.replace(/^EVENT\./, '');
  const pick = ANCIENTS[entry];
  if (!pick) return { id: ancientId, modelled: false };
  const rng = new Rng((ctx.runSeed + 0n + xxHash64(entry)) & MASK64);
  const e = { rng, ctx: R.cloneCtx(ctx), st, deck: st.deck };
  const offers = pick(e);
  return {
    id: ancientId, modelled: true,
    options: offers.map(r => {
      const effects = (ANCIENT_RELIC_EFFECTS[r] || ['Passive relic (see the in-game tooltip)']).slice();
      let cards;
      if (r === 'DISTINGUISHED_CAPE') {
        const nc = R.cloneCtx(ctx).rngs.NonCombatGeneration;
        const curses = MODIFIER_CURSES();
        const a = nc.nextItem(curses); curses.splice(curses.indexOf(a), 1);
        effects[0] = `Add the curses ${fmt(a)} and ${fmt(nc.nextItem(curses))}`;
      }
      return { name: fmt('RELIC.' + r), relics: ['RELIC.' + r], effects, cards };
    }),
  };
}

// ── Report ────────────────────────────────────────────────────────────────────

function eventState(save) {
  const p = save.players[0];
  const potionInfo = {};
  for (const pool of Object.values(DATA.potionPools)) for (const x of pool) potionInfo[x.id] = x;
  const potions = (p.potions || []).map(x => x.id);
  return {
    act: save.current_act_index ?? 0,
    gold: p.gold ?? 0, hp: p.current_hp ?? 0, maxHp: p.max_hp ?? 0,
    potions, potionModels: potions.map(id => potionInfo[id] || { id, rarity: 'Common' }),
    deck: p.deck || [],
    relics: (p.relics || []).map(r => r.id),
    epochs: new Set(p.unlock_state?.unlocked_epochs || []),
    totalFloor: (save.map_point_history || []).flat().length + 1,
  };
}

// Forecast one event as if entered now. ctx: rewards context (cloned here).
function forecastEvent(eventId, ctx, st) {
  const entry = eventId.replace(/^EVENT\./, '');
  const port = PORTS[entry];
  if (!port) return { id: eventId, modelled: false };
  const rng = new Rng((ctx.runSeed + 0n + xxHash64(entry)) & MASK64);
  const base = { rng, ctx: R.cloneCtx(ctx) };
  const e = {
    ...base, st, deck: st.deck,
    // Options are alternatives: each gets clones of the state after the shared rolls.
    branch: () => ({ rng: e.rng.clone(), ctx: R.cloneCtx(e.ctx) }),
  };
  return { id: eventId, modelled: true, ...port(e) };
}

module.exports = { isAllowed, needs, forecastEvent, forecastAncient, eventState, transformPreview, PORTS, RULES, ANCIENTS };
