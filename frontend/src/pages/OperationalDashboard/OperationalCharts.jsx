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
    legend: { position: 'bottom', fontSize: '12.5px', fontWeight: 600, markers: { size: 6, shape: 'square' }, itemMargin: { horizontal: 8, vertical: 2 } },
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

const BAR_ROW = 20; // height of one bar slot in the grouped bars, px
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
  const max = most + Math.max(1, Math.ceil(most * 0.08)); // room for the count after the longest bar
  const ticks = Math.min(max, 10);

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
                barHeight: '84%',
                borderRadius: 3,
                borderRadiusApplication: 'end',
                dataLabels: { position: 'top' }, // the count at the end of each bar
              },
            },
            dataLabels: {
              enabled: true,
              formatter: (v) => (v ? String(v) : ''),
              offsetX: 18,
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
              padding: { top: -10, bottom: last ? 0 : -14, right: 24 },
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
                height={Math.max(56, 24 + parts.length * BAR_ROW) + (last ? 46 : 0)} />
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
