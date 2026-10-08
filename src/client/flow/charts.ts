import type { FlowEvent } from '../../shared/protocol';
import { h, svg, fmtInt, fmtPct, bucketLabel, fmtDay } from './dom';

/**
 * Hand-drawn SVG charts for the flow page. Colours come from CSS custom
 * properties so light and dark themes switch without a redraw; all words
 * are inserted as text nodes.
 */

export interface ShareSeries {
  key: string;
  label: string;
  /** Used for the direct label at the line's end; the legend keeps the full label */
  shortLabel?: string;
  /** CSS colour, e.g. var(--series-1) */
  color: string;
  /** Numerator per bucket; the share is count / totals[i] */
  counts: number[];
}

export interface ShareChartSpec {
  buckets: number[];
  bucket: 'day' | 'week';
  /** Denominator per bucket */
  totals: number[];
  /** What the denominator counts, e.g. "new players" */
  totalLabel: string;
  series: ShareSeries[];
  events: FlowEvent[];
  ariaLabel: string;
  /** The last bucket is still running (today, this week): drawn dashed and not used for end labels */
  partialLast?: boolean;
}

const HEIGHT = 260;

/** Share-of-total lines (0–100%) with direct labels, event markers and a crosshair readout */
export function renderShareChart(container: HTMLElement, spec: ShareChartSpec): void {
  container.replaceChildren();
  const n = spec.buckets.length;
  if (n === 0 || spec.totals.every((t) => t === 0)) {
    container.append(h('p', { class: 'empty' }, 'No new players in this range.'));
    return;
  }

  const width = Math.max(320, container.clientWidth);
  const multi = spec.series.length > 1;
  const m = { left: 44, right: multi ? 170 : 64, top: 30, bottom: 28 };
  const plotW = width - m.left - m.right;
  const plotH = HEIGHT - m.top - m.bottom;
  const bw = plotW / n;
  const x = (i: number) => m.left + (i + 0.5) * bw;
  const y = (v: number) => m.top + (1 - v) * plotH;
  const share = (s: ShareSeries, i: number) => (spec.totals[i] > 0 ? s.counts[i] / spec.totals[i] : null);

  const root = svg('svg', { viewBox: `0 0 ${width} ${HEIGHT}`, width, height: HEIGHT, role: 'img', 'aria-label': spec.ariaLabel, class: 'chart-svg' });

  // Grid and y axis
  const grid = svg('g', { class: 'grid' });
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    grid.append(
      svg('line', { x1: m.left, x2: m.left + plotW, y1: y(v), y2: y(v), class: v === 0 ? 'axis-line' : 'grid-line' }),
      svg('text', { x: m.left - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }, `${v * 100}%`),
    );
  }
  root.append(grid);

  // X labels: days spaced to fit, weeks by month
  const xAxis = svg('g', { class: 'x-axis' });
  let lastLabelX = -Infinity;
  for (let i = 0; i < n; i++) {
    const d = new Date(spec.buckets[i]);
    const prev = i > 0 ? new Date(spec.buckets[i - 1]) : null;
    const text = spec.bucket === 'week'
      ? (!prev || prev.getMonth() !== d.getMonth() ? d.toLocaleString('en-GB', { month: 'short' }) : null)
      : fmtDay(spec.buckets[i]);
    if (!text || x(i) - lastLabelX < 52) continue;
    xAxis.append(svg('text', { x: x(i), y: HEIGHT - 8, 'text-anchor': 'middle', class: 'tick' }, text));
    lastLabelX = x(i);
  }
  root.append(xAxis);

  // Event markers, numbered; markers closer than a badge share one
  const eventsBox = h('ol', { class: 'chart-events' });
  const markers: { x: number; nums: number[] }[] = [];
  spec.events.forEach((e, k) => {
    const t = new Date(`${e.date}T00:00:00`).getTime();
    let i = spec.buckets.findIndex((b, j) => t >= b && (j === n - 1 || t < spec.buckets[j + 1]));
    if (i < 0) return;
    const span = (i < n - 1 ? spec.buckets[i + 1] : spec.buckets[i] + (spec.bucket === 'week' ? 7 : 1) * 86_400_000) - spec.buckets[i];
    const ex = m.left + (i + (t - spec.buckets[i]) / span) * bw;
    const last = markers.at(-1);
    if (last && ex - last.x < 20) last.nums.push(k + 1);
    else markers.push({ x: ex, nums: [k + 1] });
    eventsBox.append(h('li', {}, h('span', { class: 'event-num' }, String(k + 1)), `${fmtDay(t)} · ${e.label}`));
  });
  const eventLayer = svg('g', { class: 'events' });
  for (const mk of markers) {
    const label = mk.nums.join(',');
    const r = label.length > 1 ? 11 : 8;
    eventLayer.append(
      svg('line', { x1: mk.x, x2: mk.x, y1: m.top - 6, y2: m.top + plotH, class: 'event-line' }),
      svg('circle', { cx: mk.x, cy: m.top - 14, r, class: 'event-badge' }),
      svg('text', { x: mk.x, y: m.top - 10, 'text-anchor': 'middle', class: 'event-badge-text' }, label),
    );
  }
  root.append(eventLayer);

  // Lines, broken where a bucket has no players; a running last bucket is dashed
  const complete = spec.partialLast ? n - 1 : n;
  const ends: { s: ShareSeries; i: number; v: number }[] = [];
  for (const s of spec.series) {
    let d = '';
    let pen = false;
    for (let i = 0; i < complete; i++) {
      const v = share(s, i);
      if (v === null) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    }
    root.append(svg('path', { d, class: 'series-line', stroke: s.color }));
    const before = complete > 0 ? share(s, complete - 1) : null;
    const running = spec.partialLast ? share(s, n - 1) : null;
    if (before !== null && running !== null) {
      root.append(svg('path', {
        d: `M${x(complete - 1).toFixed(1)},${y(before).toFixed(1)}L${x(n - 1).toFixed(1)},${y(running).toFixed(1)}`,
        class: 'series-line partial', stroke: s.color,
      }));
    }
    for (let i = complete - 1; i >= 0; i--) {
      const v = share(s, i);
      if (v !== null) {
        ends.push({ s, i, v });
        break;
      }
    }
  }

  // End dots and direct labels, nudged apart with leader lines when they collide
  const labels = ends
    .map((e) => ({ ...e, ly: y(e.v) }))
    .sort((a, b) => a.ly - b.ly);
  for (let k = 1; k < labels.length; k++) {
    const minY = labels[k - 1].ly + 16;
    if (labels[k].ly < minY) labels[k].ly = minY;
  }
  const overflow = labels.length ? labels[labels.length - 1].ly - (m.top + plotH) : 0;
  if (overflow > 0) labels.forEach((l) => (l.ly -= overflow));
  const endLayer = svg('g', { class: 'end-labels' });
  for (const l of labels) {
    const ex = x(l.i), ey = y(l.v), lx = m.left + plotW + 10;
    if (Math.abs(l.ly - ey) > 3 || lx - ex > 14) {
      endLayer.append(svg('path', { d: `M${ex + 6},${ey} L${lx - 4},${l.ly}`, class: 'leader' }));
    }
    endLayer.append(
      svg('circle', { cx: ex, cy: ey, r: 4, fill: l.s.color, class: 'end-dot' }),
      svg('text', { x: lx, y: l.ly + 4, class: 'end-label' },
        svg('tspan', { class: 'end-value' }, fmtPct(l.s.counts[l.i], spec.totals[l.i])),
        multi ? ` ${l.s.shortLabel ?? l.s.label}` : ''),
    );
  }
  root.append(endLayer);

  // Crosshair readout
  const hover = svg('g', { class: 'hover', visibility: 'hidden' });
  const hoverLine = svg('line', { y1: m.top, y2: m.top + plotH, class: 'crosshair' });
  hover.append(hoverLine);
  const hoverDots = spec.series.map((s) => {
    const dot = svg('circle', { r: 4, fill: s.color, class: 'end-dot' });
    hover.append(dot);
    return dot;
  });
  root.append(hover);

  const overlay = svg('rect', {
    x: m.left, y: m.top, width: plotW, height: plotH, class: 'overlay', tabindex: 0,
    'aria-label': `${spec.ariaLabel}. Use the arrow keys to read each ${spec.bucket}.`,
  });
  root.append(overlay);

  const wrap = h('div', { class: 'chart-wrap' });
  const tip = h('div', { class: 'tooltip', role: 'status' });
  tip.hidden = true;
  wrap.append(root, tip);

  let current = -1;
  const show = (i: number) => {
    current = Math.max(0, Math.min(n - 1, i));
    const cx = x(current);
    hover.setAttribute('visibility', 'visible');
    hoverLine.setAttribute('x1', String(cx));
    hoverLine.setAttribute('x2', String(cx));
    spec.series.forEach((s, k) => {
      const v = share(s, current);
      hoverDots[k].setAttribute('visibility', v === null ? 'hidden' : 'visible');
      if (v !== null) {
        hoverDots[k].setAttribute('cx', String(cx));
        hoverDots[k].setAttribute('cy', String(y(v)));
      }
    });
    const running = spec.partialLast && current === n - 1;
    tip.replaceChildren(
      h('div', { class: 'tip-head' }, `${bucketLabel(spec.buckets[current], spec.bucket)}${running ? ' (so far)' : ''}`),
      h('div', { class: 'tip-sub' }, `${fmtInt(spec.totals[current])} ${spec.totalLabel}`),
      ...spec.series.map((s) => h('div', { class: 'tip-row' },
        h('span', { class: 'line-key', style: `background:${s.color}` }),
        h('strong', {}, fmtPct(s.counts[current], spec.totals[current])),
        h('span', {}, ` ${s.label}`),
        h('span', { class: 'muted' }, ` (${fmtInt(s.counts[current])})`))),
    );
    tip.hidden = false;
    const tipW = tip.offsetWidth;
    tip.style.left = `${cx + 12 + tipW > width ? Math.max(0, cx - tipW - 12) : cx + 12}px`;
    tip.style.top = `${m.top}px`;
  };
  const hide = () => {
    hover.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };
  const indexAt = (ev: PointerEvent) => {
    const rect = (root as SVGSVGElement).getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * width;
    return Math.floor((px - m.left) / bw);
  };
  overlay.addEventListener('pointermove', (ev) => show(indexAt(ev as PointerEvent)));
  overlay.addEventListener('pointerleave', hide);
  overlay.addEventListener('blur', hide);
  overlay.addEventListener('focus', () => show(current < 0 ? n - 1 : current));
  overlay.addEventListener('keydown', (ev) => {
    const e = ev as KeyboardEvent;
    if (e.key === 'ArrowLeft') show(current - 1);
    else if (e.key === 'ArrowRight') show(current + 1);
    else if (e.key === 'Escape') hide();
    else return;
    e.preventDefault();
  });

  if (multi) {
    container.append(h('div', { class: 'legend' }, ...spec.series.map((s) =>
      h('span', { class: 'legend-item' }, h('span', { class: 'line-key', style: `background:${s.color}` }), s.label))));
  }
  container.append(wrap);
  const notes: HTMLElement[] = [];
  if (spec.partialLast) notes.push(h('span', { class: 'chart-note' }, `Dashed: this ${spec.bucket} so far.`));
  if (spec.events.length || notes.length) container.append(h('div', { class: 'chart-foot' }, eventsBox, ...notes));
}

