import type {
  EventImpact, FlowCounts, FlowPlayer, FlowPlayersResponse, FlowResponse, FlowSignal, IntroStatus, PackHealthRow, PackResultGroup,
  ReleaseCheck, VersionPackResults,
} from '../../shared/protocol';
import { DEFAULT_HUB_DATE } from '../../shared/protocol';
import { apiUrl } from '../api';
import { h, svg, fmtInt, fmtPct, fmtDateTime, fmtDuration, fmtTime, fmtDay } from './dom';
import { renderShareChart, renderShareTable, sparkline, renderFunnel, type ShareChartSpec } from './charts';

const DAY = 86_400_000;
const RELOAD_MS = 5 * 60_000;
const PAGE_SIZE = 25;
/** Same bar as the server's fast check: enough players tried the pack, and most of them failed */
const FAST_MIN_TRIED = 8;
const FAST_FAIL_RATE = 0.6;
/** Fewer players than this and a before/after share is left out */
const IMPACT_MIN = 5;

const OUTCOME_LABEL: Record<IntroStatus, string> = {
  finished: 'Finished',
  welcome: 'Stopped at welcome screen',
  compatibility: 'Stopped at compatibility check',
  other: 'Left rooms, not recorded',
};
const OUTCOME_SHORT: Record<IntroStatus, string> = {
  finished: 'Finished',
  welcome: 'Welcome screen',
  compatibility: 'Compatibility check',
  other: 'Other',
};
const OUTCOME_COLOR: Record<IntroStatus, string> = {
  finished: 'var(--series-1)',
  welcome: 'var(--series-2)',
  compatibility: 'var(--series-3)',
  other: 'var(--text-muted)',
};
const RESULT_LABEL: Record<PackResultGroup['result'], string> = {
  loaded: 'Loaded',
  failed_reload: 'Failed to reload',
  failed_download: 'Failed to download',
  declined: 'Declined',
  no_result: 'No result reported',
  not_sent: 'Not sent',
  unknown: 'No record',
};
const LEVEL_LABEL: Record<FlowSignal['level'], string> = {
  critical: 'Critical', warning: 'Warning', info: 'Note', good: 'OK',
};

let rangeDays: number | 'all' = 28;
let data: FlowResponse | null = null;
let outcomeFilter: IntroStatus | '' = '';
let playersShown: FlowPlayer[] = [];
let playersTotal = 0;
let showAllReleases = false;
const tableMode = { outcome: false, pack: false };
let onShowOnMap: (p: FlowPlayer) => void = () => {};

const $ = (id: string) => document.getElementById(id)!;

export function initFlowPage(opts: { onShowOnMap: (p: FlowPlayer) => void }): void {
  onShowOnMap = opts.onShowOnMap;
  try {
    const saved = localStorage.getItem('flow-range');
    if (saved) rangeDays = saved === 'all' ? 'all' : Number(saved) || 28;
  } catch {
    // Storage blocked: keep the default range
  }

  for (const btn of $('range-buttons').querySelectorAll<HTMLButtonElement>('button')) {
    btn.addEventListener('click', () => {
      rangeDays = btn.dataset.days === 'all' ? 'all' : Number(btn.dataset.days);
      try {
        localStorage.setItem('flow-range', String(rangeDays));
      } catch {
        // Not remembered, which is fine
      }
      load();
    });
  }
  for (const btn of $('outcome-filter').querySelectorAll<HTMLButtonElement>('button')) {
    btn.addEventListener('click', () => {
      outcomeFilter = (btn.dataset.outcome || '') as IntroStatus | '';
      loadPlayers(true);
    });
  }
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.table-toggle')) {
    btn.addEventListener('click', () => {
      const key = btn.dataset.chart as keyof typeof tableMode;
      tableMode[key] = !tableMode[key];
      renderCharts();
    });
  }

  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderCharts, 150);
  });
  setInterval(() => {
    if (!document.hidden && !$('view-flow').hidden) load();
  }, RELOAD_MS);

  load();
}

/** Re-draw sizes after the view becomes visible again */
export function onFlowShown(): void {
  renderCharts();
}

