// Act maps + route simulation. Walks planned paths node by node and consumes each RNG
// stream the way the game does (RunManager.RollRoomTypeFor / CreateRoom, RoomSet,
// RewardsSet, MerchantInventory, TreasureRoom), so every forecast along the way
// accounts for everything before it — across acts, too.
const { RunRngSet, parseJsonBigSafe } = require('./rng');
const { rollUnknownRoom, oddsFromSave } = require('./predict');
const R = require('./rewards');
const E = require('./events');

const key = c => `${c.col},${c.row}`;

// Events whose code can touch the Rewards stream (rewards, relic pulls, potions, combat).
// After one of these the card forecasts depend on the option you pick.
const REWARD_EVENTS = new Set(['BATTLEWORN_DUMMY', 'BRAIN_LEECH', 'COLORFUL_PHILOSOPHERS', 'DENSE_VEGETATION',
  'DROWNING_BEACON', 'ENDLESS_CONVEYOR', 'FAKE_MERCHANT', 'INFESTED_AUTOMATON', 'LUMINOUS_CHOIR', 'POTION_COURIER',
  'PUNCH_OFF', 'RANWID_THE_ELDER', 'RELIC_TRADER', 'ROOM_FULL_OF_CHEESE', 'ROUND_TEA_PARTY', 'THE_FUTURE_OF_POTIONS',
  'THE_LANTERN_KEY', 'THE_LEGENDS_WERE_TRUE', 'THIS_OR_THAT', 'TRIAL', 'UNREST_SITE', 'WAR_HISTORIAN_REPY',
  'WATERFALL_OF_OBVIOUS_SECRETS', 'WELCOME_TO_WONGOS', 'WELLSPRING', 'WHISPERING_HOLLOW', 'WUPPY_IN_TROUBLE']);

const MAP_TYPE_TO_ROOM = { monster: 'Monster', elite: 'Elite', boss: 'Boss', shop: 'Shop', treasure: 'Treasure',
  rest_site: 'RestSite', ancient: 'Event', unknown: null };

// ── Maps ──────────────────────────────────────────────────────────────────────

// savedMap: current_run.save's saved_map shape (the current act's, or a generated one).
function buildMap(save, actIndex, savedMap) {
  if (!savedMap) return null;
  const nodes = {};
  const all = [savedMap.start, ...savedMap.points, savedMap.boss, savedMap.second_boss].filter(Boolean);
  for (const p of all) {
    nodes[key(p.coord)] = { col: p.coord.col, row: p.coord.row, type: p.type, children: (p.children || []).map(key) };
  }
  // The second boss follows the first.
  if (savedMap.second_boss) nodes[key(savedMap.boss.coord)].children = [key(savedMap.second_boss.coord)];
  const isCurrent = actIndex === (save.current_act_index ?? 0);
  const visited = isCurrent ? (save.visited_map_coords || []).map(key) : [];
  const actHistory = (save.map_point_history || [])[actIndex] || [];
  const maxRow = Math.max(...all.map(p => p.coord.row));
  return {
    act: actIndex, actId: save.acts[actIndex].id, width: savedMap.width, height: maxRow, nodes,
    start: key(savedMap.start.coord), boss: key(savedMap.boss.coord), visited, isCurrent,
    current: visited[visited.length - 1] || key(savedMap.start.coord),
    // The save is written on entering a room, before it's resolved (no history entry yet).
    currentPending: isCurrent && visited.length > actHistory.length,
  };
}

function mapFromSave(save) {
  const act = save.current_act_index ?? 0;
  return buildMap(save, act, save.acts?.[act]?.saved_map);
}

// ── Simulation state ──────────────────────────────────────────────────────────

function roomsFor(save, actIndex) {
  const rooms = save.acts[actIndex].rooms;
  return {
    normal: rooms.normal_encounter_ids, elite: rooms.elite_encounter_ids, events: rooms.event_ids,
    boss: rooms.boss_id, secondBoss: rooms.second_boss_id || null, ancient: rooms.ancient_id,
    normalVisited: rooms.normal_encounters_visited || 0, eliteVisited: rooms.elite_encounters_visited || 0,
    eventsVisited: rooms.events_visited || 0, bossVisited: rooms.boss_encounters_visited || 0,
  };
}

function stateFromSave(save) {
  const ctx = R.contextFromSave(save);
  const run = RunRngSet.fromSave(save.rng);
  const history = (save.map_point_history || []).flat();
  const shared = save.shared_relic_grab_bag?.relic_id_lists || {};
  return {
    ctx,
    unknownRng: run.get('UnknownMapPoint').clone(),
    treasureRng: run.get('TreasureRoomRelics').clone(),
    unknownOdds: oddsFromSave(save.odds),
    rooms: roomsFor(save, save.current_act_index ?? 0),
    seenEvents: new Set(save.events_seen || []),
    // Eligibility uses the state as of now; gold/HP along the route aren't simulated.
    evState: E.eventState(save),
    sharedBag: Object.fromEntries(Object.entries(shared).map(([k, v]) => [k, v.slice()])),
    lastWasShop: history.length > 0 && (history[history.length - 1].rooms || []).some(r => r.room_type === 'shop'),
    removalsUsed: save.players[0].extra_fields?.card_shop_removals_used ?? 0,
    fightIndex: 0, shopIndex: 0, uncertainFrom: null,
  };
}

