import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import styles from './MapLabels.module.css';

export interface LabelItem {
  id: string;
  lon: number;
  lat: number;
  text: string;
  kind: 'end' | 'stop';
  color?: string;
  dotR?: number;          // radius (px) of the dot the label is attached to
  badge?: string;         // small bold suffix, e.g. "9%"
  title?: string;         // tooltip with the full (un-truncated) text
  partial?: boolean;
  active?: boolean;
  maxWidth?: number;      // px, text is ellipsised beyond this (wraps for 'mostlikely')
  must?: boolean;         // always placed (grid search as a last resort), and placed first
  highlight?: boolean;    // hovered from the panel
  onHover?: (on: boolean) => void;
  onClick?: () => void;
}

interface Placed { item: LabelItem; x: number; y: number; w: number; h: number; ax: number; ay: number; far: boolean }
interface Rect { x: number; y: number; w: number; h: number }

const MARGIN = 24;     // keep labels this far from the map edges
const FONT = '600 11px Inter, system-ui, sans-serif';
let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(t: string): number {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return t.length * 6.4;
  measureCtx.font = FONT;
  return measureCtx.measureText(t).width;
}

const hit = (a: Rect, b: Rect, pad = 0) => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
const overlapArea = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

function size(item: LabelItem): { w: number; h: number } {
  const extra = (item.kind === 'end' ? 16 : 0) + (item.badge ? textWidth(item.badge) + 6 : 0) + 22; // padding + border + icon/badge
  const tw = textWidth(item.text);
  const maxW = item.maxWidth ?? 260;
  return { w: Math.min(tw + extra, maxW), h: 25 };
}

export function layoutLabels(items: LabelItem[], project: (lon: number, lat: number) => { x: number; y: number }, W: number, H: number, obstacles: Rect[], lineSamples: { x: number; y: number }[] = []): Placed[] {
  const safe: Rect = { x: MARGIN, y: MARGIN, w: W - 2 * MARGIN, h: H - 2 * MARGIN };
  const inSafe = (r: Rect) => r.x >= safe.x && r.y >= safe.y && r.x + r.w <= safe.x + safe.w && r.y + r.h <= safe.y + safe.h;
  const anchors = items.map(it => { const p = project(it.lon, it.lat); const r = (it.dotR ?? 5) + 2; return { it, p, dot: { x: p.x - r, y: p.y - r, w: 2 * r, h: 2 * r } }; });
  const placed: Placed[] = [];
  const taken: Rect[] = [];
  const ordered = [...anchors].sort((x, y) => Number(!!y.it.must) - Number(!!x.it.must));   // priority labels pick their spot first
  for (const a of ordered) {
    const { it, p } = a;
    // anchor outside the visible/safe area or under a panel: nothing sensible to show
    if (p.x < 0 || p.y < 0 || p.x > W || p.y > H) continue;
    if (obstacles.some(o => hit({ x: p.x - 2, y: p.y - 2, w: 4, h: 4 }, o))) continue;
    const { w, h } = size(it);
    const g = (it.dotR ?? 5) + 6;
    const cands: [number, number][] = [];
    for (const k of [1, 2.4, 4]) {
      const d = g * k;
      cands.push([p.x + d, p.y - h / 2], [p.x - d - w, p.y - h / 2], [p.x - w / 2, p.y - d - h], [p.x - w / 2, p.y + d],
        [p.x + d * 0.7, p.y - h - d * 0.7], [p.x - w - d * 0.7, p.y - h - d * 0.7], [p.x + d * 0.7, p.y + d * 0.7], [p.x - w - d * 0.7, p.y + d * 0.7]);
    }
    const others = anchors.filter(o => o !== a).map(o => o.dot);
    let chosen: Rect | null = null; let chosenIdx = -1;
    // pass 1 keeps labels off the route lines; pass 2 allows crossing a line rather than dropping the label
    for (const avoidLines of [true, false]) {
      for (let i = 0; i < cands.length && !chosen; i++) {
        const r = { x: cands[i][0], y: cands[i][1], w, h };
        if (!inSafe(r)) continue;                                   // flip to another side instead of being cut off
        if (taken.some(t => hit(r, t, 3)) || obstacles.some(o => hit(r, o, 8)) || others.some(o => hit(r, o, 1))) continue;
        if (avoidLines && lineSamples.some(q => q.x > r.x - 3 && q.x < r.x + r.w + 3 && q.y > r.y - 3 && q.y < r.y + r.h + 3)) continue;
        chosen = r; chosenIdx = i;
      }
      if (chosen) break;
    }
    if (!chosen && it.must) {
      // grid search: the free spot nearest to the anchor, anywhere in the safe area
      let best: { r: Rect; d: number } | null = null;
      for (let gy = safe.y; gy + h <= safe.y + safe.h; gy += 8) {
        for (let gx = safe.x; gx + w <= safe.x + safe.w; gx += 8) {
          const r = { x: gx, y: gy, w, h };
          if (taken.some(t => hit(r, t, 3)) || obstacles.some(o => hit(r, o, 8)) || others.some(o => hit(r, o, 1))) continue;
          const d = Math.hypot(Math.min(Math.max(p.x, r.x), r.x + w) - p.x, Math.min(Math.max(p.y, r.y), r.y + h) - p.y);
          if (!best || d < best.d) best = { r, d };
        }
      }
      if (best) { chosen = best.r; chosenIdx = 99; }
    }
    if (!chosen) {
      // least-overlap fallback, clamped inside the safe area
      let best: { r: Rect; score: number } | null = null;
      for (const c of cands) {
        const r = { x: Math.min(Math.max(c[0], safe.x), safe.x + safe.w - w), y: Math.min(Math.max(c[1], safe.y), safe.y + safe.h - h), w, h };
        const score = taken.reduce((s, t) => s + overlapArea(r, t), 0) + obstacles.reduce((s, o) => s + overlapArea(r, o), 0) * 2;
        if (!best || score < best.score) best = { r, score };
      }
      chosen = best ? best.r : null;
      if (!chosen || (best && best.score > 0)) continue;   // would collide: skip rather than overlap another label
    }
    if (!chosen) continue;
    taken.push(chosen);
    const cx = Math.min(Math.max(p.x, chosen.x), chosen.x + chosen.w), cy = Math.min(Math.max(p.y, chosen.y), chosen.y + chosen.h);
    placed.push({ item: it, x: chosen.x, y: chosen.y, w: chosen.w, h: chosen.h, ax: p.x, ay: p.y, far: Math.hypot(cx - p.x, cy - p.y) > g * 1.6 || chosenIdx >= 8 });
  }
  return placed;
}