function range(): { from: number; to: number } {
  const to = Date.now();
  return { from: rangeDays === 'all' ? DEFAULT_HUB_DATE : to - rangeDays * DAY, to };
}

function periodName(): string {
  if (rangeDays === 'all') return 'since the hub opened';
  return rangeDays % 7 === 0 ? `${rangeDays / 7} weeks` : `${rangeDays} days`;
}

async function load(): Promise<void> {
  const body = $('flow-body');
  body.classList.add('is-loading');
  const { from, to } = range();
  try {
    const res = await fetch(apiUrl(`/api/flow?from=${from}&to=${to}`));
    if (res.status === 503) {
      $('freshness').textContent = 'Server is still loading data…';
      setTimeout(load, 5000);
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
    render();
    await loadPlayers(true);
  } catch (e) {
    console.error('Failed to load flow data:', e);
    $('freshness').textContent = 'Could not load data; retrying in 5 minutes';
  } finally {
    body.classList.remove('is-loading');
  }
}

function render(): void {
  if (!data) return;
  $('freshness').textContent = `Data as of ${fmtTime(data.generatedAt)} · refreshes every 15 min`;
  for (const btn of $('range-buttons').querySelectorAll<HTMLButtonElement>('button')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.days === String(rangeDays)));
  }
  $('range-note').textContent = data.previous
    ? `${fmtDay(data.range.from)} to today, compared with the ${periodName()} before`
    : `${fmtDay(data.range.from)} to today`;
  renderSignals(data.signals);
  renderReleaseCheck(data.releaseCheck, data.sources.packs);
  renderKpis(data);
  renderFunnelCard(data);
  renderCharts();
  renderEventImpacts(data.eventImpacts);
  renderByClient(data);
  renderByResult(data);
  renderTries(data);
  renderByPack(data);
  renderPackHealth(data.packHealth);
}

/* ---- Signals ---- */

const ICON_PATHS: Record<FlowSignal['level'], string> = {
  critical: 'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM7.25 4.5h1.5v4.5h-1.5Zm0 6h1.5V12h-1.5Z',
  warning: 'M8 1.8 15 14.2H1L8 1.8Zm-.75 4.7v4h1.5v-4Zm0 5v1.5h1.5V11.5Z',
  info: 'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM7.25 7h1.5v5h-1.5Zm0-3h1.5v1.5h-1.5Z',
  good: 'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm3.2 4.3-4 4.6-2.4-2.2 1-1.1 1.3 1.2 3-3.5Z',
};

function statusIcon(level: FlowSignal['level']): SVGSVGElement {
  return svg('svg', { viewBox: '0 0 16 16', width: 16, height: 16, class: `status-icon ${level}`, 'aria-hidden': 'true' },
    svg('path', { d: ICON_PATHS[level], 'fill-rule': 'evenodd' }));
}

function renderSignals(signals: FlowSignal[]): void {
  $('signal-list').replaceChildren(...signals.map((s) => h('li', { class: `signal ${s.level}` },
    h('div', { class: 'signal-level' }, statusIcon(s.level), LEVEL_LABEL[s.level]),
    h('div', { class: 'signal-body' }, h('strong', {}, s.title), h('p', {}, s.detail)))));
}

/* ---- The last 24 hours and new releases ---- */

const tried = (v: { loaded: number; failed: number }) => v.loaded + v.failed;

function failCell(v: { loaded: number; failed: number }): HTMLElement | string {
  const n = tried(v);
  if (n === 0) return '–';
  const high = n >= FAST_MIN_TRIED && v.failed / n >= FAST_FAIL_RATE;
  return h('span', { class: 'fail-cell', title: `${fmtInt(v.failed)} of ${fmtInt(n)}` },
    meter(v.failed, n, 'var(--series-7)'),
    high ? h('span', { class: 'flag critical' }, statusIcon('critical'), 'Failing') : null);
}

function versionLabel(v: VersionPackResults): HTMLElement {
  return h('span', { class: 'version-cell' }, v.version, v.matchesServer ? h('span', { class: 'tag' }, 'current server version') : null);
}

