// ONE source of truth for every percentage shown in the station views.
// Map pills, panel rows, bars, the donut and the cards all read from getStopShares / getRouteShares / getDropoffShares.
//
//  - Stop share    = "% of Metro exits who walk to this stop"   (Nearby stops tab; includes the "Walk / other" remainder → 100 %)
//  - Route share   = "% of bus-takers on this route"            (Bus routes tab; top 5 + Others → 100 %)
//  - Drop-off share= "% of this route's riders who get off here" (drop-off list + tooltip only; never a map pill)
//
// Rounding: largest-remainder, so the displayed integers of a group always sum to exactly 100.
// Values under 1 % are shown as "<1%" (and counted as 0 in the sum; the other items absorb the remainder).
import type { StationFlow, RouteFlowsData, RouteFlowItem, MostLikelyEntry, RouteDropoff } from '../types';
import { bandFor } from '../routeView';

export type Basis = 'daily' | 'hour';

// ---------- data registry (set by the screens when data is loaded) -------------------------------------------------
let FLOWS: StationFlow[] = [];
const ROUTE_FLOWS = new Map<string, RouteFlowsData>();

export function registerFlows(flows: StationFlow[] | undefined | null) {
  if (flows && flows !== FLOWS) FLOWS = flows;
}
export function registerRouteFlows(stationId: string, data: RouteFlowsData | null | undefined) {
  if (data) ROUTE_FLOWS.set(stationId, data);
  else ROUTE_FLOWS.delete(stationId);
}

// ---------- rounding ------------------------------------------------------------------------------------------------
export interface Rounded { raw: number; pct: number; label: string }

export function formatPct(raw: number, pct: number): string {
  if (pct === 0 && raw > 0) return '<1%';
  return `${pct}%`;
}

/** Largest-remainder rounding of `raws` (scaled to total 100). Items under 1 % get 0 ("<1%"), the rest share 100. */
export function roundShares(raws: number[]): Rounded[] {
  const clean = raws.map(v => (Number.isFinite(v) && v > 0 ? v : 0));
  const sum = clean.reduce((a, b) => a + b, 0);
  const scaled = sum > 0 ? clean.map(v => (v * 100) / sum) : clean.map(() => 0);
  const out = scaled.map(() => 0);
  if (sum > 0) {
    const eligible = scaled.map((v, i) => ({ v, i })).filter(e => e.v >= 1);
    const floors = eligible.map(e => Math.floor(e.v));
    let rest = 100 - floors.reduce((a, b) => a + b, 0);
    const order = eligible.map((e, k) => ({ k, frac: e.v - floors[k] })).sort((a, b) => b.frac - a.frac);
    for (let n = 0; rest > 0 && order.length; n++, rest--) floors[order[n % order.length].k] += 1;
    eligible.forEach((e, k) => { out[e.i] = floors[k]; });
  }
  return clean.map((raw, i) => ({ raw, pct: out[i], label: formatPct(raw, out[i]) }));
}

// ---------- stop shares (Nearby stops tab) ------------------------------------------------------------------------
export const MAX_STOPS = 6;

export interface StopShareRow extends Rounded {
  id: string;
  name: string;
  lat: number;
  lon: number;
  walkM: number;
  stopType?: string;
  routes: StationFlow['routes'];
  isOther: boolean;
}
export interface StopShares {
  rows: StopShareRow[];          // shown stops (≥ 1 %, max 6, largest first) + the "Walk / other" remainder last
  stops: StopShareRow[];         // rows without the remainder
  other: StopShareRow | null;
  busTotal: number;              // sum of the displayed stop shares (= 100 − Walk/other)
  hasFlows: boolean;
}

export function getStopShares(stationId: string, basis: Basis, hour: number): StopShares {
  const flows = FLOWS.filter(f => f.station_id === stationId);
  const bus = flows.filter(f => f.stop_id !== 'other');
  const rawOf = (f: StationFlow) => basis === 'daily' ? (f.share_pct ?? 0) : (f.hourly?.find(h => h.hour === hour)?.share_pct ?? 0);
  const shown = bus.map(f => ({ f, raw: rawOf(f) })).filter(e => e.raw >= 1).sort((a, b) => b.raw - a.raw).slice(0, MAX_STOPS);
  const shownSum = shown.reduce((s, e) => s + e.raw, 0);
  const otherRaw = Math.max(0, 100 - shownSum);
  const r = roundShares([...shown.map(e => e.raw), otherRaw]);
  const stops: StopShareRow[] = shown.map((e, i) => ({
    ...r[i], id: e.f.stop_id, name: e.f.stop_name, lat: e.f.stop_lat, lon: e.f.stop_lon, walkM: e.f.walk_m,
    stopType: e.f.stop_type, routes: e.f.routes ?? [], isOther: false
  }));
  const otherSrc = flows.find(f => f.stop_id === 'other');
  const other: StopShareRow | null = flows.length ? {
    ...r[r.length - 1], id: 'other', name: 'Walk / auto / not a nearby bus', lat: otherSrc?.stop_lat ?? 0, lon: otherSrc?.stop_lon ?? 0,
    walkM: 0, routes: [], isOther: true
  } : null;
  return {
    rows: other ? [...stops, other] : stops, stops, other,
    busTotal: stops.reduce((s, x) => s + x.pct, 0), hasFlows: bus.length > 0
  };
}

// ---------- route shares (Bus routes tab) -------------------------------------------------------------------------
export const routeId = (r: { route: string; dir?: string }) => `${r.route}|${r.dir ?? ''}`;

