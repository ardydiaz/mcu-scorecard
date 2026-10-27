import { category, tierOrder } from './scoreboardData';
import WigRadial from './WigRadial';

// Worst first, so the WIGs that need attention lead the board
const URGENCY = ['atrisk', 'behind', 'unreported', 'ontrack', 'completed'];

/**
 * WIG scoreboard (4DX: Wildly Important Goals): the projects marked in the sheet's "Wigs" column.
 * WigRadial: one ring per WIG (its completion %, "Custom Angle" radial bars), ordered by urgency
 * (at risk / behind first), then tier. Status colors are the dashboard's (same legend as Overall
 * Status). Selecting a ring opens the WIG's details. (WigBars and WigDaily are not shown for now.)
 */
export default function WigBoard({ projects, onOpen }) {
  const wigs = projects
    .filter((d) => d.wig)
    .sort((a, b) => URGENCY.indexOf(category(a)) - URGENCY.indexOf(category(b)) || tierOrder(a.tier, b.tier) || a.row - b.row);
  if (!wigs.length) return null;
  return (
    <WigRadial wigs={wigs} onOpen={onOpen} />
  );
}