/** The same data as a table: the chart's accessible twin */
export function renderShareTable(container: HTMLElement, spec: ShareChartSpec): void {
  const head = h('tr', {}, h('th', { scope: 'col' }, spec.bucket === 'week' ? 'Week of' : 'Day'),
    h('th', { scope: 'col', class: 'num' }, spec.totalLabel.replace(/^./, (c) => c.toUpperCase())),
    ...spec.series.map((s) => h('th', { scope: 'col', class: 'num' }, s.label)));
  const rows = spec.buckets.map((b, i) => h('tr', {},
    h('th', { scope: 'row' }, fmtDay(b)),
    h('td', { class: 'num' }, fmtInt(spec.totals[i])),
    ...spec.series.map((s) => h('td', { class: 'num' }, `${fmtPct(s.counts[i], spec.totals[i])} (${fmtInt(s.counts[i])})`))));
  container.replaceChildren(h('div', { class: 'table-scroll' },
    h('table', { class: 'data-table' }, h('thead', {}, head), h('tbody', {}, ...rows.reverse()))));
}

/** A small trend line: the series in grey, its last point in the accent */
export function sparkline(values: (number | null)[], label: string): SVGSVGElement {
  const w = 104, ht = 30, pad = 3;
  const known = values.flatMap((v, i) => (v === null ? [] : [[i, v] as const]));
  const root = svg('svg', { viewBox: `0 0 ${w} ${ht}`, width: w, height: ht, class: 'sparkline', role: 'img', 'aria-label': label });
  if (known.length < 2) return root;
  const max = Math.max(...known.map(([, v]) => v)), min = Math.min(...known.map(([, v]) => v));
  const span = max - min || 1;
  const px = (i: number) => pad + (i / Math.max(1, values.length - 1)) * (w - pad * 2);
  const py = (v: number) => ht - pad - ((v - min) / span) * (ht - pad * 2);
  root.append(svg('path', { d: known.map(([i, v], k) => `${k ? 'L' : 'M'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(''), class: 'spark-line' }));
  const [li, lv] = known[known.length - 1];
  root.append(svg('circle', { cx: px(li), cy: py(lv), r: 3, class: 'spark-dot' }));
  return root;
}

export interface FunnelStage {
  label: string;
  count: number;
  /** Share of the first stage in the comparison period, for the marker */
  previousShare: number | null;
  /** Why players fell out before this stage */
  dropNote?: string;
}

/** Stages as horizontal bars against the first stage, with the comparison period marked */
export function renderFunnel(container: HTMLElement, stages: FunnelStage[], previousLabel: string): void {
  container.replaceChildren();
  const base = stages[0]?.count ?? 0;
  if (base === 0) {
    container.append(h('p', { class: 'empty' }, 'No new players in this range.'));
    return;
  }
  const list = h('ol', { class: 'funnel' });
  stages.forEach((s, k) => {
    if (s.dropNote) list.append(h('li', { class: 'funnel-drop' }, s.dropNote));
    const shareNow = s.count / base;
    const track = h('div', { class: 'funnel-track' },
      h('div', { class: `funnel-bar ord-${k + 1}`, style: `width:${Math.max(shareNow * 100, 0.5)}%` }));
    if (s.previousShare !== null && k > 0) {
      track.append(h('div', {
        class: 'funnel-prev',
        style: `left:${s.previousShare * 100}%`,
        title: `${previousLabel}: ${Math.round(s.previousShare * 100)}%`,
      }));
    }
    list.append(h('li', { class: 'funnel-row' },
      h('div', { class: 'funnel-label' }, s.label),
      track,
      h('div', { class: 'funnel-value' },
        h('strong', {}, k === 0 ? fmtInt(s.count) : fmtPct(s.count, base)),
        h('span', { class: 'muted' }, k === 0 ? ' players' : ` ${fmtInt(s.count)}`),
        s.previousShare !== null && k > 0
          ? h('span', { class: 'funnel-prev-text' }, `${previousLabel} ${Math.round(s.previousShare * 100)}%`)
          : null)));
  });
  container.append(list);
}
