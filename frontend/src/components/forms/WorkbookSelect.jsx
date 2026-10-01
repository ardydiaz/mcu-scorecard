const STATUS_SUFFIX = { draft: ' (Draft)', hidden: ' (Hidden)' };

// Scorecard file picker (hidden files are never listed). Shown even with a single file, so users
// always see which file they're looking at. `value` '' means the default file.
export default function WorkbookSelect({ workbooks, value, onChange }) {
  if (!workbooks.length) return null;
  const selected = value || String(workbooks.find((w) => w.isDefault)?.id ?? workbooks[0].id);
  return (
    <label className="field">
      <span className="field__label">File</span>
      <select className="input" value={selected} onChange={(e) => onChange(e.target.value)}>
        {workbooks.map((w) => (
          <option key={w.id} value={String(w.id)}>
            {w.name.replace(/\.xlsx$/i, '')}{STATUS_SUFFIX[w.status] || ''}{w.isDefault ? ' — default' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