// Entering a new act: its own room lists; RNG streams and odds carry over.
function enterAct(st, save, actIndex) {
  st.rooms = roomsFor(save, actIndex);
  st.evState = { ...st.evState, act: actIndex };
  st.lastWasShop = false;
}

// RoomSet.EnsureNextEventIsValid + NextEvent: skip events already seen or not allowed
// (EventModel.IsAllowed, judged on your current gold/HP/potions).
function pullEvent(st) {
  const list = st.rooms.events;
  for (let i = 0; i < list.length; i++) {
    const id = list[st.rooms.eventsVisited % list.length];
    if (!st.seenEvents.has(id) && E.isAllowed(id, st.evState)) break;
    st.rooms.eventsVisited++;
  }
  const id = list[st.rooms.eventsVisited % list.length];
  st.rooms.eventsVisited++; // MarkRoomVisited(Event)
  st.seenEvents.add(id);
  return id;
}

function fight(st, roomType) {
  let encounter;
  if (roomType === 'Monster') encounter = st.rooms.normal[st.rooms.normalVisited++ % st.rooms.normal.length];
  else if (roomType === 'Elite') encounter = st.rooms.elite[st.rooms.eliteVisited++ % st.rooms.elite.length];
  else encounter = st.rooms.bossVisited++ > 0 && st.rooms.secondBoss ? st.rooms.secondBoss : st.rooms.boss;
  const rewards = R.predictCombatRewards(st.ctx, roomType);
  // Gremlins' Heist steals gold; winning adds a GoldReward that draws from Rewards after the
  // cards, so fights after this one shift by one draw if they steal.
  const stealsGold = /GREMLIN/.test(encounter || '');
  if (stealsGold && st.uncertainFrom == null) st.uncertainFrom = 'gold thief';
  return { encounter, rewards, fightIndex: ++st.fightIndex, stealsGold };
}

// TreasureRoom: gold is one Rewards NextInt; the chest relic uses the TreasureRoomRelics
// stream and the shared relic bag (front).
function treasure(st) {
  st.ctx.rngs.Rewards.nextInt(42, 53);
  let rarity = R.rollRelicRarity(st.treasureRng);
  const next = { common: 'uncommon', uncommon: 'rare' };
  while (rarity && !(st.sharedBag[rarity] || []).length) rarity = next[rarity];
  return { relic: rarity ? st.sharedBag[rarity].shift() : null };
}

// Resolve one map node. `nextTypes` are the node's children's types (shop blacklist rule).
function visit(st, node, nextTypes) {
  let roomType = MAP_TYPE_TO_ROOM[node.type];
  const step = { node: key(node), mapType: node.type };
  if (node.type === 'unknown') {
    const blacklist = st.lastWasShop || (nextTypes.length > 0 && nextTypes.every(t => t === 'shop')) ? ['Shop'] : [];
    const r = rollUnknownRoom(st.unknownRng, st.unknownOdds, blacklist);
    roomType = r.roomType;
    step.unknownRoll = r.roll;
  }
  step.roomType = roomType;
  if (roomType === 'Monster' || roomType === 'Elite' || roomType === 'Boss') {
    Object.assign(step, fight(st, roomType));
  } else if (node.type === 'ancient') {
    // The act's Ancient counts as a visited event. Modelled ancients' relics don't touch the
    // Rewards stream on pickup, so forecasts after them stay exact.
    st.rooms.eventsVisited++;
    step.ancient = st.rooms.ancient;
    step.ancientForecast = E.forecastAncient(st.rooms.ancient, st.ctx, st.evState);
    if (!step.ancientForecast.modelled && st.uncertainFrom == null) { st.uncertainFrom = step.node; step.mayShiftRewards = true; }
  } else if (roomType === 'Event') {
    step.event = pullEvent(st);
    step.eventForecast = E.forecastEvent(step.event, st.ctx, st.evState);
    step.eventNeeds = E.needs(step.event);
    if (REWARD_EVENTS.has(step.event.replace(/^EVENT\./, '')) && st.uncertainFrom == null) {
      st.uncertainFrom = step.node;
      step.mayShiftRewards = true;
    }
  } else if (roomType === 'Shop') {
    step.shop = R.generateShop(st.ctx, st.removalsUsed);
    step.shopIndex = ++st.shopIndex;
  } else if (roomType === 'Treasure') {
    Object.assign(step, treasure(st));
  }
  step.uncertain = st.uncertainFrom != null && !step.mayShiftRewards;
  st.evState.totalFloor++;
  st.lastWasShop = roomType === 'Shop';
  return step;
}

