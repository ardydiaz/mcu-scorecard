import { category, tierOrder } from './scoreboardData';
import WigBars from './WigBars';

// Worst first, so the WIGs that need attention lead the board
const URGENCY = ['atrisk', 'behind', 'unreported', 'ontrack', 'completed'];

/**
 * WIG scoreboard (4DX: Wildly Important Goals): the projects marked in the sheet's "Wigs" column.
 * WigBars: one 100% stacked bar per WIG (its completion %), ordered by urgency (at risk / behind
 * first), then tier. Status colors are the dashboard's (same legend as Overall Status). Selecting a
 * bar opens the WIG's details. (WigDaily, the status per day, is not shown for now.)
 */
export default function WigBoard({ projects, asOfLabel, onOpen }) {
  const wigs = projects
    .filter((d) => d.wig)
    .sort((a, b) => URGENCY.indexOf(category(a)) - URGENCY.indexOf(category(b)) || tierOrder(a.tier, b.tier) || a.row - b.row);
  if (!wigs.length) return null;
  return (
    <WigBars wigs={wigs} asOfLabel={asOfLabel} onOpen={onOpen} />
  );
}
