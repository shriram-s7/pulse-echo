// Pure helpers for the "Bus routes" view: identity, colours, geometry preparation and drop-off bands.
import { RouteFlowsData, RouteFlowItem, RouteDropoff } from './types';
import { toTitleCase } from './utils/formatters';

export const ROUTE_PALETTE = ['#E07A1F', '#8B5CF6', '#0EA5E9', '#DB2777', '#65A30D'];
export const OTHERS_GREY = '#9CA3AF';

export type LonLat = [number, number];

/** Unique id of a route + direction (the same route can appear in both directions). */
export const routeKey = (r: { route: string; dir?: string }) => `${r.route}|${r.dir ?? ''}`;

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const endName = (r: RouteFlowItem): string =>
  r.is_loop ? 'loop' : r.route_end?.name ? toTitleCase(r.route_end.name) : '—';

/** Display label: "S35", or "S35 → Ashok Pillar" when the same route shows up in more than one direction. */
export function routeLabel(r: RouteFlowItem, all: RouteFlowItem[]): string {
  const dup = all.some(o => o !== r && o.route === r.route);
  return dup ? `${r.route} → ${endName(r)}` : r.route;
}

export function truncate(s: string, max: number): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

export const formatHour = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** Backend bands: am_peak = 07–10, pm_peak = 16–20 (hour-of-day start inclusive, end exclusive). */
export function bandFor(hour: number): 'am_peak' | 'pm_peak' | 'all_day' {
  if (hour >= 7 && hour < 10) return 'am_peak';
  if (hour >= 16 && hour < 20) return 'pm_peak';
  return 'all_day';
}
export const BAND_LABEL = { am_peak: 'AM peak', pm_peak: 'PM peak', all_day: 'All day' } as const;

export function dropoffsFor(r: RouteFlowItem, hour: number): { list: RouteDropoff[]; band: keyof typeof BAND_LABEL; otherPct: number } {
  const d = r.dropoffs;
  const band = bandFor(hour);
  if (band !== 'all_day' && d?.[band]?.length) {
    return { list: d[band], band, otherPct: (band === 'am_peak' ? d.other_pct_am_peak : d.other_pct_pm_peak) ?? 0 };
  }
  return { list: d?.all_day ?? [], band: 'all_day', otherPct: d?.other_pct ?? 0 };
}

export function dropoffRadius(pct: number): number {
  return 4 + 5 * Math.sqrt(Math.min(60, Math.max(0, pct)) / 60); // 4–9 px
}

// ---------- geometry -------------------------------------------------------------------------------------------
const M_LAT = 111320;
const segMetres = (a: LonLat, b: LonLat) => {
  const dx = (b[0] - a[0]) * M_LAT * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
  const dy = (b[1] - a[1]) * M_LAT;
  return Math.hypot(dx, dy);
};
/** Counter-clockwise angle (degrees from east) of the a→b direction, as deck.gl IconLayer expects. */
const angleDeg = (a: LonLat, b: LonLat) => {
  const dx = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
  const dy = b[1] - a[1];
  return (Math.atan2(dy, dx) * 180) / Math.PI;
};


/**
 * Drop back-and-forth spikes: a point where the path turns by more than 150° and one of its two legs is shorter than 150 m
 * (GPS / map-matching noise, e.g. on 17D). First and last point are always kept. `idx` maps kept points to their original index.
 */
export function despike(path: LonLat[]): { pts: LonLat[]; idx: number[] } {
  let pts = path.map((p, i) => ({ p, i }));
  const turn = (a: LonLat, b: LonLat, c: LonLat) => {
    const k = Math.cos(((a[1] + c[1]) / 2) * Math.PI / 180);
    const v1x = (b[0] - a[0]) * k, v1y = b[1] - a[1], v2x = (c[0] - b[0]) * k, v2y = c[1] - b[1];
    const n = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
    if (n === 0) return 0;
    return (Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / n))) * 180) / Math.PI;
  };
  for (let pass = 0; pass < 20; pass++) {
    let changed = false;
    const out = [pts[0]];
    for (let j = 1; j < pts.length - 1; j++) {
      const a = out[out.length - 1].p, b = pts[j].p, c = pts[j + 1].p;
      if (turn(a, b, c) > 150 && Math.min(segMetres(a, b), segMetres(b, c)) < 150) { changed = true; continue; }
      out.push(pts[j]);
    }
    if (pts.length > 1) out.push(pts[pts.length - 1]);
    pts = out;
    if (!changed) break;
  }
  return { pts: pts.map(x => x.p), idx: pts.map(x => x.i) };
}

