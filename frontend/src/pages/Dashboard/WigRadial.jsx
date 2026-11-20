import { useLayoutEffect, useRef, useState } from 'react';
import Chart from 'react-apexcharts';
import { CATEGORIES, category, shortName } from './scoreboardData';
import { WigWhy, wigStats } from './WigInsight';

/**
 * WIGs as gauges (ApexCharts "Gauge with Ticks"): one card per WIG, its arc filled to its
 * completion % in its status color (the dashboard's, as in the section legend), the % and status
 * in the center and the WIG's name below. `wigs` come in the board's order (behind / at risk first).
 * Hovering a card shows its progress status and its progress week by week (`history` = the
 * updates up to "Status as of"); selecting it opens the WIG's progress window (onInsight).
 */
export default function WigRadial({ wigs, history = [], onInsight }) {
  const box = useRef(null);
  const [styles, setStyles] = useState(null);
  const [hover, setHover] = useState(null);
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
        const key = d.row ?? i;
        // ApexCharts "Gauge with Ticks": 0–100 scale with ticks around a 270° arc, in the status color
        const options = {
          chart: { type: 'gauge', fontFamily: 'Roboto, "Segoe UI", system-ui, sans-serif' },
          colors: [color],
          labels: [cat.label],
          tooltip: { enabled: false },
          plotOptions: {
            radialBar: {
              startAngle: -135,
              endAngle: 135,
              ticks: {
                show: true,
                major: { count: 11, length: 10, width: 2, color: '#475569', placement: 'outside' },
                minor: { count: 3, length: 5, width: 1, color: '#94A3B8', placement: 'outside' },
                labels: { show: true, offset: 8, fontSize: '10px', color: '#475569', formatter: (v) => Math.round(v) },
              },
              hollow: { margin: 26, size: '50%' },
              track: { strokeWidth: '60%', background: '#E2E8F0' },
              dataLabels: {
                name: { show: true, offsetY: 30, fontSize: '13px', fontWeight: 700, color },
                value: { show: true, offsetY: -6, fontSize: '26px', fontWeight: 700, color: '#1f1a24', formatter: (v) => `${Math.round(v)}%` },
              },
            },
          },
          states: { hover: { filter: { type: 'none' } }, active: { filter: { type: 'none' } } },
        };
        const show = hover === key;
        return (
          <div key={key} className={`sb-wigradial__item${show ? ' is-hover' : ''}`}
            onMouseEnter={() => setHover(key)} onMouseLeave={() => setHover(null)}>
            <button type="button" className="sb-wigradial__card" style={{ '--c': cat.color }}
              aria-label={`${name}: ${pct}% ${cat.label}, open the progress`}
              onFocus={() => setHover(key)} onBlur={() => setHover(null)}
              onClick={() => { setHover(null); onInsight(d); }}>
              <Chart type="gauge" series={[pct]} options={options} height={260} />
              <span className="sb-wigradial__name">{name}</span>
              <small>Class {d.tier} · {d.lead || '—'}</small>
            </button>
            {show && <WigWhy stats={wigStats(d, history)} />}
          </div>
        );
      })}
    </div>
  );
}
