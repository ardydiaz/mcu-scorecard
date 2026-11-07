import Chart from 'react-apexcharts';

// Charts of the Operational Dashboard (ApexCharts). Every chart uses the condition colors of the
// cards (`statuses`: [{ key, label, color }]) and filters the item list when a part is selected.
const FONT = 'Roboto, "Segoe UI", system-ui, sans-serif';
const MUTED = '#6b6478';
const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);
const countOf = (list, key) => list.filter((it) => it.status === key).length;
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// "Clear" = no issue and nothing waiting to be checked; the gauge color says how healthy that is
const CLEAR_LEVELS = [[90, '#2d6cb5'], [70, '#ffbc00'], [0, '#a93b3b']]; // blue = "Good condition"
export const clearColor = (value) => CLEAR_LEVELS.find(([min]) => value >= min)[1];
// Rounded down, so an area still having an item to deal with never shows 100%
export const clearRate = (list) => (list.length
  ? Math.floor((list.filter((it) => it.status !== 'issue' && it.status !== 'checking').length / list.length) * 100) : 0);

/** Donut: every item by condition; the total in the middle. Selecting a slice filters by that condition. */
export function ConditionDonut({ items, statuses, onSelect }) {
  const shown = statuses.filter((s) => countOf(items, s.key));
  const options = {
    chart: { type: 'donut', fontFamily: FONT, events: { dataPointSelection: (_e, _c, { dataPointIndex }) => onSelect(shown[dataPointIndex].key) } },
    labels: shown.map((s) => s.label),
    colors: shown.map((s) => s.color),
    stroke: { width: 2, colors: ['#ffffff'] },
    dataLabels: { enabled: true, formatter: (v) => `${Math.round(v)}%`, dropShadow: { enabled: false }, style: { fontSize: '12px', fontWeight: 700 } },
    legend: { show: false }, // the section's legend (above the cards) already names the colors
    plotOptions: {
      pie: {
        donut: {
          size: '62%',
          labels: {
            show: true,
            name: { fontSize: '13px', fontWeight: 600, color: MUTED, offsetY: 18 },
            value: { fontSize: '30px', fontWeight: 800, color: '#1f1a24', offsetY: -14, formatter: (v) => String(v) },
            total: { show: true, showAlways: true, label: 'Items', fontSize: '13px', fontWeight: 600, color: MUTED, formatter: () => String(items.length) },
          },
        },
      },
    },
    tooltip: { y: { formatter: (v) => `${v} item${v === 1 ? '' : 's'} (${pct(v, items.length)}%)` } },
    states: { active: { filter: { type: 'none' } } },
  };
  return (
    <div className="op-chart op-chart--donut">
      <div className="op-chart__title">Condition of all items</div>
      <Chart type="donut" series={shown.map((s) => countOf(items, s.key))} options={options} height={300} />
    </div>
  );
}

/**
 * Gauges with ticks, one per area: the share of its items with no issues (none needing attention or
 * waiting for a check), blue from 90%, yellow from 70%, red below. Selecting a gauge filters by that area.
 */
