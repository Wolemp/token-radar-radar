// The token radar's value model (radar-2): one snapshot in, one ranked board out.
//
// A protocol the radar ranks records no token. What would a token be worth if its record stayed as it is?
// The snapshot answers from its own figures, in three factors:
//
//   implied = tvl x peer_multiple x growth_multiplier x maturity_multiplier
//
//   peer_multiple       what the market pays per dollar of TVL for the protocols that DO have a token. It is
//                       fitted at run time on the snapshot's live peers (market cap above zero): a log-log line
//                       of mcap/tvl against tvl, plus a shrunk offset for the protocol's category. Bigger
//                       protocols are worth less per dollar of TVL, so the multiple falls as TVL rises.
//   growth_multiplier   1 + clamp(change_7d, -50, 100)/100 x 0.4: TVL that is moving in or out of the protocol.
//   maturity_multiplier 0.70 + 0.30 x min(age, 730)/730: how long DefiLlama has tracked it. A longer record is
//                       a longer test of the TVL staying, so it is the floor on how long the protocol has run
//                       with no token. An unknown age takes 0.85 and is flagged.
//
// No protocol name is special-cased anywhere: one function scores every row, and every constant is stated
// on the dashboard. The three factors are rounded before they are multiplied, so the page recomputes the
// exact integer the board carries.

import { farmPlan, planText } from './farm.ts';
import type { FarmStep } from './farm.ts';

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export const MODEL = {
  growth_floor: -50,
  growth_cap: 100,
  growth_weight: 0.4,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 730,
  unknown_maturity: 0.85,
  category_shrink: 5,
  multiple_floor: 0.01,
  multiple_cap: 3,
  airdrop_share: 0.05,
};
export type ModelConstants = typeof MODEL;

export const MODEL_VERSION = 'radar-2';

/** Where one protocol stands: ranked here, already trading, or set aside with the reason. */
export type Status = 'pre-token' | 'live' | 'set-aside';

export interface Verdict {
  status: Status;
  reason: string;
}

/** The categories the house rule reads as a bridged, staked or wrapped product of another token. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'Anchor BTC', 'Decentralized BTC', 'CEX']);
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_NAME = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)/i;

/** Whether the snapshot records a token for it: a gecko id, a symbol or a market cap. */
export function hasToken(p: SnapshotProtocol): boolean {
  return p.gecko_id !== null || p.symbol !== null || p.mcap_usd !== null;
}

/**
 * Sort one protocol into the board, the live set or the set-aside pile. The watchlist is the floor, so a
 * watchlist slug is always ranked; every other protocol is judged by the house rule's own tests, read from
 * the fields the snapshot carries. A pre-token protocol at or above the floor that the watchlist leaves out
 * has a parent DefiLlama counts it under, so it is set aside rather than counted twice.
 */
export function classify(p: SnapshotProtocol, snapshot: Snapshot, onList: Set<string>): Verdict {
  if (hasToken(p)) return { status: 'live', reason: p.mcap_usd === null ? 'records a token but no market cap' : 'its token already trades' };
  if (onList.has(p.slug)) return { status: 'pre-token', reason: 'on the watchlist' };
  const category = p.category ?? '';
  if (category === 'CEX') return { status: 'set-aside', reason: 'an exchange, not a protocol' };
  if (PRODUCT_CATEGORIES.has(category)) return { status: 'set-aside', reason: `${category}: a bridged or staked product of another token` };
  if (VERSIONED.test(p.name)) return { status: 'set-aside', reason: 'a version of another protocol' };
  if (PRODUCT_WORD.test(p.name)) return { status: 'set-aside', reason: 'a wrapped or staked product' };
  if (EXCHANGE_NAME.test(p.name)) return { status: 'set-aside', reason: "an exchange's own product" };
  if (p.tvl_usd >= snapshot.floor_usd) return { status: 'set-aside', reason: 'above the floor but off the watchlist: DefiLlama counts it under a parent' };
  return { status: 'pre-token', reason: 'early radar: below the floor, records no token' };
}

/** The peer fit: ln(mcap/tvl) = intercept + slope x ln(tvl) + category offset, and the residual quartiles. */
export interface PeerFit {
  intercept: number;
  slope: number;
  peers: number;
  offsets: Record<string, { offset: number; peers: number }>;
  q25: number;
  q75: number;
  median_multiple: number;
}

