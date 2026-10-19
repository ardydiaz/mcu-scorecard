import { useLayoutEffect, useRef, useState } from 'react';
import Chart from 'react-apexcharts';
import { WATCH_LEVELS, levelOf } from './ScoreboardParts';

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/**
 * 03 Worth raising at Execom (ApexCharts horizontal bars): one bar per issue, in order of urgency
 * (not sorted by size). The axis runs to `total` (all projects shown), so a bar's length is its share
 * of the projects; a light track behind each bar stands for that 100%. Colors show urgency (act now /
 * watch / for information), read from the dashboard's own colors, the same as the legend. Clicking a
 * bar opens the projects behind it. A project can have several issues, so shares don't add up to 100%.
 */
export default function WatchChart({ items, total, onOpen }) {
  const box = useRef(null);
  const [palette, setPalette] = useState(null);

  // The urgency colors are CSS variables (--bar-now, --bar-watch, --bar-info); ApexCharts needs the colors
  useLayoutEffect(() => {
    const styles = getComputedStyle(box.current);
    setPalette(Object.fromEntries(WATCH_LEVELS.map((l) => [l.key, styles.getPropertyValue(`--bar-${l.key}`).trim() || '#888'])));
  }, []);

  const share = (n) => {
    if (!total) return '';
    const p = (n / total) * 100;
    return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`;
  };
  const open = (i) => {
    const w = items[i];
    if (w) onOpen({ title: w.title, list: w.list });
  };
  const counts = items.map((w) => w.list.length);
  const levelLabel = (w) => WATCH_LEVELS.find((l) => l.key === levelOf(w.tone)).label;

  const options = palette && {
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
    // One color per bar, by urgency
    colors: items.map((w) => palette[levelOf(w.tone)]),
    plotOptions: {
      bar: {
        horizontal: true,
        distributed: true,
        barHeight: '46%',
        borderRadius: 4,
        borderRadiusApplication: 'end',
        // The light track = all projects shown
        colors: { backgroundBarColors: ['#efe9f4'], backgroundBarRadius: 4 },
        dataLabels: { position: 'top' },
      },
    },
    dataLabels: {
      enabled: true,
      textAnchor: 'start',
      offsetX: 8,
      formatter: (val) => `${val} · ${share(val)}`,
      style: { fontSize: '13px', fontWeight: 700, colors: ['#1f1a24'] },
      dropShadow: { enabled: false },
    },
    xaxis: {
      categories: items.map((w) => w.label),
      min: 0,
      max: Math.max(total || 0, ...counts, 1),
      tickAmount: 4,
      labels: { formatter: (v) => (total ? `${Math.round((v / total) * 100)}%` : String(Math.round(v))), style: { colors: '#6b6478', fontSize: '12px' } },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: { labels: { style: { colors: '#1f1a24', fontSize: '13.5px', fontWeight: 600 }, maxWidth: 220 } },
    grid: { borderColor: '#ece7f1', strokeDashArray: 3, xaxis: { lines: { show: true } }, yaxis: { lines: { show: false } }, padding: { right: 40 } },
    legend: { show: false }, // the section shows its own legend, like the other sections
    tooltip: {
      custom: ({ dataPointIndex }) => {
        const w = items[dataPointIndex];
        if (!w) return '';
        const text = w.text.length > 160 ? `${w.text.slice(0, 160)}…` : w.text;
        return `<div class="sb-watchtip"><b>${escapeHtml(w.title)}</b><span>${escapeHtml(text)}</span>`
          + `<small>${escapeHtml(levelLabel(w))} · ${counts[dataPointIndex]} of ${total} projects (${share(counts[dataPointIndex])}). Click to see the projects</small></div>`;
      },
    },
    states: { hover: { filter: { type: 'darken', value: 0.88 } }, active: { filter: { type: 'none' } } },
  };

  return (
    <div className="sb-watchchart" ref={box}>
      {options && <Chart type="bar" series={[{ name: 'Projects', data: counts }]} options={options} height={Math.max(160, 50 + items.length * 44)} />}
      {total > 0 && (
        <p className="sb-bars__note">
          The light track is all {total} projects shown; the colored part is the share with that issue. A project can appear in more than one bar,
          so the percentages don’t add up to 100%.
        </p>
      )}
    </div>
  );
}