// Walk `path` (node keys after `from`, following edges) on `map`.
function walk(st, map, from, path, includeFrom) {
  const order = includeFrom ? [from] : [];
  let prev = from;
  for (const k of path) {
    if (!map.nodes[prev]?.children.includes(k)) break; // ignore anything off the map's edges
    order.push(k);
    prev = k;
  }
  const steps = order.map(k => {
    const node = map.nodes[k];
    return visit(st, node, node.children.map(c => map.nodes[c]?.type));
  });
  return { steps, reachedBoss: prev === map.boss || map.nodes[prev]?.type === 'boss' };
}

// Simulate planned routes. routes: { [actIndex]: [node keys] } (current act: nodes after the
// current one; later acts: nodes after the act's start). maps: { [actIndex]: saved_map shape }
// for acts after the current one (from lib/mapgen). Returns one entry per simulated act.
function simulateRoutes(save, routes = {}, maps = {}) {
  if (typeof save === 'string') save = parseJsonBigSafe(save);
  const cur = save.current_act_index ?? 0;
  const st = stateFromSave(save);
  const acts = [];
  for (let a = cur; a < save.acts.length; a++) {
    const map = a === cur ? mapFromSave(save) : buildMap(save, a, maps[a]);
    if (!map) break;
    if (a > cur) {
      enterAct(st, save, a);
      // Anything not planned in the previous act makes this act's numbers approximate.
      if (!acts[acts.length - 1]?.reachedBoss && st.uncertainFrom == null) st.uncertainFrom = 'previous act';
    }
    const includeFrom = a === cur ? (map.currentPending && map.current !== map.start) : true;
    const res = walk(st, map, map.current, routes[a] || [], includeFrom);
    acts.push({ act: a, map, ...res, includesCurrent: a === cur && includeFrom });
    if (a > cur && !(routes[a] || []).length) break;
  }
  return { acts };
}

// Single-act convenience (current act only).
function simulateRoute(save, path = []) {
  if (typeof save === 'string') save = parseJsonBigSafe(save);
  const r = simulateRoutes(save, { [save.current_act_index ?? 0]: path });
  const a = r.acts[0];
  return a ? { map: a.map, steps: a.steps, includesCurrent: a.includesCurrent } : null;
}

// Path-independent lookahead for an act: fights / events / shops in order.
function lookahead(save, count = 8, actIndex = save.current_act_index ?? 0) {
  if (typeof save === 'string') save = parseJsonBigSafe(save);
  const st = stateFromSave(save);
  const cur = save.current_act_index ?? 0;
  if (actIndex !== cur) {
    enterAct(st, save, actIndex);
    st.rooms.eventsVisited++; // the act's Ancient
  }
  const r = st.rooms;
  const take = (list, from, n) => Array.from({ length: Math.min(n, list.length) }, (_, i) => list[(from + i) % list.length]);
  const events = [];
  const probe = { ...st, rooms: { ...r }, seenEvents: new Set(st.seenEvents) };
  for (let i = 0; i < Math.min(count, r.events.length); i++) events.push(pullEvent(probe));
  const forecasts = events.map(id => E.forecastEvent(id, st.ctx, st.evState));
  // If every upcoming fight were a normal fight: the n-th card reward (current act only).
  const ctx = R.cloneCtx(st.ctx);
  const fights = actIndex === cur ? Array.from({ length: count }, () => R.predictCombatRewards(ctx, 'Monster')) : [];
  const shopCtx = R.cloneCtx(st.ctx);
  const shops = actIndex === cur ? Array.from({ length: 3 }, () => R.generateShop(shopCtx, st.removalsUsed)) : [];
  return {
    act: actIndex, isCurrent: actIndex === cur,
    ancient: save.acts[actIndex].rooms.ancient_id,
    // Shown while the Ancient is still ahead (future acts, or standing on it now).
    ancientForecast: actIndex !== cur || ((save.map_point_history || [])[actIndex] || []).length === 0
      ? E.forecastAncient(save.acts[actIndex].rooms.ancient_id, st.ctx, st.evState) : null,
    normals: take(r.normal, r.normalVisited, count),
    elites: take(r.elite, r.eliteVisited, Math.min(count, 4)),
    boss: r.boss, secondBoss: r.secondBoss,
    events: events.map((id, i) => ({
      id, mayShiftRewards: REWARD_EVENTS.has(id.replace(/^EVENT\./, '')), needs: E.needs(id), forecast: forecasts[i],
    })),
    normalFightRewards: fights,
    shops,
  };
}

module.exports = { mapFromSave, buildMap, simulateRoute, simulateRoutes, lookahead, REWARD_EVENTS };
