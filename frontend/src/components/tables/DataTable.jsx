import { useMemo, useState } from 'react';
import { formatCell } from '../../utils/format';

// Generic table for rows of plain objects; columns default to the first row's keys
export default function DataTable({ rows, columns, searchable = true, emptyText = 'No data' }) {
  const [query, setQuery] = useState('');
  const cols = useMemo(() => columns || (rows.length ? Object.keys(rows[0]) : []), [columns, rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => cols.some((c) => String(row[c] ?? '').toLowerCase().includes(q)));
  }, [rows, cols, query]);

  return (
    <div className="table-wrap">
      {searchable && rows.length > 0 && (
        <input
          type="search"
          className="input table-wrap__search"
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={cols.length || 1} className="table__empty">{emptyText}</td></tr>
            ) : (
              filtered.map((row, i) => (
                <tr key={i}>{cols.map((c) => <td key={c}>{formatCell(row[c])}</td>)}</tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