function renderReleaseCheck(rc: ReleaseCheck, packs: boolean): void {
  const versions = $('fast-versions');
  if (!packs) {
    versions.replaceChildren(h('p', { class: 'empty' }, 'Pack results are unavailable: the Architect database could not be reached.'));
  } else if (rc.last24h.players === 0) {
    versions.replaceChildren(h('p', { class: 'empty' }, 'No new players in the last 24 hours.'));
  } else {
    versions.replaceChildren(table(
      [
        { label: 'Game version' }, { label: 'New players', num: true }, { label: 'Loaded', num: true }, { label: 'Failed to load' },
        { label: 'Declined', num: true }, { label: 'Finished the intro' }, { label: 'Packs they got' },
      ],
      rc.last24h.byClient.map((v) => [
        versionLabel(v), fmtInt(v.players), fmtInt(v.loaded), failCell(v), fmtInt(v.declined),
        meter(v.finished ?? 0, v.players, 'var(--series-1)'),
        v.releases?.length ? v.releases.slice(0, 2).join(', ') + (v.releases.length > 2 ? ` +${v.releases.length - 2}` : '') : '–',
      ])),
    h('p', { class: 'table-note' }, `${fmtInt(rc.last24h.players)} new players since ${fmtDateTime(rc.last24h.from)}. Failing: at least ${FAST_MIN_TRIED} tried the pack and ${Math.round(FAST_FAIL_RATE * 100)}% or more of them failed; this raises a critical signal.`));
  }

  const releases = $('new-releases');
  if (rc.trackingSince === null) {
    releases.replaceChildren(h('p', { class: 'empty' }, 'Waiting for the first pack data.'));
    return;
  }
  if (rc.newReleases.length === 0) {
    releases.replaceChildren(h('p', { class: 'empty' },
      `None in the last 7 days. Releases are noted the first time a player gets one (within 15 minutes); tracking started ${fmtDateTime(rc.trackingSince)}.`));
    return;
  }
  const rows: (HTMLElement | string)[][] = [];
  for (const r of rc.newReleases) {
    for (const v of r.byClient) {
      rows.push([`${r.variant} ${r.version}`, fmtDateTime(r.firstSeen), versionLabel(v), fmtInt(v.players), fmtInt(v.loaded), failCell(v), fmtInt(v.declined)]);
    }
  }
  releases.replaceChildren(table(
    [
      { label: 'Release' }, { label: 'First seen' }, { label: 'Game version' }, { label: 'Players', num: true },
      { label: 'Loaded', num: true }, { label: 'Failed to load' }, { label: 'Declined', num: true },
    ], rows),
  h('p', { class: 'table-note' }, 'Every player whose latest pack is the release, not only new players. Releases stay here for 7 days after they first appear.'));
}

/* ---- Before and after each event ---- */

/** "62% → 31%" with the change in points, or a count a day */
function changeCell(before: [number, number] | null, after: [number, number], upIsGood: boolean, perDay = false): HTMLElement | string {
  const value = ([n, d]: [number, number]) => (perDay ? (d > 0 ? n / d : null) : d >= IMPACT_MIN ? n / d : null);
  const show = (v: number | null) => (v === null ? '–' : perDay ? v.toFixed(1) : `${Math.round(v * 100)}%`);
  const a = value(after);
  const b = before ? value(before) : null;
  if (a === null && b === null) return '–';
  let change: HTMLElement | null = null;
  if (a !== null && b !== null) {
    const diff = perDay ? (b > 0 ? Math.round(((a - b) / b) * 100) : 0) : Math.round((a - b) * 100);
    const small = Math.abs(diff) < (perDay ? 10 : 3);
    const tone = small ? 'neutral' : (diff > 0) === upIsGood ? 'good' : 'bad';
    change = h('span', { class: `change ${tone}` },
      small ? 'about the same' : `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)}${perDay ? '%' : ' pts'}`);
  }
  return h('span', { class: 'change-cell' }, `${show(b)} → ${show(a)}`, change);
}

