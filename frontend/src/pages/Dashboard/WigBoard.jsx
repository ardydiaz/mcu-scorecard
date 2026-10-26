import { category, tierOrder } from './scoreboardData';
import WigColumns from './WigColumns';

// Worst first, so the WIGs that need attention lead the board
const URGENCY = ['atrisk', 'behind', 'unreported', 'ontrack', 'completed'];

/**
 * WIG scoreboard (4DX: Wildly Important Goals): the projects marked in the sheet's "Wigs" column, as
 * a summary strip and a distributed column chart (WigColumns.jsx), one column per WIG. WIGs are
 * ordered by urgency (at risk / behind first), then tier. Status colors are the dashboard's (same
 * legend as Overall Status). Selecting a figure or a column opens the WIG details and latest note. `asOfLabel` is the update being viewed.
 */
export default function WigBoard({ projects, asOfLabel, onOpen }) {
  const wigs = projects
    .filter((d) => d.wig)
    .sort((a, b) => URGENCY.indexOf(category(a)) - URGENCY.indexOf(category(b)) || tierOrder(a.tier, b.tier) || a.row - b.row);
  if (!wigs.length) return null;

  const count = (keys) => wigs.filter((d) => keys.includes(category(d))).length;
  const winning = count(['ontrack', 'completed']);
  const attention = count(['behind', 'atrisk']);
  const avg = Math.round(wigs.reduce((s, d) => s + (d.pct || 0), 0) / wigs.length);
  const pct = (n) => Math.round((n / wigs.length) * 100);
  const openList = (title, list) => onOpen({ title, sub: `${list.length} of ${wigs.length} WIGs`, list });

  return (
    <>
      <div className="sb-wigstats">
        <button type="button" onClick={() => openList('All WIGs', wigs)}>
          <b>{wigs.length}</b><span>WIG{wigs.length === 1 ? '' : 's'}</span>
        </button>
        <button type="button" onClick={() => openList('WIGs on track or completed', wigs.filter((d) => ['ontrack', 'completed'].includes(category(d))))}>
          <b style={{ color: 'var(--sb-ontrack)' }}>{pct(winning)}%</b><span>winning ({winning} on track or done)</span>
        </button>
        <button type="button" onClick={() => openList('WIGs behind or at risk', wigs.filter((d) => ['behind', 'atrisk'].includes(category(d))))}>
          <b style={{ color: attention ? 'var(--sb-atrisk)' : 'var(--text)' }}>{attention}</b><span>behind or at risk</span>
        </button>
        <div>
          <b>{avg}%</b><span>average completion</span>
          <i className="sb-wigstats__bar"><i style={{ width: `${avg}%` }} /></i>
        </div>
      </div>

      <WigColumns wigs={wigs} asOfLabel={asOfLabel} onOpen={onOpen} />
    </>
  );
}
