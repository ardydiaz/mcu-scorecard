/**
 * The University's strategy map (as on the official slide), drawn as a modern diagram:
 * new programs and innovations build quality, quality creates a delightful student journey,
 * and that grows revenue. A picture only: nothing to click, no data from Excel.
 */

// Boxes on the map: position (center, in the 1000×640 drawing) and color group
const NODES = [
  { id: 'revenue', title: ['Grow', 'Revenue'], x: 300, y: 96, w: 190, h: 70, kind: 'finance' },
  { id: 'lean', title: ['Go', 'Lean'], x: 700, y: 96, w: 190, h: 70, kind: 'finance' },
  { id: 'journey', title: ['Delightful', 'Student Journey'], x: 500, y: 238, w: 230, h: 78, kind: 'student' },
  { id: 'outcome', title: ['Outcome-Focused', 'Learning System'], x: 240, y: 382, w: 220, h: 70, kind: 'quality' },
  { id: 'campus', title: ['Inspiring Campus', 'Environment'], x: 500, y: 382, w: 220, h: 70, kind: 'quality' },
  { id: 'reputation', title: ['World Class', 'Reputation'], x: 760, y: 382, w: 210, h: 70, kind: 'quality' },
  { id: 'programs', title: ['New', 'Programs'], x: 370, y: 540, w: 190, h: 70, kind: 'innovation' },
  { id: 'innovations', title: ['New', 'Innovations'], x: 630, y: 540, w: 190, h: 70, kind: 'innovation' },
];

const LANES = [
  { label: 'Profitability', y: 46, h: 100 },
  { label: 'Student', y: 186, h: 104 },
  { label: 'Quality', y: 330, h: 104 },
  { label: 'Innovation', y: 488, h: 104 },
];

// Connectors: pink = internal results feeding the student journey and revenue; gold = innovation enabling them
const LINKS = [
  { kind: 'pink', d: 'M500 199 V164 H300 V133', arrow: true }, // journey -> grow revenue
  { kind: 'pink', d: 'M240 347 V226 H383', arrow: true }, // outcome-focused -> journey
  { kind: 'pink', d: 'M500 347 V279', arrow: true }, // campus -> journey
  { kind: 'pink', d: 'M760 347 V226 H617', arrow: true }, // reputation -> journey
  { kind: 'gold', d: 'M275 540 H120 V96 H203', arrow: true }, // new programs -> grow revenue
  { kind: 'gold', d: 'M725 540 H880 V96 H797', arrow: true }, // new innovations -> go lean
  { kind: 'gold', d: 'M370 505 V462 H240 V419', arrow: true }, // new programs -> outcome-focused
  { kind: 'gold', d: 'M370 462 H520 V419', arrow: true }, // new programs -> campus
  { kind: 'gold', d: 'M640 505 V252 H617', arrow: true }, // new innovations -> journey
  { kind: 'gold', d: 'M600 505 V462 H520', arrow: false }, // new innovations -> shared line to campus
];

export default function StrategyDiagram() {
  return (
    <div className="page smap">
      <div className="smap-hero">
        <div className="smap-hero__eyebrow"><i />Manila Central University</div>
        <h1 className="smap-hero__title">Strategy Map</h1>
        <p className="smap-hero__sub">
          How our objectives connect: new programs and innovations build quality, quality creates a delightful student journey,
          and that grows revenue while we go lean.
        </p>
      </div>

      <div className="smap-canvas">
        <svg viewBox="0 0 1000 640" role="img" aria-label="Strategy map: New Programs and New Innovations lead to Outcome-Focused Learning System, Inspiring Campus Environment and World Class Reputation, which lead to a Delightful Student Journey, Grow Revenue and Go Lean">
          <defs>
            <marker id="smap-arrow-pink" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="#ff5c93" />
            </marker>
            <marker id="smap-arrow-gold" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="#ffd62e" />
            </marker>
          </defs>

          {LANES.map((l) => (
            <g key={l.label}>
              <rect className="smap-lane" x="20" y={l.y} width="960" height={l.h} rx="18" />
              <text className="smap-lane__label" x="44" y={l.y + l.h / 2} transform={`rotate(-90 44 ${l.y + l.h / 2})`} textAnchor="middle">{l.label}</text>
            </g>
          ))}

          {LINKS.map((ln) => (
            <g key={ln.d}>
              <path className={`smap-link smap-link--${ln.kind}`} d={ln.d} markerEnd={ln.arrow ? `url(#smap-arrow-${ln.kind})` : undefined} />
              <path className={`smap-flow smap-flow--${ln.kind}`} d={ln.d} />
            </g>
          ))}

          {NODES.map((node) => (
            <g key={node.id} className={`smap-node smap-node--${node.kind}`} transform={`translate(${node.x} ${node.y})`}>
              <rect className="smap-node__shape" x={-node.w / 2} y={-node.h / 2} width={node.w} height={node.h} rx={node.h / 2} />
              <text className="smap-node__title" textAnchor="middle" y="-4">
                {node.title.map((t, i) => <tspan key={t} x="0" dy={i ? 19 : 0}>{t}</tspan>)}
              </text>
            </g>
          ))}
        </svg>
        <div className="smap-legend">
          <span><i className="smap-dot smap-dot--finance" />Profitability</span>
          <span><i className="smap-dot smap-dot--quality" />Student &amp; Quality</span>
          <span><i className="smap-dot smap-dot--innovation" />Innovation</span>
          <span className="smap-legend__hint">Arrows show what each objective drives.</span>
        </div>
      </div>
    </div>
  );
}
