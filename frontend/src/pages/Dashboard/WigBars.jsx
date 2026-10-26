import { useLayoutEffect, useRef, useState } from 'react';
import Chart from 'react-apexcharts';
import { CATEGORIES, category, fmtWhen, shortName } from './scoreboardData';

const TRACK = '#ece5f2'; // the part still to do, up to 100%
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/**
 * WIGs as stacked horizontal bars (ApexCharts): one bar per WIG, made of its completion % (in its
 * status color, the dashboard's, as in the legend) and the rest up to 100% (light). The % is shown
 * at the end of each bar. `wigs` come in the board's order (behind / at risk first). Hover for
 * details; select a bar to open the WIG's details and latest note.
 */
export default function WigBars({ wigs, asOfLabel, onOpen }) {
  const box = useRef(null);
  const [styles, setStyles] = useState(null);
  useLayoutEffect(() => { setStyles(getComputedStyle(box.current)); }, []);
  const resolve = (color) => {
    const m = /^var\((--[^)]+)\)$/.exec(color || '');
    return m && styles ? styles.getPropertyValue(m[1]).trim() || '#888' : color;
  };

  const cats = wigs.map((d) => CATEGORIES.find((c) => c.key === category(d)));
  const colors = cats.map((c) => resolve(c.color));
  const pct = wigs.map((d) => Math.min(100, Math.max(0, d.pct || 0)));
  const names = wigs.map((d) => shortName(d.name));
  const due = (d) => (/^\d{4}-\d{2}$/.test(d.done || '') ? fmtWhen(d.done) : d.done || 'not set');
  const open = (i) => {
    const d = wigs[i];
    if (d) onOpen({ title: shortName(d.name), sub: `WIG · ${cats[i].label}`, list: [d] });
  };

  const series = [
    { name: 'Completed', data: names.map((x, i) => ({ x, y: pct[i], fillColor: colors[i] })) },
    { name: 'Remaining', data: names.map((x, i) => ({ x, y: 100 - pct[i], fillColor: TRACK })) },
  ];

  const options = styles && {
    chart: {
      type: 'bar',
      stacked: true,
      toolbar: { show: false },
      fontFamily: 'Roboto, "Segoe UI", system-ui, sans-serif',
      animations: { enabled: true, speed: 350 },
      events: {
        dataPointSelection: (_e, _ctx, { dataPointIndex }) => open(dataPointIndex),
        dataPointMouseEnter: (e) => { if (e?.target) e.target.style.cursor = 'pointer'; },
      },
    },
    plotOptions: {
      bar: {
        horizontal: true,
        barHeight: '62%',
        borderRadius: 4,
        borderRadiusApplication: 'end',
        borderRadiusWhenStacked: 'last',
        // The WIG's % at the end of its bar (every bar totals 100, so the label shows the completed part)
        dataLabels: {
          total: {
            enabled: true,
            offsetX: 6,
            formatter: (_val, opts) => `${pct[opts.dataPointIndex] ?? 0}%`,
            style: { fontSize: '13px', fontWeight: 800, color: '#1f1a24' },
          },
        },
      },
    },
    // 2px gap between the done and remaining parts, in the surface color
    stroke: { width: 2, colors: ['#ffffff'] },
    dataLabels: { enabled: false },
    legend: { show: false }, // the section's legend names the status colors
    xaxis: {
      // Fixed 0–100% (without a minimum ApexCharts may start the axis at -100% and leave half the chart empty)
      min: 0,
      max: 100,
      tickAmount: 4,
      labels: { formatter: (v) => `${Math.round(v)}%`, style: { colors: '#6b6478', fontSize: '11.5px' } },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: { labels: { maxWidth: 230, style: { colors: '#1f1a24', fontSize: '12.5px', fontWeight: 600 } } },
    grid: { borderColor: '#ece7f1', strokeDashArray: 3, xaxis: { lines: { show: true } }, yaxis: { lines: { show: false } }, padding: { right: 36 } },
    tooltip: {
      shared: false,
      custom: ({ dataPointIndex }) => {
        const d = wigs[dataPointIndex];
        if (!d) return '';
        const c = cats[dataPointIndex];
        return `<div class="sb-watchtip"><b>${escapeHtml(shortName(d.name))} · ${pct[dataPointIndex]}%</b>`
          + `<span><i class="sb-wigtip__dot" style="background:${colors[dataPointIndex]}"></i>${escapeHtml(d.status || c.label)} · Class ${escapeHtml(d.tier)}</span>`
          + `<span>Target ${escapeHtml((d.target || 'not set').replace(/\n/g, ', '))} · Lead ${escapeHtml(d.lead || '—')}</span>`
          + `<span>Due ${escapeHtml(due(d))} · Updated ${escapeHtml(d.noteFrom || (d.note ? asOfLabel : 'not yet'))}</span>`
          + '<small>Click to see the details and latest note</small></div>';
      },
    },
    states: { hover: { filter: { type: 'darken', value: 0.9 } }, active: { filter: { type: 'none' } } },
  };

  return (
    <div className="sb-wigchart" ref={box}>
      {options && <Chart type="bar" series={series} options={options} height={Math.max(180, 50 + wigs.length * 34)} />}
    </div>
  );
}
