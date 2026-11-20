// Act map + route simulation. Walks a planned path node by node and consumes each RNG
// stream the way the game does (RunManager.RollRoomTypeFor / CreateRoom, RoomSet,
// RewardsSet, MerchantInventory, TreasureRoom), so every forecast along the path
// accounts for everything before it.
const { RunRngSet, Rng, parseJsonBigSafe } = require('./rng');
const { rollUnknownRoom, oddsFromSave } = require('./predict');
const R = require('./rewards');

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

// ── Map ───────────────────────────────────────────────────────────────────────

function mapFromSave(save) {
  const act = save.current_act_index ?? 0;
  const m = save.acts?.[act]?.saved_map;
  if (!m) return null;
  const nodes = {};
  for (const p of [m.start, ...m.points, m.boss].filter(Boolean)) {
    nodes[key(p.coord)] = { col: p.coord.col, row: p.coord.row, type: p.type, children: (p.children || []).map(key) };
  }
  const visited = (save.visited_map_coords || []).map(key);
  const actHistory = (save.map_point_history || [])[act] || [];
  return {
    act, actId: save.acts[act].id, width: m.width, height: m.height, nodes,
    start: key(m.start.coord), boss: key(m.boss.coord), visited,
    current: visited[visited.length - 1] || key(m.start.coord),
    // The save is written on entering a room, before it's resolved (no history entry yet).
    currentPending: visited.length > actHistory.length,
  };
}

// ── Simulation state ──────────────────────────────────────────────────────────

function stateFromSave(save) {
  const ctx = R.contextFromSave(save);
  const run = RunRngSet.fromSave(save.rng);
  const rooms = save.acts[save.current_act_index ?? 0].rooms;
  const history = (save.map_point_history || []).flat();
  const shared = save.shared_relic_grab_bag?.relic_id_lists || {};
  return {
    ctx,
    unknownRng: run.get('UnknownMapPoint').clone(),
    treasureRng: run.get('TreasureRoomRelics').clone(),
    unknownOdds: oddsFromSave(save.odds),
    rooms: {
      normal: rooms.normal_encounter_ids, elite: rooms.elite_encounter_ids, events: rooms.event_ids,
      boss: rooms.boss_id, normalVisited: rooms.normal_encounters_visited || 0,
      eliteVisited: rooms.elite_encounters_visited || 0, eventsVisited: rooms.events_visited || 0,
    },
    seenEvents: new Set(save.events_seen || []),
    sharedBag: Object.fromEntries(Object.entries(shared).map(([k, v]) => [k, v.slice()])),
    lastWasShop: history.length > 0 && (history[history.length - 1].rooms || []).some(r => r.room_type === 'shop'),
    removalsUsed: save.players[0].extra_fields?.card_shop_removals_used ?? 0,
    fightIndex: 0, shopIndex: 0, uncertainFrom: null,
  };
}

// RoomSet.EnsureNextEventIsValid + NextEvent (only "already seen" is checked here;
// events with their own IsAllowed conditions may be skipped by the game).
function pullEvent(st) {
  const list = st.rooms.events;
  for (let i = 0; i < list.length; i++) {
    const id = list[st.rooms.eventsVisited % list.length];
    if (!st.seenEvents.has(id)) break;
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
  else encounter = st.rooms.boss;
  const rewards = R.predictCombatRewards(st.ctx, roomType);
  return { encounter, rewards, fightIndex: ++st.fightIndex };
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

// Resolve one map node. `nextChildren` are the node's children (shop blacklist rule).
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
  } else if (roomType === 'Event' && node.type !== 'ancient') {
    step.event = pullEvent(st);
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
  st.lastWasShop = roomType === 'Shop';
  return step;
}

// Simulate a path: array of node keys after the current node (must follow map edges).
function simulateRoute(save, path = []) {
  if (typeof save === 'string') save = parseJsonBigSafe(save);
  const map = mapFromSave(save);
  if (!map) return null;
  const st = stateFromSave(save);
  const order = [];
  if (map.currentPending && map.current !== map.start) order.push(map.current);
  let prev = map.current;
  for (const k of path) {
    if (!map.nodes[prev]?.children.includes(k)) break; // ignore anything off the map's edges
    order.push(k);
    prev = k;
  }
  const steps = order.map(k => {
    const node = map.nodes[k];
    return visit(st, node, node.children.map(c => map.nodes[c]?.type));
  });
  return { map, steps, includesCurrent: map.currentPending && map.current !== map.start };
}

// Path-independent lookahead: what the next fights / events / shops are in order.
function lookahead(save, count = 8) {
  if (typeof save === 'string') save = parseJsonBigSafe(save);
  const st = stateFromSave(save);
  const r = st.rooms;
  const take = (list, from, n) => Array.from({ length: Math.min(n, list.length) }, (_, i) => list[(from + i) % list.length]);
  const events = [];
  const probe = { ...st, rooms: { ...r }, seenEvents: new Set(st.seenEvents) };
  for (let i = 0; i < Math.min(count, r.events.length); i++) events.push(pullEvent(probe));
  // If every upcoming fight were a normal fight: the n-th card reward.
  const ctx = R.cloneCtx(st.ctx);
  const fights = Array.from({ length: count }, () => R.predictCombatRewards(ctx, 'Monster'));
  const shopCtx = R.cloneCtx(st.ctx);
  const shops = Array.from({ length: 3 }, () => R.generateShop(shopCtx, st.removalsUsed));
  return {
    normals: take(r.normal, r.normalVisited, count),
    elites: take(r.elite, r.eliteVisited, Math.min(count, 4)),
    boss: r.boss,
    events: events.map(id => ({ id, mayShiftRewards: REWARD_EVENTS.has(id.replace(/^EVENT\./, '')) })),
    normalFightRewards: fights,
    shops,
  };
}

module.exports = { mapFromSave, simulateRoute, lookahead, REWARD_EVENTS };
