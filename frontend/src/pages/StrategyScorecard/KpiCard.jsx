import DepartmentBadges from '../../components/common/DepartmentBadges';
import StatusHistory from '../../components/common/StatusHistory';
import { EXCEL_WINDOW } from '../../components/common/ExcelEmbed';

function EditInExcel({ href }) {
  if (!href) return null;
  return (
    <a className="edit-link" href={href} target={EXCEL_WINDOW} rel="noreferrer" title="Open this row in Excel to update it">
      Edit in Excel ↗
    </a>
  );
}

export default function KpiCard({ kpi, highlight, excelLinkFor = () => '' }) {
  return (
    <article className="kpi">
      {kpi.name && (
        <header className="kpi__header">
          <div className="kpi__title-wrap">
            <h4 className="kpi__title">{kpi.name}</h4>
            {kpi.qualityPolicy && <p className="kpi__policy">{kpi.qualityPolicy}</p>}
          </div>
          <div className="kpi__actions">
            <DepartmentBadges lead={kpi.lead} support={kpi.support} highlight={highlight} />
            <EditInExcel href={excelLinkFor(kpi.cell)} />
          </div>
        </header>
      )}

      {(kpi.targets.length > 0 || kpi.tier) && (
        <dl className="targets">
          {kpi.targets.map((t) => (
            <div key={t.label} className="targets__item">
              <dt>{t.label}</dt>
              <dd>{t.value}</dd>
            </div>
          ))}
          {kpi.tier && (
            <div className="targets__item">
              <dt>Tier</dt>
              <dd>{kpi.tier}</dd>
            </div>
          )}
        </dl>
      )}

      {kpi.name && (kpi.statuses.length > 0 || !kpi.projects.length) && <StatusHistory statuses={kpi.statuses} />}
      {kpi.execomNotes && <p className="note"><strong>Execom notes:</strong> {kpi.execomNotes}</p>}
      {kpi.notes.map((n, i) => <p key={i} className="note">{n}</p>)}

      {kpi.projects.length > 0 && (
        <ul className="projects">
          {kpi.projects.map((p) => (
            <li key={p.row} className="project">
              <div className="project__header">
                <span className="project__name">{p.name}</span>
                <div className="kpi__actions">
                  <DepartmentBadges lead={p.lead} support={p.support} highlight={highlight} />
                  <EditInExcel href={excelLinkFor(p.cell)} />
                </div>
              </div>
              <p className="project__meta">
                {(p.launchDate || p.completionDate) && <span>{p.launchDate || '?'} → {p.completionDate || '?'}</span>}
                {p.target && <span>Target: {p.target}</span>}
                {p.trafficLight && <span>Traffic light: {p.trafficLight}</span>}
              </p>
              <StatusHistory statuses={p.statuses} />
              {p.execomNotes && <p className="note"><strong>Execom notes:</strong> {p.execomNotes}</p>}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
