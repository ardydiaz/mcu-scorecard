import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import Chart from 'react-apexcharts';

// Perspective colors (as in Trend Over Time); other perspectives take the categorical series colors in order
const PERSPECTIVE_VARS = [[/profitab/i, '--sb-persp-profitability'], [/quality/i, '--sb-persp-quality'], [/innovat/i, '--sb-persp-innovation']];
const TRACK = '#ece5f2';
const varName = (color) => (String(color).startsWith('var(') ? color.slice(4, -1) : null);

// Reads CSS variables (the dashboard's colors) once the card is on screen; ApexCharts needs real colors
function useColors(ref) {
  const [styles, setStyles] = useState(null);
  useLayoutEffect(() => { setStyles(getComputedStyle(ref.current)); }, [ref]);
  return (color) => {
    if (!styles) return null;
    const name = varName(color);
    return name ? styles.getPropertyValue(name).trim() || '#888' : color;
  };
}

const baseOptions = (onSelect) => ({
  chart: {
    type: 'donut',
    fontFamily: 'Roboto, "Segoe UI", system-ui, sans-serif',
    animations: { enabled: true, speed: 300 },
    sparkline: { enabled: false },
    events: {
      dataPointSelection: (_e, _ctx, { dataPointIndex }) => onSelect(dataPointIndex),
      dataPointMouseEnter: (e) => { if (e?.target) e.target.style.cursor = 'pointer'; },
    },
  },
  stroke: { width: 2, colors: ['#ffffff'] },
  dataLabels: { enabled: false },
  legend: { show: false },
  states: { hover: { filter: { type: 'darken', value: 0.9 } }, active: { filter: { type: 'none' } } },
});

const donutCentre = ({ value, label, valueSize = '26px' }) => ({
  pie: {
    expandOnClick: false,
    donut: {
      size: '72%',
      labels: {
        show: true,
        name: { show: true, fontSize: '11px', fontWeight: 700, color: '#6b6478', offsetY: 16 },
        value: { show: true, fontSize: valueSize, fontWeight: 800, color: '#1f1a24', offsetY: -12 },
        total: { show: true, showAlways: true, label, fontSize: '11px', fontWeight: 700, color: '#6b6478', formatter: () => value },
      },
    },
  },
});

/**
 * Donut for one status card: the colored part is the status's share of all projects (the card's
 * color; the rest is a light track), with the percentage in the centre. Selecting the donut drills
 * into that status by perspective inside the card; selecting a perspective slice opens its projects;
 * "Back" returns to the share.
 */
export function StatusCardDonut({ cat, list, total, pct, onOpen }) {
  const box = useRef(null);
  const color = useColors(box);
  const [drilled, setDrilled] = useState(false);
  const n = list.length;

  const groups = useMemo(() => {
    const by = new Map();
    for (const d of list) by.set(d.persp || 'Not set', [...(by.get(d.persp || 'Not set') || []), d]);
    return [...by.entries()].map(([name, items]) => ({ name, list: items })).sort((a, b) => b.list.length - a.list.length);
  }, [list]);

  const ready = !!color(cat.color);
  let chart = null;
  if (ready && !drilled) {
    // With no projects, only the light track (a 0 slice makes ApexCharts draw the ring in its default grey)
    const empty = n === 0;
    chart = {
      series: empty ? [Math.max(total, 1)] : [n, Math.max(total - n, 0)],
      options: {
        ...baseOptions(() => { if (n) setDrilled(true); }),
        labels: empty ? ['Other projects'] : [cat.label, 'Other projects'],
        colors: empty ? [TRACK] : [color(cat.color), TRACK],
        plotOptions: donutCentre({ value: `${pct}%`, label: `${n} of ${total}` }),
        tooltip: { y: { formatter: (v) => `${v} of ${total} projects` } },
      },
    };
  } else if (ready) {
    let next = 1;
    const colors = groups.map((g) => {
      const fixed = PERSPECTIVE_VARS.find(([re]) => re.test(g.name));
      return color(fixed ? `var(${fixed[1]})` : `var(--sb-series-${next++})`);
    });
    chart = {
      series: groups.map((g) => g.list.length),
      options: {
        ...baseOptions((i) => {
          const g = groups[i];
          if (g) onOpen({ title: `${cat.label}: ${g.name}`, sub: `${g.list.length} of ${n} ${cat.label.toLowerCase()} projects`, list: g.list });
        }),
        labels: groups.map((g) => g.name),
        colors,
        plotOptions: donutCentre({ value: String(n), label: 'by perspective' }),
        legend: { show: true, position: 'bottom', fontSize: '11px', markers: { size: 5 }, itemMargin: { horizontal: 4, vertical: 0 } },
        tooltip: { y: { formatter: (v) => `${v} of ${n} ${cat.label.toLowerCase()} projects` } },
      },
    };
  }

  return (
    <div className="sb-carddonut" ref={box}>
      <div className="sb-carddonut__bar">
        {drilled
          ? <button type="button" onClick={() => setDrilled(false)}>‹ Back</button>
          : <span>{n ? 'Select to see by perspective' : 'No projects'}</span>}
      </div>
      {chart && (
        <Chart key={drilled ? 'perspective' : 'share'} type="donut" series={chart.series} options={chart.options} height={drilled ? 210 : 170} />
      )}
    </div>
  );
}

/**
 * Donut for the Total card: all projects split by status (status colors), total in the centre.
 * Selecting a status slice opens that status's projects.
 */
export function TotalCardDonut({ cats, lists, total, onOpen }) {
  const box = useRef(null);
  const color = useColors(box);
  const shown = cats.filter((c) => lists[c.key].length);
  const ready = shown.length > 0 && !!color(shown[0].color);
  const options = ready && {
    ...baseOptions((i) => {
      const c = shown[i];
      if (c) onOpen({ title: c.label, sub: `${lists[c.key].length} of ${total} projects`, list: lists[c.key], empty: c.empty });
    }),
    labels: shown.map((c) => c.label),
    colors: shown.map((c) => color(c.color)),
    plotOptions: donutCentre({ value: String(total), label: 'Total projects', valueSize: '30px' }),
    tooltip: { y: { formatter: (v) => `${v} of ${total} projects (${total ? Math.round((v / total) * 100) : 0}%)` } },
  };
  return (
    <div className="sb-carddonut" ref={box}>
      <div className="sb-carddonut__bar"><span>Select a status to see its projects</span></div>
      {options && <Chart type="donut" series={shown.map((c) => lists[c.key].length)} options={options} height={170} />}
    </div>
  );
}
