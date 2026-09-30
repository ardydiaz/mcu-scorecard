// Latest status update, with the older ones behind a "History" toggle
export default function StatusHistory({ statuses = [] }) {
  if (!statuses.length) return <p className="status status--empty">No status update yet</p>;
  const [latest, ...older] = statuses;

  return (
    <div className="status">
      <p className="status__latest">
        <span className="status__label">{latest.label}</span>
        <span className="status__text">{latest.text}</span>
      </p>
      {older.length > 0 && (
        <details className="status__history">
          <summary>History ({older.length})</summary>
          <ul>
            {older.map((s) => (
              <li key={s.label}>
                <span className="status__label">{s.label}</span>
                <span className="status__text">{s.text}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
