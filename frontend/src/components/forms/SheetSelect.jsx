export default function SheetSelect({ sheets, value, onChange }) {
  if (!sheets.length) return null;
  return (
    <label className="field">
      <span className="field__label">Sheet</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {sheets.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
      </select>
    </label>
  );
}