function renderEventImpacts(impacts: EventImpact[]): void {
  const el = $('event-impacts');
  if (impacts.length === 0) {
    el.replaceChildren(h('p', { class: 'empty' }, 'No markers yet: add dated changes to events.json.'));
    return;
  }
  const pair = (c: FlowCounts | null, num: (c: FlowCounts) => number, den: (c: FlowCounts) => number): [number, number] | null =>
    c ? [num(c), den(c)] : null;
  el.replaceChildren(table(
    [
      { label: 'Marker' }, { label: 'New players a day', num: true }, { label: 'Finished the intro', num: true },
      { label: 'Pack failed to load', num: true }, { label: 'Reached another server', num: true }, { label: 'Came back within 7 days', num: true },
    ],
    impacts.map((e) => {
      const days = Math.floor(e.afterDays);
      const note = e.afterDays <= 0 ? 'not yet' : e.afterDays < 7 ? `after: ${days === 0 ? 'less than a day' : `${days} of 7 days`} so far` : null;
      return [
        h('span', { class: 'event-cell' }, h('span', {}, `${fmtDay(new Date(e.date + 'T00:00').getTime())}: ${e.label}`),
          note ? h('span', { class: 'muted' }, note) : null,
          e.before === null ? h('span', { class: 'muted' }, 'before the hub opened') : null),
        changeCell(e.before ? [e.before.players, e.beforeDays] : null, [e.after.players, e.afterDays], true, true),
        changeCell(pair(e.before, (c) => c.finished, (c) => c.players), [e.after.finished, e.after.players], true),
        changeCell(pair(e.before, (c) => c.packFailed, (c) => c.packKnown), [e.after.packFailed, e.after.packKnown], false),
        changeCell(pair(e.before, (c) => c.reachedServer, (c) => c.activityKnown), [e.after.reachedServer, e.after.activityKnown], true),
        changeCell(pair(e.before, (c) => c.returned7d, (c) => c.returnEligible), [e.after.returned7d, e.after.returnEligible], true),
      ];
    })),
  h('p', { class: 'table-note' },
    `Newest first. Shares need at least ${IMPACT_MIN} players. Windows of markers less than 7 days apart overlap. Came back within 7 days only counts players who joined at least 7 days ago; server moves are known from the proxy logs.`));
}

/* ---- KPI tiles ---- */

interface Tile {
  label: string;
  num: number;
  den: number;
  prev: [number, number] | null;
  /** Whether a rise is good news */
  upIsGood: boolean;
  /** A count rather than a share */
  count?: boolean;
  spark: (number | null)[];
  note?: string;
}

function renderKpis(d: FlowResponse): void {
  const t = d.totals, p = d.previousTotals;
  const rateSpark = (num: (c: FlowCounts) => number, den: (c: FlowCounts) => number) =>
    d.series.map((b) => (den(b) > 0 ? num(b) / den(b) : null));
  const prevOf = (num: (c: FlowCounts) => number, den: (c: FlowCounts) => number): [number, number] | null =>
    p && den(p) > 0 ? [num(p), den(p)] : null;

  const tiles: Tile[] = [
    { label: 'New players', num: t.players, den: 1, count: true, upIsGood: true, prev: p ? [p.players, 1] : null, spark: d.series.map((b) => b.players) },
    { label: 'Finished the intro', num: t.finished, den: t.players, upIsGood: true, prev: prevOf((c) => c.finished, (c) => c.players), spark: rateSpark((c) => c.finished, (c) => c.players) },
    { label: 'Stopped at the welcome screen', num: t.welcome, den: t.players, upIsGood: false, prev: prevOf((c) => c.welcome, (c) => c.players), spark: rateSpark((c) => c.welcome, (c) => c.players) },
    { label: 'Stopped at the compatibility check', num: t.compatibility, den: t.players, upIsGood: false, prev: prevOf((c) => c.compatibility, (c) => c.players), spark: rateSpark((c) => c.compatibility, (c) => c.players) },
    {
      label: 'Resource pack failed to load', num: t.packFailed, den: t.packKnown, upIsGood: false,
      prev: prevOf((c) => c.packFailed, (c) => c.packKnown), spark: rateSpark((c) => c.packFailed, (c) => c.packKnown),
      note: d.sources.packs ? undefined : 'No pack data',
    },
    {
      label: 'Came back within 7 days', num: t.returned7d, den: t.returnEligible, upIsGood: true,
      prev: prevOf((c) => c.returned7d, (c) => c.returnEligible), spark: rateSpark((c) => c.returned7d, (c) => c.returnEligible),
      note: d.sources.activityFrom === null ? 'No proxy logs' : t.returnEligible === 0 ? 'Too recent to tell' : `of ${fmtInt(t.returnEligible)} who joined 7+ days ago`,
    },
  ];
  $('kpis').replaceChildren(...tiles.map((tile) => kpiTile(tile)));
}