const round = (n: number, places: number): number => Math.round(n * 10 ** places) / 10 ** places;

/** The q-th quantile of a sorted list, interpolated between neighbours. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

/** The live peers the market already prices: a market cap above zero, not an exchange. */
export function peersOf(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX');
}

/** Fit the market's own pricing of TVL on the snapshot's live peers. */
export function fitPeers(snapshot: Snapshot, model: ModelConstants = MODEL): PeerFit {
  const peers = peersOf(snapshot);
  const xs = peers.map((p) => Math.log(p.tvl_usd));
  const ys = peers.map((p) => Math.log(p.mcap_usd! / p.tvl_usd));
  const n = peers.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const residuals = ys.map((y, i) => y - (intercept + slope * xs[i]!));
  // A category's offset is the mean residual of its peers, shrunk toward zero when it has few of them.
  const sums = new Map<string, { sum: number; peers: number }>();
  peers.forEach((p, i) => {
    const key = p.category ?? 'Other';
    const cur = sums.get(key) ?? { sum: 0, peers: 0 };
    cur.sum += residuals[i]!;
    cur.peers += 1;
    sums.set(key, cur);
  });
  const offsets: PeerFit['offsets'] = {};
  for (const [key, v] of [...sums.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    offsets[key] = { offset: round((v.sum / v.peers) * (v.peers / (v.peers + model.category_shrink)), 4), peers: v.peers };
  }
  const left = peers.map((p, i) => residuals[i]! - (offsets[p.category ?? 'Other']?.offset ?? 0)).sort((a, b) => a - b);
  const ratios = peers.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  return {
    intercept: round(intercept, 4),
    slope: round(slope, 4),
    peers: n,
    offsets,
    q25: round(quantile(left, 0.25), 4),
    q75: round(quantile(left, 0.75), 4),
    median_multiple: round(quantile(ratios, 0.5), 4),
  };
}

/** The peer multiple one protocol earns: market cap per dollar of TVL for a peer of its size and category. */
export function peerMultiple(tvl: number, category: string | null, fit: PeerFit, model: ModelConstants = MODEL): number {
  const offset = fit.offsets[category ?? 'Other']?.offset ?? 0;
  const raw = Math.exp(fit.intercept + fit.slope * Math.log(tvl) + offset);
  return round(Math.min(model.multiple_cap, Math.max(model.multiple_floor, raw)), 6);
}

const DAY_MS = 86_400_000;

/** Whole days from the day DefiLlama began tracking a protocol to the snapshot's day; null when unknown. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** How far into its life a protocol is, as the farm window: the plan's hold and the page's filter read it. */
export function windowOf(age: number | null): 'new' | 'established' | 'long-running' | 'unknown' {
  if (age === null) return 'unknown';
  if (age < 180) return 'new';
  if (age < 730) return 'established';
  return 'long-running';
}

/** The model's three factors and the integer they give for one protocol. */
export interface Scored {
  peer_multiple: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  age_days: number | null;
  implied: number;
  low: number;
  high: number;
  flags: string[];
}

export function score(p: SnapshotProtocol, asOf: string, fit: PeerFit, model: ModelConstants = MODEL): Scored {
  const age = ageDays(asOf, p.listed_at);
  const flags: string[] = [];
  if (p.change_7d === null) flags.push('no seven-day change recorded: growth counts as 0%');
  if (age === null) flags.push('no listing date: maturity takes the neutral value');
  const growth = Math.min(model.growth_cap, Math.max(model.growth_floor, p.change_7d ?? 0));
  const growthMult = round(1 + (growth / 100) * model.growth_weight, 4);
  const maturity = age === null ? model.unknown_maturity : round(model.maturity_floor + (Math.min(age, model.maturity_days) / model.maturity_days) * model.maturity_range, 4);
  const peer = peerMultiple(p.tvl_usd, p.category, fit, model);
  const implied = Math.max(1, Math.round(p.tvl_usd * peer * growthMult * maturity));
  if (!fit.offsets[p.category ?? 'Other']) flags.push('no live peer in its category: the size line alone sets its multiple');
  return {
    peer_multiple: peer,
    growth_pct: growth,
    growth_multiplier: growthMult,
    maturity_multiplier: maturity,
    age_days: age,
    implied,
    low: Math.max(1, Math.round(implied * Math.exp(fit.q25))),
    high: Math.max(1, Math.round(implied * Math.exp(fit.q75))),
    flags,
  };
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  token_status: 'pre-token';
  scope: 'watchlist' | 'early';
  window: string;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  model: { version: string; peer_multiple: number; growth_pct: number; growth_multiplier: number; maturity_multiplier: number };
  flags: string[];
  farm_chain: string;
  farm_capital_usd: number;
  farm_gas_usd: number;
  farm_days: number;
  farm_steps: string[];
  plan: FarmStep[];
}

const bySlug = (a: { slug: string }, b: { slug: string }): number => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);