export interface RouteShareRow extends Rounded {
  key: string;
  index: number;                 // position in the file's top-5 (stable colour / geometry order)
  item: RouteFlowItem;
}
export interface CardRow extends Rounded {
  key: string;
  route: string;
  boardStop: string;
  waitMin: number | null;
}
export interface RouteShares {
  rows: RouteShareRow[];         // the file's top 5 routes
  others: Rounded & { count: number };
  card: CardRow[];               // top 3 at the chosen hour (always the "hour" ranking) — values equal the donut's
  hasData: boolean;
  total: number;                 // displayed sum of rows + others (always 100 when hasData)
}

export function getRouteShares(stationId: string, basis: Basis, hour: number): RouteShares {
  const data = ROUTE_FLOWS.get(stationId);
  const routes = (data?.routes ?? []).slice(0, 5);
  const othersCount = data?.others?.route_count ?? 0;
  const hourOf = (r: RouteFlowItem) => r.hourly?.find(h => h.hour === hour)?.share_pct ?? 0;

  // Build one flat list covering: top-5 routes, the hour's "most likely" routes that are outside the top 5, and the rest.
  const mlEntry = data?.most_likely?.[String(hour)];
  const mlAll: MostLikelyEntry[] = mlEntry && !mlEntry.fallback ? [mlEntry, ...(mlEntry.runners_up ?? [])].slice(0, 3) : [];
  const inTop = new Set(routes.map(routeId));
  const extras = basis === 'hour' ? mlAll.filter(e => !inTop.has(routeId(e))) : [];

  const raws = [
    ...routes.map(r => basis === 'daily' ? (r.share_pct ?? 0) : hourOf(r)),
    ...extras.map(e => e.share_pct_of_bus_takers ?? 0)
  ];
  const known = raws.reduce((a, b) => a + b, 0);
  const hourOthers = data?.others?.hourly?.find(h => h.hour === hour)?.share_pct ?? 0;
  const hasData = !!data && (basis === 'daily' ? (data.total_bus_transfers_per_day ?? 0) > 0 || known > 0 : known + hourOthers > 0);

  if (!data || !hasData) {
    const z = (r: RouteFlowItem, i: number): RouteShareRow => ({ key: routeId(r), index: i, item: r, raw: 0, pct: 0, label: '0%' });
    return { rows: routes.map(z), others: { raw: 0, pct: 0, label: '0%', count: othersCount }, card: [], hasData: false, total: 0 };
  }

  const restRaw = Math.max(0, 100 - known);
  const r = roundShares([...raws, restRaw]);
  const rows: RouteShareRow[] = routes.map((it, i) => ({ ...r[i], key: routeId(it), index: i, item: it }));
  const extraR = r.slice(routes.length, routes.length + extras.length);
  const restR = r[r.length - 1];
  const othersPct = extraR.reduce((s, x) => s + x.pct, 0) + restR.pct;
  const othersRaw = extraR.reduce((s, x) => s + x.raw, 0) + restR.raw;
  const others = { raw: othersRaw, pct: othersPct, label: formatPct(othersRaw, othersPct), count: othersCount };

  // Card: always the hour ranking (top 3 of the very same list the donut uses, so the rounded numbers are identical).
  let card: CardRow[] = [];
  if (basis === 'hour') {
    const cand: CardRow[] = [
      ...rows.map(x => ({ key: x.key, route: x.item.route, boardStop: x.item.board_stop, waitMin: x.item.avg_wait_min ?? null, raw: x.raw, pct: x.pct, label: x.label })),
      ...extras.map((e, k) => ({ key: routeId(e), route: e.route, boardStop: e.board_stop, waitMin: e.avg_wait_min ?? null, raw: extraR[k].raw, pct: extraR[k].pct, label: extraR[k].label }))
    ];
    card = cand.filter(c => c.raw > 0).sort((a, b) => b.raw - a.raw).slice(0, 3);
  } else {
    card = getRouteShares(stationId, 'hour', hour).card;
  }
  return { rows, others, card, hasData: true, total: rows.reduce((s, x) => s + x.pct, 0) + others.pct };
}

// ---------- drop-off shares (drop-off list + tooltip only) ----------------------------------------------------------
export interface DropoffRow extends Rounded { name: string; lat: number; lon: number }
export interface DropoffShares {
  band: 'am_peak' | 'pm_peak' | 'all_day';
  rows: DropoffRow[];
  other: Rounded;
  total: number;
}

/** Daily basis → the all-day list; Selected-hour basis → the band that contains the hour (AM peak / PM peak / all day). */
export function getDropoffShares(route: RouteFlowItem, basis: Basis, hour: number): DropoffShares {
  const d = route.dropoffs;
  const band = basis === 'hour' ? bandFor(hour) : 'all_day';
  const useBand = band !== 'all_day' && (d?.[band]?.length ?? 0) > 0;
  const list: RouteDropoff[] = useBand ? d[band] : (d?.all_day ?? []);
  const usedBand = useBand ? band : 'all_day';
  const otherRaw = useBand ? ((band === 'am_peak' ? d.other_pct_am_peak : d.other_pct_pm_peak) ?? 0) : (d?.other_pct ?? 0);
  const sum = list.reduce((s, x) => s + x.pct, 0);
  // the remainder is whatever is left to reach 100 (guards against 99.9 / 100.1 in the file)
  const r = roundShares([...list.map(x => x.pct), Math.max(otherRaw, 100 - sum)]);
  const rows = list.map((x, i) => ({ ...r[i], name: x.name, lat: x.lat, lon: x.lon }));
  const other = r[r.length - 1];
  return { band: usedBand, rows, other, total: rows.reduce((s, x) => s + x.pct, 0) + other.pct };
}
