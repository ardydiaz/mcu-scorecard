import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import Chart from 'react-apexcharts';
import { CATEGORIES, category, tiersOf } from './scoreboardData';

const tierName = (t) => (t === '–' ? 'No tier' : `Class ${t}`);
// Labels inside the segments: white on the dark colors, dark ink on the light ones (Behind, No traffic light)
const LABEL_INK = { completed: '#ffffff', ontrack: '#ffffff', behind: '#1f1a24', atrisk: '#ffffff', unreported: '#1f1a24' };

/**
 * 02 Status by tier: one horizontal bar per tier, split 100% by reported status (ApexCharts, stacked
 * 100%). Colors are read from the dashboard's own status colors (CSS variables, the same as the
 * Overall Status cards and legend). Clicking a segment opens that tier's projects with that status;
 * the tier buttons below open all of a tier's projects.
 */
export default function TierBars({ projects, onOpen }) {
  const box = useRef(null);
  const [palette, setPalette] = useState(null);

  const cats = useMemo(() => CATEGORIES.filter((c) => projects.some((d) => category(d) === c.key)), [projects]);
  const tiers = useMemo(() => tiersOf(projects), [projects]);
  // lists[tierIndex][catIndex] = the projects of that tier with that status
  const lists = useMemo(
    () => tiers.map((t) => cats.map((c) => projects.filter((d) => d.tier === t && category(d) === c.key))),
    [tiers, cats, projects],
  );
  const totals = useMemo(() => tiers.map((t) => projects.filter((d) => d.tier === t).length), [tiers, projects]);

  // The status colors are CSS variables ("var(--sb-completed)"); ApexCharts needs the actual colors
  useLayoutEffect(() => {
    const styles = getComputedStyle(box.current);
    setPalette(Object.fromEntries(CATEGORIES.map((c) => [c.key, styles.getPropertyValue(c.color.slice(4, -1)).trim() || '#888'])));
  }, []);

  const openSegment = (catIndex, tierIndex) => {
    const c = cats[catIndex];
    const t = tiers[tierIndex];
    const list = lists[tierIndex]?.[catIndex] || [];
    if (!c || !list.length) return;
    onOpen({ title: `${tierName(t)}: ${c.label.toLowerCase()}`, sub: `${list.length} of ${totals[tierIndex]} ${tierName(t)} projects`, list });
  };

  const series = cats.map((c, ci) => ({ name: c.label, data: tiers.map((_, ti) => lists[ti][ci].length) }));
  const options = palette && {
    chart: {
      type: 'bar',
      stacked: true,
      stackType: '100%',
      toolbar: { show: false },
      fontFamily: 'Roboto, "Segoe UI", system-ui, sans-serif',
      animations: { enabled: true, speed: 350 },
      events: {
        dataPointSelection: (_e, _ctx, { seriesIndex, dataPointIndex }) => openSegment(seriesIndex, dataPointIndex),
        dataPointMouseEnter: (e) => { if (e?.target) e.target.style.cursor = 'pointer'; },
      },
    },
    colors: cats.map((c) => palette[c.key]),
    plotOptions: { bar: { horizontal: true, barHeight: '64%', borderRadius: 4, borderRadiusApplication: 'end', borderRadiusWhenStacked: 'last' } },
    // 2px gap between segments in the surface color
    stroke: { width: 2, colors: ['#ffffff'] },
    dataLabels: {
      enabled: true,
      formatter: (val) => (val >= 5 ? `${Math.round(val)}%` : ''),
      style: { fontSize: '12px', fontWeight: 700, colors: cats.map((c) => LABEL_INK[c.key] || '#ffffff') },
      dropShadow: { enabled: false },
    },
    xaxis: {
      categories: tiers.map((t, i) => `${tierName(t)} (${totals[i]})`),
      max: 100,
      tickAmount: 5,
      labels: { formatter: (v) => `${Math.round(v)}%`, style: { colors: '#6b6478', fontSize: '12px' } },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: { labels: { style: { colors: '#3b0a5c', fontSize: '13px', fontWeight: 700 }, maxWidth: 160 } },
    grid: { borderColor: '#ece7f1', strokeDashArray: 3, xaxis: { lines: { show: true } }, yaxis: { lines: { show: false } }, padding: { left: 4, right: 12 } },
    // The section shows its own legend (same as the other sections), so ApexCharts' is hidden
    legend: { show: false },
    tooltip: {
      shared: false,
      intersect: true,
      y: {
        formatter: (val, { dataPointIndex }) => {
          const total = totals[dataPointIndex] || 0;
          return `${val} of ${total} projects (${total ? Math.round((val / total) * 100) : 0}%)`;
        },
      },
    },
    states: { hover: { filter: { type: 'darken', value: 0.88 } }, active: { filter: { type: 'none' } } },
  };

  return (
    <div className="sb-tierbars" ref={box}>
      {options && (
        <Chart type="bar" series={series} options={options} height={Math.max(160, 60 + tiers.length * 56)} />
      )}
      <div className="sb-tierbars__tiers" aria-label="Show all projects of a tier">
        {tiers.map((t, i) => (
          <button key={t} type="button" className="sb-chip"
            onClick={() => onOpen({ title: `${tierName(t)} projects`, sub: `${totals[i]} of ${projects.length} projects`, list: projects.filter((d) => d.tier === t) })}>
            {tierName(t)} <b>{totals[i]}</b>
          </button>
        ))}
      </div>
    </div>
  );
}
