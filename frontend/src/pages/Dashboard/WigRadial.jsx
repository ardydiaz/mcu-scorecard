import { useLayoutEffect, useRef, useState } from 'react';
import Chart from 'react-apexcharts';
import { CATEGORIES, category, shortName } from './scoreboardData';

const MAX_LABEL = 34; // longer WIG names are cut, the full name is in the details
const cut = (s) => (s.length > MAX_LABEL ? `${s.slice(0, MAX_LABEL - 1).trimEnd()}…` : s);

/**
 * WIGs as a radial bar chart (ApexCharts "Custom Angle"): one ring per WIG over three quarters of a
 * circle, filled to its completion % in its status color (the dashboard's, as in the section legend).
 * Each WIG's name and % sit at the start of its ring, in the ring's color (ApexCharts bar labels).
 * `wigs` come in the board's order (behind / at risk first), outermost ring first. Selecting a ring
 * opens the WIG's details.
 */
export default function WigRadial({ wigs, onOpen }) {
  const box = useRef(null);
  const [styles, setStyles] = useState(null);
  useLayoutEffect(() => { setStyles(getComputedStyle(box.current)); }, []);
  const resolve = (color) => {
    const m = /^var\((--[^)]+)\)$/.exec(color || '');
    return m && styles ? styles.getPropertyValue(m[1]).trim() || '#888' : color;
  };

  const cats = wigs.map((d) => CATEGORIES.find((c) => c.key === category(d)));
  const pct = wigs.map((d) => Math.round(Math.min(100, Math.max(0, d.pct || 0))));
  const open = (i) => {
    const d = wigs[i];
    if (d) onOpen({ title: shortName(d.name), sub: `WIG · ${cats[i].label} · ${pct[i]}% complete`, list: [d] });
  };

  const options = styles && {
    chart: {
      type: 'radialBar',
      fontFamily: 'Roboto, "Segoe UI", system-ui, sans-serif',
      events: { dataPointSelection: (_e, _ctx, { dataPointIndex }) => open(dataPointIndex) },
    },
    labels: wigs.map((d) => cut(shortName(d.name))),
    colors: cats.map((c) => resolve(c.color)),
    plotOptions: {
      radialBar: {
        offsetY: 0,
        startAngle: 0,
        endAngle: 270,
        hollow: { margin: 5, size: '30%', background: 'transparent' },
        dataLabels: { name: { show: false }, value: { show: false } },
        // The WIG's name and % at the start of its ring, in its color
        barLabels: {
          enabled: true,
          useSeriesColors: true,
          offsetX: -8,
          fontSize: wigs.length > 6 ? '12px' : '15px',
          fontWeight: 700,
          formatter: (name, opts) => `${name}:  ${opts.w.globals.series[opts.seriesIndex]}%`,
        },
      },
    },
    legend: { show: false },
    states: { hover: { filter: { type: 'darken', value: 0.92 } }, active: { filter: { type: 'none' } } },
  };

  return (
    <div className="sb-wigchart sb-wigradial" ref={box}>
      {options && (
        <div className="sb-wigradial__chart">
          <Chart type="radialBar" series={pct} options={options} height={Math.max(390, 300 + wigs.length * 24)} />
        </div>
      )}
    </div>
  );
}
