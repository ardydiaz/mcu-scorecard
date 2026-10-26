import { useLayoutEffect, useRef, useState } from 'react';
import Chart from 'react-apexcharts';
import { CATEGORIES, category, fmtWhen, shortName } from './scoreboardData';

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// "Datamobility HR & Payroll" -> ["Datamobility", "HR & Payroll"]: short lines under a column
function wrapLabel(text, width = 14, maxLines = 3) {
  const lines = [];
  for (const word of String(text).split(/\s+/)) {
    const last = lines[lines.length - 1];
    if (last && (last + ' ' + word).length <= width) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  if (lines.length > maxLines) return [...lines.slice(0, maxLines - 1), `${lines.slice(maxLines - 1).join(' ').slice(0, width - 1)}…`];
  return lines;
}

/**
 * WIGs as distributed columns (ApexCharts): one column per WIG, height = its completion %, each in its
 * status color (the dashboard's, as in the legend), with the name underneath in the same color.
 * `wigs` come in the board's order (behind / at risk first). Hover for details; select a column to
 * open the WIG's details and latest note.
 */
export default function WigColumns({ wigs, asOfLabel, onOpen }) {
  const box = useRef(null);
  const [styles, setStyles] = useState(null);
  useLayoutEffect(() => { setStyles(getComputedStyle(box.current)); }, []);
  const resolve = (color) => {
    const m = /^var\((--[^)]+)\)$/.exec(color || '');
    return m && styles ? styles.getPropertyValue(m[1]).trim() || '#888' : color;
  };

  const cats = wigs.map((d) => CATEGORIES.find((c) => c.key === category(d)));
  const colors = cats.map((c) => resolve(c.color));
  const due = (d) => (/^\d{4}-\d{2}$/.test(d.done || '') ? fmtWhen(d.done) : d.done || 'not set');
  const open = (i) => {
    const d = wigs[i];
    if (d) onOpen({ title: shortName(d.name), sub: `WIG · ${cats[i].label}`, list: [d] });
  };

  const options = styles && {
    chart: {
      type: 'bar',
      toolbar: { show: false },
      fontFamily: 'Roboto, "Segoe UI", system-ui, sans-serif',
      animations: { enabled: true, speed: 350 },
      events: {
        dataPointSelection: (_e, _ctx, { dataPointIndex }) => open(dataPointIndex),
        dataPointMouseEnter: (e) => { if (e?.target) e.target.style.cursor = 'pointer'; },
      },
    },
    colors,
    plotOptions: {
      bar: {
        distributed: true, // each column its own color
        columnWidth: wigs.length > 12 ? '62%' : '48%',
        borderRadius: 4,
        borderRadiusApplication: 'end',
        dataLabels: { position: 'top' },
      },
    },
    dataLabels: {
      enabled: true,
      formatter: (v) => `${v}%`,
      offsetY: -20,
      style: { fontSize: '12px', fontWeight: 700, colors: ['#1f1a24'] },
    },
    legend: { show: false }, // the section's legend names the status colors
    xaxis: {
      categories: wigs.map((d) => wrapLabel(shortName(d.name))),
      labels: { rotate: 0, trim: false, hideOverlappingLabels: false, style: { colors, fontSize: '11.5px', fontWeight: 700 } },
      axisTicks: { show: false },
      tooltip: { enabled: false },
    },
    yaxis: {
      min: 0,
      max: 100,
      tickAmount: 5,
      title: { text: 'Completion', style: { color: '#6b6478', fontSize: '12px', fontWeight: 600 } },
      labels: { formatter: (v) => `${Math.round(v)}%`, style: { colors: '#6b6478', fontSize: '11.5px' } },
    },
    grid: { borderColor: '#ece7f1', strokeDashArray: 3, padding: { top: 6 } },
    tooltip: {
      custom: ({ dataPointIndex }) => {
        const d = wigs[dataPointIndex];
        if (!d) return '';
        const c = cats[dataPointIndex];
        return `<div class="sb-watchtip"><b>${escapeHtml(shortName(d.name))} · ${d.pct || 0}%</b>`
          + `<span><i class="sb-wigtip__dot" style="background:${colors[dataPointIndex]}"></i>${escapeHtml(d.status || c.label)} · Class ${escapeHtml(d.tier)}</span>`
          + `<span>Target ${escapeHtml((d.target || 'not set').replace(/\n/g, ', '))} · Lead ${escapeHtml(d.lead || '—')}</span>`
          + `<span>Due ${escapeHtml(due(d))} · Updated ${escapeHtml(d.noteFrom || (d.note ? asOfLabel : 'not yet'))}</span>`
          + '<small>Click to see the details and latest note</small></div>';
      },
    },
    states: { hover: { filter: { type: 'darken', value: 0.88 } }, active: { filter: { type: 'none' } } },
  };

  return (
    <div className="sb-wigchart" ref={box}>
      {options && (
        <Chart type="bar" series={[{ name: 'Completion', data: wigs.map((d) => d.pct || 0) }]} options={options} height={380} />
      )}
    </div>
  );
}