export function AreaRadials({ sections, active, onSelect }) {
  return (
    <div className="op-radials">
      {sections.map((s) => {
        const value = clearRate(s.items);
        const issues = countOf(s.items, 'issue');
        const checking = countOf(s.items, 'checking');
        // "Gauge with Ticks": a scale of 0–100 around the arc (major tick every 10, minor ticks between)
        const options = {
          chart: { type: 'gauge', fontFamily: FONT, toolbar: { show: false }, animations: { enabled: true, speed: 600 } },
          colors: [clearColor(value)],
          plotOptions: {
            radialBar: {
              startAngle: -135,
              endAngle: 135,
              ticks: {
                show: true,
                major: { count: 11, length: 9, width: 2, color: '#6b6478', placement: 'outside' },
                minor: { count: 3, length: 5, width: 1, color: '#b9b1c4', placement: 'outside' },
                labels: { show: true, offset: 6, fontSize: '9.5px', fontFamily: FONT, color: MUTED, formatter: (v) => String(Math.round(v)) },
              },
              hollow: { margin: 10, size: '52%' },
              track: { strokeWidth: '70%', background: '#ece5f2' },
              dataLabels: {
                name: { show: true, offsetY: 24, fontSize: '11.5px', fontWeight: 600, color: MUTED },
                value: { show: true, offsetY: -8, fontSize: '26px', fontWeight: 800, color: '#1f1a24', formatter: (v) => `${Math.round(v)}%` },
              },
            },
          },
          labels: ['no issues'],
          // Flat ends: a rounded cap pokes out past the value, so 59% looked like it reached 60+ on the scale
          stroke: { lineCap: 'butt' },
          tooltip: { enabled: false },
        };
        const ok = s.items.length - issues - checking;
        return (
          <button key={s.name} type="button" className={`op-radial${active === s.name ? ' op-on' : ''}`}
            style={{ '--c': clearColor(value) }} onClick={() => onSelect(s.name)} aria-pressed={active === s.name}>
            <Chart type="gauge" series={[value]} options={options} height={220} />
            <h3>{s.name}</h3>
            <p>{ok} of {s.items.length} item{s.items.length === 1 ? '' : 's'} with no issues</p>
            <div className="op-radial__flags">
              {issues > 0 && <span className="op-flag op-flag--issue">{issues} need attention</span>}
              {checking > 0 && <span className="op-flag op-flag--checking">{checking} for checking</span>}
              {!issues && !checking && <span className="op-flag op-flag--good">No issues</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

const CELL_ROW = 26; // height of one item row in the condition timeline, px
// Mark of each condition in the timeline's cells, where the condition starts
const MARK = { issue: '!', checking: '?', good: '✓', noted: '•', none: '–' };

/**
 * Condition timeline (ApexCharts heatmap): one row per item, one column per update, each cell in the
 * item's condition at that update (history[].status from the server). Items needing attention come
 * first, then for checking, so a solid red row (a long-running problem) stands out at the top.
 * A cell is marked (! ? ✓ • –) only where the condition starts, and the last cell says how many
 * updates in a row the item has had its current condition ("7w"), so changes and long-running
 * problems stand out. Hovering a cell shows that update's text; selecting a row calls onOpen(item).
 */
export function ConditionTimeline({ items, updates, statuses, onOpen }) {
  const rank = (it) => { const i = statuses.findIndex((s) => s.key === it.status); return i < 0 ? statuses.length : i; };
  // Longest-running first within a condition: the item stuck the longest is the one to follow up
  const streakOf = (it) => {
    const h = it.history;
    let n = 0;
    for (let k = h.length - 1; k >= 0 && h[k].status === h[h.length - 1].status; k -= 1) n += 1;
    return n;
  };
  const rows = [...items].sort((a, b) => rank(a) - rank(b) || streakOf(b) - streakOf(a) || a.name.localeCompare(b.name));
  // A heatmap draws its first series at the bottom: reverse, so the list reads top-down
  const drawn = [...rows].reverse();
  const code = (key) => Math.max(0, statuses.findIndex((s) => s.key === key)) + 1;
  const short = (s) => (s.length > 34 ? `${s.slice(0, 33)}…` : s);
  // The text of every cell: the streak in the last one, the condition's mark in the others. `strong`
  // where the condition starts; the repeats are faded so the changes still stand out
  const marks = drawn.map((it) => {
    const h = it.history;
    return updates.map((_, k) => {
      if (k === updates.length - 1) return { t: `${streakOf(it)}w`, strong: true };
      const s = h[k]?.status || 'none';
      return { t: MARK[s] || '', strong: k === 0 || s !== h[k - 1]?.status };
    });
  });
  // ApexCharts styles all labels alike: fade the repeats after each draw. Each row is a
  // .apexcharts-heatmap-series group (data:realIndex = its series) holding its labels in column order.
  const fadeRepeats = (ctx) => {
    ctx.el.querySelectorAll('.apexcharts-heatmap-series').forEach((g) => {
      const row = marks[Number(g.getAttribute('data:realIndex'))];
      g.querySelectorAll('.apexcharts-datalabel').forEach((t, k) => { t.style.opacity = row?.[k]?.strong === false ? '0.55' : '1'; });
    });
  };

  const options = {
    chart: {
      type: 'heatmap',
      toolbar: { show: false },
      fontFamily: FONT,
      parentHeightOffset: 0,
      animations: { enabled: false },
      events: {
        mounted: fadeRepeats,
        updated: fadeRepeats,
        dataPointSelection: (_e, _c, { seriesIndex }) => drawn[seriesIndex] && onOpen(drawn[seriesIndex]),
        dataPointMouseEnter: (e) => { if (e?.target) e.target.style.cursor = 'pointer'; },
      },
    },
    plotOptions: {
      heatmap: {
        radius: 4,
        enableShades: false,
        useFillColorAsStroke: false,
        colorScale: { ranges: statuses.map((s, i) => ({ from: i + 1, to: i + 1, color: s.color, name: s.label })) },
      },
    },
    stroke: { width: 2, colors: ['#ffffff'] },
    dataLabels: {
      enabled: true,
      formatter: (_v, { seriesIndex, dataPointIndex }) => marks[seriesIndex]?.[dataPointIndex]?.t ?? '',
      style: { colors: ['#ffffff'], fontSize: '12.5px', fontWeight: 800, fontFamily: FONT },
      dropShadow: { enabled: true, top: 0, left: 0, blur: 2, color: '#000', opacity: 0.45 }, // readable on yellow too
    },
    legend: { show: false }, // the section's legend names the colors
    xaxis: {
      position: 'top',
      // Flat dates: slanted ones take the height of the cells (one item's row was squashed to a line)
      labels: { style: { colors: MUTED, fontSize: '11px', fontWeight: 600 }, rotate: 0, hideOverlappingLabels: true, trim: true },
      axisBorder: { show: false },
      axisTicks: { show: false },
      tooltip: { enabled: false },
    },
    // A fixed name column (the same in every area, so the cells line up), names right-aligned:
    // align 'left' pushes long names off the left edge
    yaxis: { labels: { minWidth: 240, maxWidth: 240, style: { colors: '#1f1a24', fontSize: '12.5px', fontWeight: 600 } } },
    grid: { padding: { top: 0, right: 8, bottom: 0, left: 4 } },
    states: { hover: { filter: { type: 'darken', value: 0.88 } }, active: { filter: { type: 'none' } } },
    tooltip: {
      custom: ({ seriesIndex, dataPointIndex }) => {
        const it = drawn[seriesIndex];
        const h = it?.history[dataPointIndex];
        if (!h) return '';
        const st = statuses.find((s) => s.key === h.status) || statuses[statuses.length - 1];
        const body = h.text ? escapeHtml(h.text) : `<i>No new update, still: ${escapeHtml(st.label)}</i>`;
        const n = streakOf(it);
        const streak = dataPointIndex === updates.length - 1
          ? `<small>${escapeHtml(st.label)} for the last ${n} update${n === 1 ? '' : 's'}</small>` : '';
        return `<div class="sb-watchtip op-heattip"><b>${escapeHtml(it.name)}</b><small>${escapeHtml(h.label)} · <em style="color:${st.color}">${escapeHtml(st.label)}</em></small><span>${body}</span>${streak}<small>Click to see all updates</small></div>`;
      },
    },
  };
  const series = drawn.map((it) => ({
    name: short(it.name),
    data: updates.map((label, k) => ({ x: label, y: code(it.history[k]?.status || 'none') })),
  }));
  return (
    <div className="op-heat">
      <Chart type="heatmap" series={series} options={options} height={rows.length * CELL_ROW + 60} />
    </div>
  );
}

const BAR_ROW = 15; // height of one bar slot in the grouped bars, px (compact, like ApexCharts' grouped bar demo)
const BAR_THICK = 11; // every bar's thickness, px, the same in every row
const NAME_WIDTH = 150; // the area names' column, the same in every row so the bars line up

/**
 * Grouped bars (ApexCharts "Grouped Bar"): for each group (area), one horizontal bar per condition in
 * its color, with the number of items at the end of the bar. Each group is its own small chart with
 * only the conditions it has, so its bars sit centered on its name (one chart would keep an empty
 * slot for every condition in every group). All rows share one scale, shown under the last row.
 * Selecting a bar calls onSelect(groupName, conditionKey).
 */
export function ConditionGroupedBars({ title, groups, statuses, onSelect }) {
  const shown = statuses.filter((s) => groups.some((g) => countOf(g.items, s.key)));
  const most = Math.max(1, ...groups.flatMap((g) => shown.map((s) => countOf(g.items, s.key))));
  // A whole-number scale (step 1, 2, 5 or 10) with room for the count after the longest bar
  const step = most <= 10 ? 1 : most <= 20 ? 2 : most <= 50 ? 5 : 10;
  const max = Math.ceil((most + step * 0.6) / step) * step;
  const ticks = max / step;

  return (
    <div className="op-chart">
      <div className="op-chart__title">{title}</div>
      <div className="op-grouped">
        {groups.map((g, gi) => {
          const parts = shown.filter((s) => countOf(g.items, s.key));
          const last = gi === groups.length - 1;
          const options = {
            chart: {
              type: 'bar',
              toolbar: { show: false },
              fontFamily: FONT,
              parentHeightOffset: 0,
              animations: { enabled: true, speed: 350 },
              events: {
                dataPointSelection: (_e, _c, { seriesIndex }) => parts[seriesIndex] && onSelect(g.name, parts[seriesIndex].key),
                dataPointMouseEnter: (e) => { if (e?.target) e.target.style.cursor = 'pointer'; },
              },
            },
            colors: parts.map((s) => s.color),
            plotOptions: {
              bar: {
                horizontal: true,
                // In pixels, not %: a % of each row's height made bars thicker in rows with fewer
                // conditions and thinner in the last row (which also holds the scale)
                barHeight: `${BAR_THICK}px`,
                borderRadius: 3,
                borderRadiusApplication: 'end',
                dataLabels: { position: 'top' }, // the count at the end of each bar
              },
            },
            dataLabels: {
              enabled: true,
              formatter: (v) => (v ? String(v) : ''),
              offsetX: 16,
              style: { fontSize: '11px', fontWeight: 700, colors: ['#304758'] },
            },
            stroke: { show: true, width: 1, colors: ['#ffffff'] },
            xaxis: {
              categories: [`${g.name} (${g.items.length})`],
              min: 0,
              max,
              tickAmount: ticks,
              labels: { show: last, formatter: (v) => String(Math.round(v)), style: { colors: MUTED, fontSize: '11px' } },
              title: last ? { text: 'Items', style: { color: MUTED, fontSize: '11.5px', fontWeight: 600 } } : undefined,
              axisBorder: { show: last },
              axisTicks: { show: false },
            },
            yaxis: { labels: { minWidth: NAME_WIDTH, maxWidth: NAME_WIDTH, style: { colors: '#1f1a24', fontSize: '13px', fontWeight: 700 } } },
            grid: {
              borderColor: '#ece7f1',
              strokeDashArray: 3,
              xaxis: { lines: { show: true } },
              yaxis: { lines: { show: false } },
              padding: { top: -12, bottom: last ? 0 : -18, right: 24 },
            },
            legend: { show: false }, // one legend for all rows, below
            tooltip: {
              shared: false,
              intersect: true,
              custom: ({ seriesIndex }) => {
                const s = parts[seriesIndex];
                const n = countOf(g.items, s.key);
                return `<div class="sb-watchtip"><b>${escapeHtml(g.name)}</b><span>${escapeHtml(s.label)}: ${n} of ${g.items.length} item${g.items.length === 1 ? '' : 's'} (${pct(n, g.items.length)}%)</span><small>Click to see these items</small></div>`;
              },
            },
            states: { hover: { filter: { type: 'darken', value: 0.9 } }, active: { filter: { type: 'none' } } },
          };
          return (
            <div key={g.name} className="op-grouped__row">
              <Chart type="bar" series={parts.map((s) => ({ name: s.label, data: [countOf(g.items, s.key)] }))} options={options}
                height={Math.max(44, 16 + parts.length * BAR_ROW) + (last ? 46 : 0)} />
            </div>
          );
        })}
      </div>
      <div className="sb-chartlegend op-grouped__legend" aria-label="Condition colors">
        {shown.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}
      </div>
    </div>
  );
}

/**
 * Horizontal 100% stacked bars: one bar per group (area or person in charge) split by condition.
 * `groups`: [{ name, items }]. Selecting a part calls onSelect(groupName, conditionKey).
 */
export function ConditionBars({ title, groups, statuses, onSelect, height }) {
  const shown = statuses.filter((s) => groups.some((g) => countOf(g.items, s.key)));
  const options = {
    chart: {
      type: 'bar',
      stacked: true,
      stackType: '100%',
      toolbar: { show: false },
      fontFamily: FONT,
      events: {
        dataPointSelection: (_e, _c, { seriesIndex, dataPointIndex }) => {
          const g = groups[dataPointIndex];
          if (g && shown[seriesIndex]) onSelect(g.name, shown[seriesIndex].key);
        },
        dataPointMouseEnter: (e) => { if (e?.target) e.target.style.cursor = 'pointer'; },
      },
    },
    colors: shown.map((s) => s.color),
    plotOptions: { bar: { horizontal: true, barHeight: '64%', borderRadius: 3 } },
    stroke: { width: 1, colors: ['#ffffff'] },
    dataLabels: {
      enabled: true,
      formatter: (_v, { seriesIndex, dataPointIndex }) => {
        const n = countOf(groups[dataPointIndex].items, shown[seriesIndex].key);
        return n ? String(n) : '';
      },
      style: { fontSize: '11px', fontWeight: 700, colors: ['#ffffff'] },
      dropShadow: { enabled: false },
    },
    xaxis: {
      categories: groups.map((g) => `${g.name} (${g.items.length})`),
      labels: { formatter: (v) => `${Math.round(v)}%`, style: { colors: MUTED, fontSize: '11px' } },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: { labels: { maxWidth: 200, style: { colors: '#1f1a24', fontSize: '12.5px', fontWeight: 600 } } },
    grid: { borderColor: '#ece7f1', strokeDashArray: 3, xaxis: { lines: { show: true } }, yaxis: { lines: { show: false } } },
    legend: { position: 'top', horizontalAlign: 'right', fontSize: '12px', fontWeight: 600, markers: { size: 6, shape: 'square' }, itemMargin: { horizontal: 8 } },
    tooltip: {
      shared: false,
      custom: ({ seriesIndex, dataPointIndex }) => {
        const g = groups[dataPointIndex];
        const s = shown[seriesIndex];
        const n = countOf(g.items, s.key);
        return `<div class="sb-watchtip"><b>${escapeHtml(g.name)}</b><span>${escapeHtml(s.label)}: ${n} of ${g.items.length} item${g.items.length === 1 ? '' : 's'} (${pct(n, g.items.length)}%)</span><small>Click to see these items</small></div>`;
      },
    },
    states: { hover: { filter: { type: 'darken', value: 0.9 } }, active: { filter: { type: 'none' } } },
  };
  return (
    <div className="op-chart">
      <div className="op-chart__title">{title}</div>
      <Chart type="bar" series={shown.map((s) => ({ name: s.label, data: groups.map((g) => countOf(g.items, s.key)) }))}
        options={options} height={height ?? Math.max(220, 90 + groups.length * 38)} />
    </div>
  );
}