function kpiTile(t: Tile): HTMLElement {
  const value = t.count ? fmtInt(t.num) : t.den > 0 ? fmtPct(t.num, t.den) : '–';
  let delta: HTMLElement | null = null;
  if (t.prev && (t.count || t.den > 0)) {
    const change = t.count
      ? (t.prev[0] > 0 ? Math.round(((t.num - t.prev[0]) / t.prev[0]) * 100) : 0)
      : Math.round((t.num / t.den - t.prev[0] / t.prev[1]) * 100);
    const unit = t.count ? '%' : ' pts';
    const small = Math.abs(change) < (t.count ? 10 : 2);
    const good = (change > 0) === t.upIsGood;
    const tone = small ? 'neutral' : good ? 'good' : 'bad';
    const arrow = small ? '' : change > 0 ? '▲ ' : '▼ ';
    delta = h('div', { class: `kpi-delta ${tone}`, title: `Compared with the previous ${periodName()}` },
      `${arrow}${small ? 'about the same' : `${Math.abs(change)}${unit}`}`,
      h('span', { class: 'muted' }, ' vs before'));
  }
  return h('div', { class: 'kpi' },
    h('div', { class: 'kpi-label' }, t.label),
    h('div', { class: 'kpi-value' }, value),
    t.note ? h('div', { class: 'kpi-note' }, t.note) : !t.count && t.den > 0 ? h('div', { class: 'kpi-note' }, `${fmtInt(t.num)} of ${fmtInt(t.den)}`) : null,
    delta,
    sparkline(t.spark, `${t.label} per ${data?.range.bucket ?? 'day'}`));
}

/* ---- Funnel ---- */

function renderFunnelCard(d: FlowResponse): void {
  const t = d.totals, p = d.previousTotals;
  const prevShare = (k: keyof FlowCounts) => (p && p.players > 0 ? p[k] / p.players : null);
  const stages = [
    { label: 'Joined the hub', count: t.players, previousShare: null },
    {
      label: 'Finished the intro', count: t.finished, previousShare: prevShare('finished'),
      dropNote: [
        `${fmtInt(t.welcome)} stopped at the welcome screen`,
        `${fmtInt(t.compatibility)} at the compatibility check`,
        t.other ? `${fmtInt(t.other)} left the rooms without being recorded` : '',
      ].filter(Boolean).join(', '),
    },
  ];
  if (d.sources.activityFrom !== null) {
    // The proxy logs only reach back so far: no comparison tick for a period they mostly miss
    const prevCovered = p !== null && p.players > 0 && p.activityKnown >= p.players * 0.9;
    stages.push({
      label: 'Reached another server', count: t.finishedMovedOn, previousShare: prevCovered ? prevShare('finishedMovedOn') : null,
      dropNote: `${fmtInt(t.finished - t.finishedMovedOn)} finished but did not reach another server`,
    });
  }
  renderFunnel($('funnel'), stages, `Previous ${periodName()}`);

  const notes: string[] = ['Bars are shares of everyone who joined the hub in the range; ticks mark the period before.'];
  if (d.sources.activityFrom !== null && t.activityKnown < t.players) {
    notes.push(`Server moves come from the proxy logs and are known for players who joined since ${fmtDay(d.sources.activityFrom)}; ${fmtInt(t.players - t.activityKnown)} players who joined earlier count as not moved on.`);
  }
  $('funnel-sub').textContent = notes.join(' ');
  if (d.sources.activityFrom !== null) {
    $('funnel').append(h('p', { class: 'funnel-return' },
      h('strong', {}, `Came back within 7 days: ${t.returnEligible > 0 ? fmtPct(t.returned7d, t.returnEligible) : '–'}`),
      t.returnEligible > 0
        ? ` (${fmtInt(t.returned7d)} of the ${fmtInt(t.returnEligible)} who joined at least 7 days ago connected again on a later day)`
        : ' (nobody in this range joined 7 or more days ago)'));
  }
}