/** A protocol the dashboard shows outside the ranked board: its status, the reason and its own figures. */
export interface SideRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  symbol: string | null;
  reason: string;
}

/** Everything the dashboard needs: the board, the others, and the model it ran. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  fit: PeerFit;
  counts: { protocols: number; watchlist: number; ranked: number; early: number; live: number; live_with_mcap: number; set_aside: number };
  rows: Array<Omit<BoardRow, 'farm_steps' | 'model' | 'token_status'> & { peer_multiple: number; growth_multiplier: number; maturity_multiplier: number; growth_pct: number }>;
  live: SideRow[];
  aside: SideRow[];
  peers: Array<{ slug: string; name: string; tvl_usd: number; mcap_usd: number }>;
}

/** Score and rank every pre-token protocol; the live and set-aside piles come back beside the board. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const onList = new Set(snapshot.watchlist);
  const fit = fitPeers(snapshot, model);
  const ranked: Array<{ p: SnapshotProtocol; s: Scored }> = [];
  const live: SideRow[] = [];
  const aside: SideRow[] = [];
  for (const p of [...snapshot.protocols].sort(bySlug)) {
    const v = classify(p, snapshot, onList);
    const side: SideRow = { slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, change_7d: p.change_7d, mcap_usd: p.mcap_usd, symbol: p.symbol, reason: v.reason };
    if (v.status === 'pre-token') ranked.push({ p, s: score(p, snapshot.as_of, fit, model) });
    else if (v.status === 'live') live.push(side);
    else aside.push(side);
  }
  // Highest implied value first; a tie goes to the larger TVL, then the slug, so two runs write the same bytes.
  ranked.sort((a, b) => b.s.implied - a.s.implied || b.p.tvl_usd - a.p.tvl_usd || bySlug(a.p, b.p));
  const board: BoardRow[] = ranked.map(({ p, s }, i) => {
    const plan = farmPlan(p, s.age_days, s.implied, model.airdrop_share);
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: s.age_days,
      token_status: 'pre-token',
      scope: onList.has(p.slug) ? 'watchlist' : 'early',
      window: windowOf(s.age_days),
      implied_value_usd: s.implied,
      implied_low_usd: s.low,
      implied_high_usd: s.high,
      model: { version: MODEL_VERSION, peer_multiple: s.peer_multiple, growth_pct: s.growth_pct, growth_multiplier: s.growth_multiplier, maturity_multiplier: s.maturity_multiplier },
      flags: s.flags,
      farm_chain: plan.chain,
      farm_capital_usd: plan.capital,
      farm_gas_usd: plan.gas_total,
      farm_days: plan.hold_days,
      farm_steps: plan.steps.map(planText),
      plan: plan.steps,
    };
  });
  live.sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || bySlug(a, b));
  aside.sort((a, b) => b.tvl_usd - a.tvl_usd || bySlug(a, b));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    fit,
    counts: {
      protocols: snapshot.protocols.length,
      watchlist: snapshot.watchlist.length,
      ranked: board.length,
      early: board.filter((r) => r.scope === 'early').length,
      live: live.length,
      live_with_mcap: live.filter((r) => r.mcap_usd !== null).length,
      set_aside: aside.length,
    },
    rows: board.map(({ farm_steps: _steps, model: m, token_status: _t, ...rest }) => ({ ...rest, peer_multiple: m.peer_multiple, growth_multiplier: m.growth_multiplier, maturity_multiplier: m.maturity_multiplier, growth_pct: m.growth_pct })),
    live,
    aside,
    peers: peersOf(snapshot).map((p) => ({ slug: p.slug, name: p.name, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd! })),
  };
  return { board, radar };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, the gate takes 100 to 4000`;
  if (slugs.size !== board.length) return 'a slug appears twice';
  for (const s of slugs) if (!known.has(s)) return `${s} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  for (const r of board) {
    if (r.name.length === 0) return `${r.slug} has no name`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
