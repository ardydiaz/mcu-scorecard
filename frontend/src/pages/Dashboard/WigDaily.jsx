import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Chart from 'react-apexcharts';
import { getWigHistory } from '../../api/strategyApi';
import { CATEGORIES, category } from './scoreboardData';

const STATUS_KEYS = ['completed', 'ontrack', 'behind', 'atrisk'];
const CAL_DAYS = 14; // days shown in the chart, one column each
const weekday = (day) => new Date(`${day}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short' });
const keyOf = (d) => (d.rowId ? `id:${d.rowId}` : `name:${d.lead}|${d.name}`).slice(0, 300);
const fmtDay = (day, long = false) => new Date(`${day}T00:00:00`).toLocaleDateString('en-GB', long
  ? { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }
  : { day: 'numeric', month: 'short' });

/**
 * WIG status day by day: a stacked column per day (ApexCharts, Completed / On track / Behind /
 * At risk) for the last CAL_DAYS days. Days come from the snapshots the server saves daily
 * (wigHistory.service); "Today" is always the live status of the sheet. Colors are the dashboard's
 * status colors. Selecting a column segment opens those WIGs (with their current details).
 */
export default function WigDaily({ wigs, workbook, sheet, department, onOpen }) {
  const box = useRef(null);
  const [styles, setStyles] = useState(null);
  const [history, setHistory] = useState(null);
  useLayoutEffect(() => { setStyles(getComputedStyle(box.current)); }, []);

  useEffect(() => {
    let cancelled = false;
    setHistory(null);
    getWigHistory({ workbook, sheet, department, days: 30 })
      .then((h) => { if (!cancelled) setHistory(h); })
      .catch(() => { if (!cancelled) setHistory({ days: [], today: null }); });
    return () => { cancelled = true; };
  }, [workbook, sheet, department]);

  const cats = CATEGORIES.filter((c) => STATUS_KEYS.includes(c.key));
  const byKey = useMemo(() => new Map(wigs.map((d) => [keyOf(d), d])), [wigs]);
  // Saved days, with today replaced by the live status (so today always matches the sheet now)
  const today = history?.today;
  const liveItems = wigs.map((d) => ({ rowKey: keyOf(d), name: d.name, lead: d.lead, tier: d.tier, status: category(d), pct: d.pct || 0 }));
  const days = [
    ...(history?.days || []).filter((x) => x.day !== today),
    ...(today ? [{ day: today, items: liveItems, live: true }] : []),
  ];
  // The chart's calendar: every one of the last CAL_DAYS days up to today, so each date has its own
  // column (a day without a saved snapshot shows as an empty slot)
  const calendar = [];
  if (today) {
    for (let i = CAL_DAYS - 1; i >= 0; i--) {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - i);
      const iso = d.toISOString().slice(0, 10);
      calendar.push(days.find((x) => x.day === iso) || { day: iso, items: [], missing: true });
    }
  }
  const count = (items, key) => items.filter((it) => it.status === key).length;
  // The WIGs of a day's status, as dashboard projects (current details) for the details dialog
  const projectsOf = (items, key) => items.filter((it) => it.status === key)
    .map((it) => byKey.get(it.rowKey) || { name: it.name, lead: it.lead, tier: it.tier || '–', status: '', stage: '', persp: '', row: it.rowKey });
  const open = (entry, key) => {
    const c = cats.find((x) => x.key === key);
    const list = projectsOf(entry.items, key);
    onOpen({ title: `WIGs ${c.label.toLowerCase()} · ${entry.live ? 'today' : fmtDay(entry.day, true)}`, sub: `${list.length} of ${entry.items.length} WIGs`, list, empty: c.empty });
  };

  const resolve = (color) => {
    const m = /^var\((--[^)]+)\)$/.exec(color || '');
    return m && styles ? styles.getPropertyValue(m[1]).trim() || '#888' : color;
  };
  const options = styles && calendar.length > 0 && {
    chart: {
      type: 'bar',
      stacked: true,
      toolbar: { show: false },
      fontFamily: 'Roboto, "Segoe UI", system-ui, sans-serif',
      animations: { enabled: true, speed: 300 },
      events: {
        dataPointSelection: (_e, _ctx, { seriesIndex, dataPointIndex }) => {
          const entry = calendar[dataPointIndex];
          if (!entry || entry.missing) return;
          open(entry, cats[seriesIndex].key);
        },
        dataPointMouseEnter: (e) => { if (e?.target) e.target.style.cursor = 'pointer'; },
      },
    },
    colors: cats.map((c) => resolve(c.color)),
    plotOptions: {
      bar: {
        columnWidth: '55%',
        // Rounded columns (both ends), as in ApexCharts' "Stacked Column" example
        borderRadius: 8,
        borderRadiusApplication: 'around',
        borderRadiusWhenStacked: 'last',
        // The day's total number of WIGs on top of its column (nothing on days without a snapshot)
        dataLabels: {
          total: {
            enabled: true,
            offsetY: -4,
            formatter: (val, opts) => (calendar[opts.dataPointIndex]?.missing || !val ? '' : String(val)),
            style: { fontSize: '13px', fontWeight: 800, color: '#1f1a24' },
          },
        },
      },
    },
    stroke: { width: 1, colors: ['#ffffff'] },
    // The number of WIGs in each status, inside its piece of the day's column
    dataLabels: { enabled: true, style: { fontSize: '11px', fontWeight: 700 }, formatter: (v) => (v ? String(v) : '') },
    // Legend on the right of the chart, as in the example (same status colors as the section legend)
    legend: {
      show: true,
      showForSingleSeries: true,
      position: 'right',
      offsetY: 30,
      fontSize: '12.5px',
      fontWeight: 600,
      markers: { size: 6, shape: 'square' },
      itemMargin: { vertical: 4 },
      onItemClick: { toggleDataSeries: true },
    },
    xaxis: {
      // Two lines under each column: weekday and date ("Mon" / "26 Oct"); today is marked
      categories: calendar.map((x) => [x.live ? 'Today' : weekday(x.day), fmtDay(x.day)]),
      labels: {
        rotate: 0,
        hideOverlappingLabels: false,
        style: { colors: calendar.map((x) => (x.live ? '#3b0a5c' : x.missing ? '#b3abbd' : '#6b6478')), fontSize: '11px', fontWeight: 600 },
      },
      axisTicks: { show: false },
    },
    yaxis: { min: 0, forceNiceScale: true, labels: { formatter: (v) => String(Math.round(v)), style: { colors: '#6b6478', fontSize: '11px' } }, title: { text: 'WIGs', style: { color: '#6b6478', fontSize: '11.5px', fontWeight: 600 } } },
    grid: { borderColor: '#ece7f1', strokeDashArray: 3 },
    tooltip: {
      shared: true,
      intersect: false,
      // The full date on top: "Mon, 26 October 2026 (today)" / "… · not saved"
      x: {
        formatter: (_v, { dataPointIndex }) => {
          const x = calendar[dataPointIndex];
          if (!x) return '';
          return `${fmtDay(x.day, true)}${x.live ? ' (today)' : ''}${x.missing ? ' · no snapshot saved' : ''}`;
        },
      },
      y: { formatter: (v) => `${v} WIG${v === 1 ? '' : 's'}` },
    },
    states: { hover: { filter: { type: 'darken', value: 0.9 } }, active: { filter: { type: 'none' } } },
  };

  return (
    <div className="sb-wigdaily" ref={box}>
      <div className="sb-wigdaily__head">
        <span className="sb-wigdaily__note">
          {history === null ? 'Loading the daily history…'
            : days.filter((x) => !x.live).length === 0 ? 'Daily history starts today: the status is saved every day from now on.'
              : `Daily history: ${days.filter((x) => !x.live).length} saved day${days.filter((x) => !x.live).length === 1 ? '' : 's'}`}
        </span>
      </div>

      {options && (
        <div className="sb-wigdaily__chart">
          <div className="sb-wigdaily__charttitle">
            WIG status per day · {fmtDay(calendar[0].day)} to {fmtDay(today)}
          </div>
          <Chart type="bar" height={320}
            series={cats.map((c) => ({ name: c.label, data: calendar.map((x) => count(x.items, c.key)) }))}
            options={options} />
        </div>
      )}
    </div>
  );
}
