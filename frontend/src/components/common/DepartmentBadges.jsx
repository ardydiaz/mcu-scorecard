// Lead codes render solid, support codes outlined; `highlight` marks the viewer's own departments
export default function DepartmentBadges({ lead = [], support = [], highlight = [] }) {
  if (!lead.length && !support.length) return null;
  const mine = new Set(highlight);
  return (
    <span className="dept-badges">
      {lead.map((code) => (
        <span key={`l-${code}`} className={`dept dept--lead${mine.has(code) ? ' dept--mine' : ''}`} title="Lead">{code}</span>
      ))}
      {support.map((code) => (
        <span key={`s-${code}`} className={`dept dept--support${mine.has(code) ? ' dept--mine' : ''}`} title="Support">{code}</span>
      ))}
    </span>
  );
}