export interface Chevron { position: LonLat; angle: number; color: string; key: string }
export interface PreparedRoute {
  key: string;
  index: number;
  color: string;
  rgb: [number, number, number];
  label: string;
  item: RouteFlowItem;
  ahead: LonLat[];           // solid part
  faint: LonLat[][];         // parts of the route before the board stop (and beyond the route end), thin dashed
  chevrons: Chevron[];
  arrow: { position: LonLat; angle: number; color: string } | null;
  board: LonLat | null;
}

/** Decode the route file once: split full_path into before / ahead / tail, place chevrons and the end arrowhead. */
export function prepareRoutes(data: RouteFlowsData | null): PreparedRoute[] {
  if (!data?.routes) return [];
  const routes = data.routes.slice(0, 5);
  return routes.map((r, index) => {
    const color = ROUTE_PALETTE[index % ROUTE_PALETTE.length];
    const rawAhead = (r.ahead_path ?? r.path ?? []) as LonLat[];
    const ahead = rawAhead.length >= 3 ? despike(rawAhead).pts : rawAhead;
    const hasShape = r.has_shape && ahead.length >= 2;
    const out: PreparedRoute = {
      key: routeKey(r), index, color, rgb: hexToRgb(color), label: routeLabel(r, routes), item: r,
      ahead: hasShape ? ahead : [], faint: [], chevrons: [], arrow: null,
      board: hasShape ? ahead[0] : null
    };
    if (!hasShape) return out;
    const fullRaw = (r.full_path ?? null) as LonLat[] | null;
    const bi = r.board_index ?? 0;
    if (fullRaw && fullRaw.length > 1) {
      const { pts: full, idx } = despike(fullRaw);
      const ei = bi + rawAhead.length - 1;
      // indices in the cleaned path that correspond to the original board / end positions
      const cb = Math.max(0, idx.filter(i => i <= bi).length - 1);
      const ce = idx.findIndex(i => i >= ei);
      if (bi > 0) out.faint.push(full.slice(0, cb + 1));
      if (ce >= 0 && ce < full.length - 1) out.faint.push(full.slice(ce));
    }
    // chevrons every ~1.5 km along ahead_path (first one 750 m in), never right at the end arrowhead
    let total = 0;
    for (let i = 1; i < ahead.length; i++) total += segMetres(ahead[i - 1], ahead[i]);
    let acc = 0, next = 750;
    for (let i = 1; i < ahead.length; i++) {
      const a = ahead[i - 1], b = ahead[i], len = segMetres(a, b);
      while (len > 0 && acc + len >= next) {
        const t = (next - acc) / len;
        if (total - next > 400) out.chevrons.push({ position: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], angle: angleDeg(a, b), color, key: out.key });
        next += 1500;
      }
      acc += len;
    }
    // ONE arrowhead at the route end, following the last non-degenerate segment (works for loops too)
    const last = ahead[ahead.length - 1];
    let prev = ahead[ahead.length - 2];
    for (let i = ahead.length - 2; i >= 0; i--) { if (segMetres(ahead[i], last) > 15) { prev = ahead[i]; break; } }
    out.arrow = { position: last, angle: angleDeg(prev, last), color };
    return out;
  });
}

// ---------- chevrons / arrowhead as geometry (no textures: always renders, scales with the map) ---------------------
export const metresPerPixel = (zoom: number, lat: number) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);

/** Local outline (unit = half-size, tip at +x) rotated by angleDeg (CCW from east) and placed at `at`, sized in screen pixels. */
function shape(at: LonLat, angleDeg: number, sizePx: number, zoom: number, outline: [number, number][]): LonLat[] {
  const S = (sizePx / 2) * metresPerPixel(zoom, at[1]);
  const a = (angleDeg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const kLon = 1 / (111320 * Math.cos((at[1] * Math.PI) / 180)), kLat = 1 / 111320;
  return outline.map(([x, y]) => [at[0] + (x * ca - y * sa) * S * kLon, at[1] + (x * sa + y * ca) * S * kLat] as LonLat);
}
const CHEVRON: [number, number][] = [[0.55, 0], [-0.45, 0.9], [-0.45, 0.5], [0.0, 0], [-0.45, -0.5], [-0.45, -0.9]];
const ARROW: [number, number][] = [[1, 0], [-0.85, 0.75], [-0.4, 0], [-0.85, -0.75]];
export const chevronPolygon = (c: { position: LonLat; angle: number }, zoom: number, px = 12) => shape(c.position, c.angle, px, zoom, CHEVRON);
export const arrowPolygon = (a: { position: LonLat; angle: number }, zoom: number, px = 22) => shape(a.position, a.angle, px, zoom, ARROW);