/* ---- Charts ---- */

function renderCharts(): void {
  if (!data || $('view-flow').hidden) return;
  const d = data;
  const buckets = d.series.map((b) => b.start);
  const per = d.range.bucket;

  const outcome: ShareChartSpec = {
    buckets, bucket: per,
    totals: d.series.map((b) => b.players),
    totalLabel: 'new players',
    series: (['finished', 'welcome', 'compatibility'] as const).map((k) => ({
      key: k, label: OUTCOME_LABEL[k], shortLabel: OUTCOME_SHORT[k], color: OUTCOME_COLOR[k], counts: d.series.map((b) => b[k]),
    })),
    events: d.events,
    partialLast: lastBucketRunning(d),
    ariaLabel: `Share of new players per ${per} who finished the intro, stopped at the welcome screen, or stopped at the compatibility check`,
  };
  drawChart('outcome', $('outcome-chart'), outcome);

  const pack: ShareChartSpec = {
    buckets, bucket: per,
    totals: d.series.map((b) => b.packKnown),
    totalLabel: 'new players with a pack record',
    series: [{ key: 'failed', label: 'Failed to load', color: 'var(--series-7)', counts: d.series.map((b) => b.packFailed) }],
    events: d.events,
    partialLast: lastBucketRunning(d),
    ariaLabel: `Share of new players per ${per} whose resource pack failed to load`,
  };
  if (d.sources.packs) drawChart('pack', $('pack-chart'), pack);
  else $('pack-chart').replaceChildren(h('p', { class: 'empty' }, 'Pack results are unavailable: the Architect database could not be reached.'));
}

/** Whether the last bucket (today, this week) has not ended yet */
function lastBucketRunning(d: FlowResponse): boolean {
  const last = d.series.at(-1);
  if (!last) return false;
  const start = new Date(last.start);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + (d.range.bucket === 'week' ? 7 : 1)).getTime();
  return d.generatedAt < end;
}

function drawChart(key: keyof typeof tableMode, el: HTMLElement, spec: ShareChartSpec): void {
  const toggle = document.querySelector<HTMLButtonElement>(`.table-toggle[data-chart="${key}"]`);
  if (toggle) toggle.textContent = tableMode[key] ? 'Show chart' : 'Show table';
  if (tableMode[key]) renderShareTable(el, spec);
  else renderShareChart(el, spec);
}

/* ---- Tables ---- */

function meter(num: number, den: number, color: string): HTMLElement {
  const share = den > 0 ? num / den : 0;
  return h('span', { class: 'meter-cell' },
    h('span', { class: 'meter' }, h('span', { class: 'meter-fill', style: `width:${share * 100}%;background:${color}` })),
    h('span', { class: 'meter-text' }, fmtPct(num, den)));
}

function table(headers: { label: string; num?: boolean }[], rows: (HTMLElement | string)[][]): HTMLElement {
  return h('div', { class: 'table-scroll' }, h('table', { class: 'data-table' },
    h('thead', {}, h('tr', {}, ...headers.map((c) => h('th', { scope: 'col', class: c.num ? 'num' : undefined }, c.label)))),
    h('tbody', {}, ...rows.map((r) => h('tr', {}, ...r.map((cell, i) => h(i === 0 ? 'th' : 'td', {
      scope: i === 0 ? 'row' : undefined, class: headers[i].num ? 'num' : undefined,
    }, cell)))))));
}

function renderByResult(d: FlowResponse): void {
  const el = $('by-result');
  if (!d.sources.packs) {
    el.replaceChildren(h('p', { class: 'empty' }, 'Pack results are unavailable: the Architect database could not be reached.'));
    return;
  }
  if (d.byPackResult.length === 0) {
    el.replaceChildren(h('p', { class: 'empty' }, 'No new players in this range.'));
    return;
  }
  el.replaceChildren(table(
    [{ label: 'Pack result' }, { label: 'Players', num: true }, { label: 'Finished the intro' }, { label: 'Stopped at welcome', num: true }, { label: 'Stopped at compatibility', num: true }],
    d.byPackResult.map((g) => [
      RESULT_LABEL[g.result], fmtInt(g.players), meter(g.finished, g.players, 'var(--series-1)'),
      fmtInt(g.welcome), fmtInt(g.compatibility),
    ])),
  h('p', { class: 'table-note' }, 'The intro only shows players how to move on once their resource pack has loaded.'));
}

