import { useLayoutEffect, useRef, useState } from 'react';
import Chart from 'react-apexcharts';
import { CATEGORIES, category, shortName } from './scoreboardData';

/**
 * WIGs as basic radial bars (ApexCharts "Basic RadialBar"): one card per WIG, its ring filled to its
 * completion % in its status color (the dashboard's, as in the section legend), the status and %
 * in the center and the WIG's name below. `wigs` come in the board's order (behind / at risk first).
 * Selecting a card opens the WIG's details.
 */
export default function WigRadial({ wigs, onOpen }) {
  const box = useRef(null);
  const [styles, setStyles] = useState(null);
  useLayoutEffect(() => { setStyles(getComputedStyle(box.current)); }, []);
  const resolve = (color) => {
    const m = /^var\((--[^)]+)\)$/.exec(color || '');
    return m && styles ? styles.getPropertyValue(m[1]).trim() || '#888' : color;
  };

  return (
    <div className="sb-wigradial" ref={box}>
      {styles && wigs.map((d, i) => {
        const cat = CATEGORIES.find((c) => c.key === category(d));
        const color = resolve(cat.color);
        const pct = Math.round(Math.min(100, Math.max(0, d.pct || 0)));
        const name = shortName(d.name);
        const open = () => onOpen({ title: name, sub: `WIG · ${cat.label} · ${pct}% complete`, list: [d] });
        const options = {
          chart: { type: 'radialBar', fontFamily: 'Roboto, "Segoe UI", system-ui, sans-serif', sparkline: { enabled: false } },
          colors: [color],
          labels: [cat.label],
          plotOptions: {
            radialBar: {
              hollow: { size: '70%' },
              track: { background: '#f2f2f2' },
              dataLabels: {
                name: { show: true, offsetY: -6, fontSize: '15px', fontWeight: 700, color },
                value: { show: true, offsetY: 6, fontSize: '22px', fontWeight: 800, color: '#1f1a24', formatter: (v) => `${Math.round(v)}%` },
              },
            },
          },
          states: { hover: { filter: { type: 'none' } }, active: { filter: { type: 'none' } } },
        };
        return (
          <button key={d.row ?? i} type="button" className="sb-wigradial__card" style={{ '--c': cat.color }} onClick={open} title={name}>
            <Chart type="radialBar" series={[pct]} options={options} height={230} />
            <span className="sb-wigradial__name">{name}</span>
            <small>Class {d.tier} · {d.lead || '—'}</small>
          </button>
        );
      })}
    </div>
  );
}