interface Props { mapRef: React.RefObject<any>; items: LabelItem[]; avoid?: [number, number][][] }

export const MapLabels: React.FC<Props> = ({ mapRef, items, avoid }) => {
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [moving, setMoving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const avoidRef = useRef(avoid);
  avoidRef.current = avoid;

  const compute = useCallback(() => {
    const map = mapRef.current?.getMap?.() ?? mapRef.current;
    const root = rootRef.current;
    if (!map || !root || !map.project) return;
    const box = root.getBoundingClientRect();
    const obstacles: Rect[] = Array.from(document.querySelectorAll('[data-label-obstacle]')).map(el => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return { x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height };
    });
    const list = itemsRef.current;
    if (!list.length) { setPlaced([]); return; }
    // sample the route lines in screen space (every ~8 px) so labels can stay clear of them
    const samples: { x: number; y: number }[] = [];
    for (const path of avoidRef.current ?? []) {
      let prev: { x: number; y: number } | null = null;
      for (const [lon, lat] of path) {
        const q = map.project([lon, lat]);
        if (prev) {
          const n = Math.min(60, Math.ceil(Math.hypot(q.x - prev.x, q.y - prev.y) / 8));
          for (let k = 1; k <= n; k++) samples.push({ x: prev.x + ((q.x - prev.x) * k) / n, y: prev.y + ((q.y - prev.y) * k) / n });
        }
        prev = q;
      }
    }
    setPlaced(layoutLabels(list, (lon, lat) => map.project([lon, lat]), box.width, box.height, obstacles, samples));
  }, [mapRef]);

  // recompute whenever the labels change
  useLayoutEffect(() => { compute(); }, [items, compute]);

  // ...and whenever the camera settles. Labels hide while the map is moving so they never drift off their dots.
  useEffect(() => {
    let cancelled = false; let off: (() => void) | null = null;
    const attach = () => {
      const map = mapRef.current?.getMap?.();
      if (cancelled) return;
      if (!map) { setTimeout(attach, 150); return; }
      const onStart = () => setMoving(true);
      const onEnd = () => { compute(); setMoving(false); };
      map.on('movestart', onStart); map.on('moveend', onEnd); map.on('resize', onEnd); map.on('idle', compute);
      off = () => { map.off('movestart', onStart); map.off('moveend', onEnd); map.off('resize', onEnd); map.off('idle', compute); };
      if (map.isMoving?.()) setMoving(true);
    };
    attach();
    return () => { cancelled = true; off?.(); };
  }, [mapRef, compute]);

  return (
    <div ref={rootRef} className={`${styles.root} ${moving ? styles.hidden : ''}`} aria-hidden={moving}>
      <svg className={styles.leaders}>
        {placed.filter(p => p.far).map(p => {
          const cx = Math.min(Math.max(p.ax, p.x), p.x + p.w), cy = Math.min(Math.max(p.ay, p.y), p.y + p.h);
          return <line key={p.item.id} x1={p.ax} y1={p.ay} x2={cx} y2={cy} stroke={p.item.color ?? '#64748B'} strokeWidth={1.5} strokeOpacity={0.8} />;
        })}
      </svg>
      {placed.map(p => {
        const it = p.item;
        const cls = [styles.pill, styles[it.kind], it.active ? styles.active : '', it.highlight ? styles.highlight : '', it.partial ? styles.partial : '', it.onClick ? styles.clickable : ''].join(' ');
        return (
          <div
            key={it.id}
            className={cls}
            data-map-label=""
            data-label-kind={it.kind}
            data-label-key={it.id}
            data-label-text={it.text}
            style={{ left: p.x, top: p.y, width: p.w, minHeight: p.h, borderLeftColor: it.color }}
            title={it.title ?? it.text}
            onClick={it.onClick}
            onMouseEnter={it.onHover ? () => it.onHover!(true) : undefined}
            onMouseLeave={it.onHover ? () => it.onHover!(false) : undefined}
          >
            {it.kind === 'end' && <span className={styles.flag} style={{ background: it.color }} />}
            <span className={styles.text}>{it.text}</span>
            {it.badge && <span className={styles.badge}>{it.badge}</span>}
          </div>
        );
      })}
    </div>
  );
};