function renderByClient(d: FlowResponse): void {
  const el = $('by-client');
  if (!d.sources.clients) {
    $('by-client-sub').textContent = '';
    el.replaceChildren(h('p', { class: 'empty' }, "Client versions are unavailable: Plan's database could not be reached."));
    return;
  }
  $('by-client-sub').textContent = `Each player's latest game version, from Plan. The intro's second room only lets players on ${d.serverVersion}, the server's version, through on its own.`;
  if (d.byClient.length === 0) {
    el.replaceChildren(h('p', { class: 'empty' }, 'No new players in this range.'));
    return;
  }
  const total = d.totals.players;
  el.replaceChildren(table(
    [
      { label: 'Game version' }, { label: 'Players', num: true }, { label: 'Share', num: true },
      { label: 'Finished the intro' }, { label: 'Stopped at welcome', num: true }, { label: 'Stopped at compatibility', num: true },
      { label: 'Pack failed to load' },
    ],
    d.byClient.map((g) => [
      h('span', { class: 'version-cell' }, g.version, g.matchesServer ? h('span', { class: 'tag' }, 'current server version') : null),
      fmtInt(g.players), fmtPct(g.players, total),
      meter(g.finished, g.players, 'var(--series-1)'),
      fmtInt(g.welcome), fmtInt(g.compatibility),
      g.packKnown > 0 ? meter(g.packFailed, g.packKnown, 'var(--series-7)') : '–',
    ])),
  h('p', { class: 'table-note' }, 'Pack failed to load is a share of the players in that row with a pack record.'));
}

function renderTries(d: FlowResponse): void {
  const el = $('tries');
  if (d.sources.sessionsFrom === null) {
    $('tries-sub').textContent = '';
    el.replaceChildren(h('p', { class: 'empty' }, 'No hub logs found.'));
    return;
  }
  $('tries-sub').textContent = `Hub visits from the server logs, known for players who joined since ${fmtDay(d.sources.sessionsFrom)}`;
  const rows = d.sessions.filter((s) => s.players > 0);
  if (rows.length === 0) {
    el.replaceChildren(h('p', { class: 'empty' }, 'No new players with log coverage in this range.'));
    return;
  }
  el.replaceChildren(table(
    [{ label: 'Outcome' }, { label: 'Players', num: true }, { label: 'Median visits', num: true }, { label: 'Joined 2+ times', num: true }, { label: 'Median first visit', num: true }],
    rows.map((s) => [
      outcomeBadge(s.outcome), fmtInt(s.players), s.medianSessions === null ? '–' : String(s.medianSessions),
      fmtPct(s.multiSession, s.players), fmtDuration(s.medianFirstSessionMs),
    ])));
}

function renderByPack(d: FlowResponse): void {
  const el = $('by-pack');
  if (!d.sources.packs || d.byPack.length === 0) {
    el.replaceChildren(h('p', { class: 'empty' }, d.sources.packs ? 'No pack records for this range.' : 'Pack results are unavailable.'));
    return;
  }
  el.replaceChildren(table(
    [{ label: 'Release' }, { label: 'Players', num: true }, { label: 'Finished the intro' }, { label: 'Failed to load' }],
    d.byPack.slice(0, 12).map((g) => [
      `${g.variant} ${g.version}`, fmtInt(g.players),
      meter(g.finished, g.players, 'var(--series-1)'), meter(g.packFailed, g.players, 'var(--series-7)'),
    ])));
}

