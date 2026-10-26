import { category, tierOrder } from './scoreboardData';
import WigDaily from './WigDaily';

// Worst first, so the WIGs that need attention lead the board
const URGENCY = ['atrisk', 'behind', 'unreported', 'ontrack', 'completed'];

/**
 * WIG scoreboard (4DX: Wildly Important Goals): the projects marked in the sheet's "Wigs" column.
 * WigDaily: status tiles for a chosen day and the status per day (saved daily snapshots), WIGs
 * ordered by urgency (at risk / behind first), then tier. Status colors are the dashboard's (same
 * legend as Overall Status). Selecting a tile or a day opens those WIGs' details.
 */
export default function WigBoard({ projects, onOpen, workbook, sheet, department }) {
  const wigs = projects
    .filter((d) => d.wig)
    .sort((a, b) => URGENCY.indexOf(category(a)) - URGENCY.indexOf(category(b)) || tierOrder(a.tier, b.tier) || a.row - b.row);
  if (!wigs.length) return null;
  return (
    <WigDaily wigs={wigs} workbook={workbook} sheet={sheet} department={department} onOpen={onOpen} />
  );
}
