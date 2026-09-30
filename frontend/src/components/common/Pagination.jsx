const PAGE_SIZES = [25, 50, 100, 200];

// Page numbers to show around the current page, with '…' for gaps: 1 … 4 5 [6] 7 8 … 20
function pageList(page, totalPages) {
  const pages = new Set([1, totalPages]);
  for (let p = page - 2; p <= page + 2; p++) if (p >= 1 && p <= totalPages) pages.add(p);
  const sorted = [...pages].sort((a, b) => a - b);
  const list = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) list.push(`gap-${p}`);
    list.push(p);
  });
  return list;
}

/**
 * Controls for server-side pagination: the parent fetches `page` / `pageSize` from the API
 * and passes the `total` count the API returned.
 */
export default function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange, noun = 'entries' }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const go = (p) => { if (p >= 1 && p <= totalPages && p !== page) onPageChange(p); };

  return (
    <div className="pagination">
      <span className="pagination__summary muted">
        {total === 0 ? `No ${noun}` : `Showing ${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()} ${noun}`}
      </span>

      {totalPages > 1 && (
        <nav className="pagination__pages" aria-label="Pages">
          <button type="button" className="pagination__btn" onClick={() => go(1)} disabled={page === 1} aria-label="First page">«</button>
          <button type="button" className="pagination__btn" onClick={() => go(page - 1)} disabled={page === 1} aria-label="Previous page">‹</button>
          {pageList(page, totalPages).map((p) => (typeof p === 'string' ? (
            <span key={p} className="pagination__gap">…</span>
          ) : (
            <button
              key={p}
              type="button"
              className={p === page ? 'pagination__btn pagination__btn--on' : 'pagination__btn'}
              aria-current={p === page ? 'page' : undefined}
              onClick={() => go(p)}
            >
              {p}
            </button>
          )))}
          <button type="button" className="pagination__btn" onClick={() => go(page + 1)} disabled={page === totalPages} aria-label="Next page">›</button>
          <button type="button" className="pagination__btn" onClick={() => go(totalPages)} disabled={page === totalPages} aria-label="Last page">»</button>
        </nav>
      )}

      {onPageSizeChange && (
        <label className="pagination__size">
          <span className="muted">Rows per page</span>
          <select className="input input--sm" value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))}>
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}