function renderPackHealth(rows: PackHealthRow[]): void {
  const el = $('pack-health');
  if (rows.length === 0) {
    el.replaceChildren(h('p', { class: 'empty' }, 'Pack results are unavailable.'));
    return;
  }
  const visible = showAllReleases ? rows : rows.filter((r) => r.current);
  const toggle = h('button', { type: 'button', class: 'link-btn' }, showAllReleases ? 'Show only releases sent in the last 14 days' : `Show all ${rows.length} releases`);
  toggle.addEventListener('click', () => {
    showAllReleases = !showAllReleases;
    renderPackHealth(rows);
  });
  el.replaceChildren(
    table(
      [{ label: 'Release' }, { label: 'Players', num: true }, { label: 'Loaded', num: true }, { label: 'Failed to load' }],
      visible.map((r) => {
        const high = r.players >= 20 && r.failed / r.players >= 0.3;
        return [
          r.firstSeen !== null
            ? h('span', { class: 'version-cell' }, `${r.variant} ${r.version}`, h('span', { class: 'tag', title: `First seen ${fmtDateTime(r.firstSeen)}` }, `new ${fmtDay(r.firstSeen)}`))
            : `${r.variant} ${r.version}`,
          fmtInt(r.players), fmtPct(r.loaded, r.players),
          h('span', { class: 'fail-cell' }, fmtPct(r.failed, r.players),
            high ? h('span', { class: 'flag critical' }, statusIcon('critical'), 'High') : null),
        ];
      })),
    toggle);
}

/* ---- Player list ---- */

function outcomeBadge(o: IntroStatus): HTMLElement {
  return h('span', { class: 'badge' }, h('span', { class: 'dot', style: `background:${OUTCOME_COLOR[o]}` }), OUTCOME_LABEL[o]);
}

async function loadPlayers(reset: boolean): Promise<void> {
  for (const btn of $('outcome-filter').querySelectorAll<HTMLButtonElement>('button')) {
    btn.setAttribute('aria-pressed', String((btn.dataset.outcome || '') === outcomeFilter));
  }
  if (reset) playersShown = [];
  const { from, to } = range();
  const q = new URLSearchParams({ from: String(from), to: String(to), limit: String(PAGE_SIZE), offset: String(playersShown.length) });
  if (outcomeFilter) q.set('outcome', outcomeFilter);
  try {
    const res = await fetch(apiUrl(`/api/flow/players?${q}`));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const page: FlowPlayersResponse = await res.json();
    playersShown = playersShown.concat(page.players);
    playersTotal = page.total;
    renderPlayers();
  } catch (e) {
    console.error('Failed to load players:', e);
  }
}

function renderPlayers(): void {
  const el = $('players');
  if (playersShown.length === 0) {
    el.replaceChildren(h('p', { class: 'empty' }, 'No new players match.'));
    return;
  }
  const rows = playersShown.map((p) => {
    const mapBtn = h('button', { type: 'button', class: 'link-btn' }, 'Map');
    mapBtn.addEventListener('click', () => onShowOnMap(p));
    return [
      h('span', { class: 'player-cell', title: p.uuid }, p.name ?? p.uuid.slice(0, 8)),
      fmtDateTime(p.firstJoined),
      outcomeBadge(p.outcome),
      p.clientVersion ?? '–',
      p.pack?.pack ? `${p.pack.variant} ${p.pack.version}` : '–',
      p.pack ? RESULT_LABEL[p.pack.result] : '–',
      p.sessions === undefined ? '–' : String(p.sessions),
      p.reachedServer === undefined ? '–' : p.reachedServer ? 'Yes' : 'No',
      mapBtn,
    ];
  });
  const more = playersShown.length < playersTotal
    ? h('button', { type: 'button', class: 'btn-quiet' }, `Show ${Math.min(PAGE_SIZE, playersTotal - playersShown.length)} more of ${fmtInt(playersTotal - playersShown.length)}`)
    : null;
  more?.addEventListener('click', () => loadPlayers(false));
  el.replaceChildren(
    table([
      { label: 'Player' }, { label: 'First joined' }, { label: 'Intro' }, { label: 'Game version' }, { label: 'Latest pack' },
      { label: 'Pack result' }, { label: 'Hub visits', num: true }, { label: 'Reached a server' }, { label: '' },
    ], rows),
    h('p', { class: 'table-note' }, `${fmtInt(playersShown.length)} of ${fmtInt(playersTotal)} new players, newest first.`));
  if (more) el.append(more);
}
