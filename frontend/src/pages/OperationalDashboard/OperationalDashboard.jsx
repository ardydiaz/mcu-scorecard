import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getOperational } from '../../api/operationalApi';
import Loader from '../../components/common/Loader';
import ErrorMessage from '../../components/common/ErrorMessage';
import OperationalExcel from './OperationalExcel';
import { AreaRadials, ConditionBars, ConditionDonut, ConditionGroupedBars, clearColor, clearRate } from './OperationalCharts';

// Condition of an item, from its latest update (worked out by the server, see operational.service)
const STATUSES = [
  { key: 'issue', label: 'Needs attention', color: '#a93b3b' },
  { key: 'checking', label: 'For checking', color: '#ffbc00' },
  { key: 'good', label: 'Good condition', color: '#2d6cb5' },
  { key: 'noted', label: 'Update noted', color: '#2f7d5a' },
  { key: 'none', label: 'No update yet', color: '#a9a3b0' },
];
const statusOf = (key) => STATUSES.find((s) => s.key === key) || STATUSES[4];
const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Operational Dashboard: the ICT operational report (4M: Manpower, Materials, Machinery, Methods)
 * read live from the Excel file in SharePoint's "Operational" folder. Read-only: overall condition,
 * each area, and every item's latest update; select an item to see all its updates. The Excel view
 * (?view=excel) shows the file itself as a grid, editable by admins and the ICT office.
 */
export default function OperationalDashboard() {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'excel' ? 'excel' : 'dashboard';
  const setView = (v) => setParams(v === 'excel' ? { view: 'excel' } : {}, { replace: true });
  const [refreshKey, setRefreshKey] = useState(0);
  const [stale, setStale] = useState(false); // the file was edited in the Excel view since the dashboard loaded
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [area, setArea] = useState('');
  const [status, setStatus] = useState('');
  const [pic, setPic] = useState('');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState(null);
  // Items popup: null = closed; { status } = one condition ('all' = every item); { area, status? } = one area
  const [pop, setPop] = useState(null);

  const load = useCallback((refresh = false) => {
    setLoading(true);
    setError('');
    getOperational({ refresh })
      .then((d) => { setData(d); setStale(false); })
      .catch((err) => setError(err.response?.data?.message || err.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  // Back on the dashboard after editing the file: read it again so the cards show the changes
  useEffect(() => { if (view === 'dashboard' && stale) load(true); }, [view, stale, load]);
  const refreshAll = () => {
    load(true);
    setRefreshKey((k) => k + 1);
  };

  const items = useMemo(() => (data?.sections || []).flatMap((s) => s.items.map((it) => ({ ...it, section: s.name }))), [data]);
  const count = (list, key) => list.filter((it) => it.status === key).length;
  const asOf = data?.updates?.[data.updates.length - 1] || '—';
  const q = search.trim().toLowerCase();
  const shown = items.filter((it) => (!area || it.section === area) && (!status || it.status === status) && (!pic || it.pic.includes(pic))
    && (!q || [it.name, it.particular, it.latest, it.group, ...it.pic].join(' ').toLowerCase().includes(q)));
  // Items per person in charge (an item with several people counts for each), most items first
  const byPic = useMemo(() => {
    const map = new Map();
    items.forEach((it) => it.pic.forEach((p) => map.set(p, [...(map.get(p) || []), it])));
    return [...map.entries()].map(([name, list]) => ({ name, items: list })).sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));
  }, [items]);
  const listRef = useRef(null);
  // A chart selection filters the item list and scrolls to it
  const showItems = ({ area: a = '', status: s = '', pic: p = '' }) => {
    setArea(a);
    setStatus(s);
    setPic(p);
    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="page sb op">
      <header className="sb-mast">
        <div className="sb-mast__in">
          <img src="/mcu-logo.png" alt="Manila Central University logo" />
          <div>
            <div className="sb-eyebrow"><i />ICT Operations · Manpower, Materials, Machinery, Methods</div>
            <h1 className="sb-title">Operational Dashboard</h1>          </div>
        </div>
      </header>

      <div className="sb-metabar">
        <div className="sb-metaitem"><div className="k">Latest update</div><div className="v">{data ? asOf : '—'}</div></div>
        <div className="sb-metaitem"><div className="k">Items tracked</div><div className="v">{data ? items.length : '—'}</div></div>
        <div className="sb-metaitem"><div className="k">Updates recorded</div><div className="v">{data ? data.updates.length : '—'}</div></div>
        <div className="sb-metaitem"><div className="k">Last edited in Excel</div><div className="v">{fmtDateTime(data?.file?.lastModified)}</div></div>
      </div>

      <div className="toolbar">
        <div className="segmented" role="group" aria-label="View">
          {[['dashboard', 'Dashboard'], ['excel', 'Excel']].map(([key, label]) => (
            <button key={key} type="button" aria-pressed={view === key}
              className={view === key ? 'segmented__btn segmented__btn--active' : 'segmented__btn'} onClick={() => setView(key)}>
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn--ghost op-refresh" onClick={refreshAll} disabled={loading}>Refresh from Excel</button>      </div>

      {view === 'excel' && <OperationalExcel refreshKey={refreshKey} onChanged={() => setStale(true)} />}

      {view === 'dashboard' && <ErrorMessage>{error}</ErrorMessage>}
      {view === 'dashboard' && loading && !data && <Loader center label="Reading the Operational file…" />}

      {view === 'dashboard' && data && (
        <>
          <section className="sb-section">
            <div className="sb-head"><span>01</span><h2>Overall Condition</h2></div>
            <div className="sb-subrow">
              <p className="sb-sub">Every item counted by its latest update. Select a card or a part of the chart to see those items.</p>
              <StatusLegend />
            </div>
            <div className="op-overview">
            <div className="sb-cards op-cards">
              <button type="button" className="sb-card sb-card--total" onClick={() => setPop({ status: 'all' })}>
                <div className="sb-card__n">{items.length}</div>
                <div className="sb-card__l">Total items</div>
                <div className="sb-card__sub op-card__see">See all items →</div>
              </button>
              {STATUSES.filter((s) => s.key !== 'none' || count(items, 'none')).map((s) => (
                <button key={s.key} type="button" className="sb-card" style={{ '--c': s.color }}
                  onClick={() => setPop({ status: s.key })} disabled={!count(items, s.key)}>
                  <div className="sb-card__n">{count(items, s.key)}</div>
                  <div className="sb-card__l">{s.label}</div>
                  <div className="sb-card__sub"><b>{items.length ? Math.round((count(items, s.key) / items.length) * 100) : 0}%</b> of items</div>
                </button>
              ))}
            </div>
            <ConditionDonut items={items} statuses={STATUSES} onSelect={(s) => setPop({ status: s })} />
            </div>
          </section>

          <section className="sb-section">
            <div className="sb-head"><span>02</span><h2>Condition by Area</h2></div>
            <p className="sb-sub">
              The four areas of ICT operations: Manpower, Materials, Machinery and Methods.
              Each gauge shows how much of the area has no issues: items not needing attention and nothing waiting to be checked
              (blue from 90%, yellow from 70%, red below). Select a gauge or a bar to see those items.
            </p>
            <AreaRadials sections={data.sections} onSelect={(a) => setPop({ area: a })} />
            <ConditionGroupedBars title="Condition of each area" groups={data.sections} statuses={STATUSES}
              onSelect={(a, s) => setPop({ area: a, status: s })} />
          </section>

          <section className="sb-section">
            <div className="sb-head"><span>03</span><h2>By Person in Charge</h2></div>
            <p className="sb-sub">
              The items each person in charge handles, by condition (an item with several people counts for each).
              Select a bar to show that person&apos;s items.
            </p>
            <ConditionBars title="Condition of each person's items" groups={byPic} statuses={STATUSES}
              onSelect={(p, s) => showItems({ pic: p, status: s })} />
          </section>

          <section className="sb-section" ref={listRef}>
            <div className="sb-head"><span>04</span><h2>Items and Latest Updates</h2></div>
            <div className="op-filters">
              <input className="input op-search" type="search" placeholder="Search items, updates or person in charge…"
                value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search items" />
              {(area || status || pic) && (
                <div className="op-active">
                  {area && <button type="button" onClick={() => setArea('')}>{area} ✕</button>}
                  {pic && <button type="button" onClick={() => setPic('')}>In charge: {pic} ✕</button>}
                  {status && <button type="button" onClick={() => setStatus('')}>{statusOf(status).label} ✕</button>}
                </div>
              )}
              <span className="op-showing">{plural(shown.length, 'item')} shown</span>
            </div>

            {shown.length === 0 && <p className="sb-empty">No items match these filters.</p>}
            {data.sections.filter((s) => !area || s.name === area).map((s) => {
              const list = shown.filter((it) => it.section === s.name);
              if (!list.length) return null;
              return (
                <div key={s.name} className="op-group">
                  <div className="op-group__head"><h3>{s.name}</h3><span>{plural(list.length, 'item')}</span></div>
                  <div className="op-items">
                    {list.map((it) => <ItemCard key={it.row} it={it} onOpen={() => setDetail(it)} />)}
                  </div>
                </div>
              );
            })}
          </section>
        </>
      )}

      <ItemsDialog pop={pop} items={items} sections={data?.sections || []} onClose={() => setPop(null)} onOpen={setDetail} />
      <ItemDialog item={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

/**
 * Popup listing items, opened two ways:
 *  - { status }: one condition ('all' = every item), with tabs per area (Overall Condition)
 *  - { area, status? }: one area, with its condition breakdown and tabs per condition, starting on
 *    `status` when a bar was selected (Condition by Area)
 * Selecting an item opens its full history on top (ItemDialog); closing that returns here.
 */
function ItemsDialog({ pop, items, sections, onClose, onOpen }) {
  const ref = useRef(null);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState(null); // null = the tab the popup opened on
  useEffect(() => {
    const dlg = ref.current;
    if (pop && !dlg.open) dlg.showModal();
    if (!pop && dlg.open) dlg.close();
  }, [pop]);
  const close = () => { setQ(''); setTab(null); onClose(); };

  const byArea = Boolean(pop?.area);
  const base = !pop ? [] : byArea
    ? items.filter((it) => it.section === pop.area)
    : items.filter((it) => pop.status === 'all' || it.status === pop.status);
  const current = tab ?? (byArea ? pop.status || '' : '');
  // Tabs: the conditions of the area, or the areas of the condition (only those with items)
  const tabs = byArea
    ? STATUSES.map((s) => ({ key: s.key, label: s.label, color: s.color, n: base.filter((it) => it.status === s.key).length })).filter((t) => t.n)
    : sections.map((s) => ({ key: s.name, label: s.name, n: base.filter((it) => it.section === s.name).length })).filter((t) => t.n);
  const term = q.trim().toLowerCase();
  const list = base.filter((it) => (!current || (byArea ? it.status === current : it.section === current))
    && (!term || [it.name, it.particular, it.latest, it.group, it.section, ...it.pic].join(' ').toLowerCase().includes(term)));

  const st = !byArea && pop && pop.status !== 'all' ? statusOf(pop.status) : null;
  const okRate = byArea ? clearRate(base) : 0;
  const color = byArea ? clearColor(okRate) : st ? st.color : '#57177a';
  const showPill = byArea || pop?.status === 'all'; // the list mixes conditions

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog ref={ref} className="op-pop" style={{ '--c': color }} aria-labelledby="op-pop-title" onClose={close}
      onClick={(e) => { if (e.target === ref.current) close(); }}>
      {pop && (
        <>
          <header className="op-pop__head">
            {byArea ? (
              <div className="op-pop__ring" style={{ '--p': okRate }}><span>{okRate}%</span><small>no issues</small></div>
            ) : (
              <div className="op-pop__badge"><span>{base.length}</span><small>of {items.length}</small></div>
            )}
            <div className="op-pop__titles">
              <div className="op-pop__eyebrow">{byArea ? 'Condition by area' : 'Overall condition'}</div>
              <h3 id="op-pop-title">{byArea ? pop.area : st ? st.label : 'All items'}</h3>
              <p>
                {byArea
                  ? `${base.length - base.filter((it) => it.status === 'issue' || it.status === 'checking').length} of ${plural(base.length, 'item')} with no issues`
                  : `${items.length ? Math.round((base.length / items.length) * 100) : 0}% of all items · ${plural(tabs.length, 'area')}`}
              </p>
            </div>
            <button type="button" className="op-pop__x" onClick={close} aria-label="Close">✕</button>
            {byArea && (
              <div className="op-pop__split" aria-label="Condition breakdown">
                {tabs.map((t) => (
                  <button key={t.key} type="button" style={{ flexGrow: t.n, background: t.color }} title={`${t.label}: ${t.n}`}
                    className={current === t.key ? 'op-on' : ''} onClick={() => setTab(current === t.key ? '' : t.key)}>
                    {t.n}
                  </button>
                ))}
              </div>
            )}
          </header>

          <div className="op-pop__tools">
            <input className="input op-pop__search" type="search" placeholder="Search these items…" value={q}
              onChange={(e) => setQ(e.target.value)} aria-label="Search these items" />
            <div className="op-pop__tabs" role="group" aria-label={byArea ? 'Condition' : 'Area'}>
              <button type="button" className={!current ? 'op-on' : ''} onClick={() => setTab('')}>All <b>{base.length}</b></button>
              {tabs.map((t) => (
                <button key={t.key} type="button" className={current === t.key ? 'op-on' : ''} onClick={() => setTab(current === t.key ? '' : t.key)}>
                  {t.color && <i style={{ background: t.color }} />}{t.label} <b>{t.n}</b>
                </button>
              ))}
            </div>
          </div>

          <div className="op-pop__body">
            {list.length === 0 && <p className="op-pop__empty">No items match.</p>}
            <ul className="op-pop__list">
              {list.map((it, i) => {
                const s = statusOf(it.status);
                return (
                  <li key={it.row} style={{ '--i': Math.min(i, 12) }}>
                    <button type="button" className="op-pop__row" style={{ '--c': s.color }} onClick={() => onOpen(it)}>
                      <span className="op-pop__dot" aria-hidden="true" />
                      <span className="op-pop__main">
                        <span className="op-pop__name">
                          {it.name}
                          {it.changed && <span className="op-new">Changed</span>}
                        </span>
                        <span className="op-pop__meta">{[it.section, it.group, it.particular].filter(Boolean).join(' · ')}</span>
                        <span className="op-pop__latest">{it.latest || <em>No update yet</em>}</span>
                      </span>
                      <span className="op-pop__side">
                        {showPill && <span className="op-pill">{s.label}</span>}
                        <span className="op-pics">{it.pic.map((p) => <b key={p}>{p}</b>)}</span>
                        {it.latestLabel && <small>{it.latestLabel}</small>}
                      </span>
                      <span className="op-pop__chev" aria-hidden="true">›</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </dialog>
  );
}

function StatusLegend() {
  return (
    <div className="sb-chartlegend sb-statuslegend" aria-label="Condition colors">
      {STATUSES.filter((s) => s.key !== 'none').map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}
    </div>
  );
}

function ItemCard({ it, onOpen }) {
  const st = statusOf(it.status);
  return (
    <button type="button" className="op-item" style={{ '--c': st.color }} onClick={onOpen}>
      <div className="op-item__top">
        <span className="op-pill">{st.label}</span>
        {it.changed && <span className="op-new" title="Different from the previous update">Changed</span>}
      </div>
      <h4>{it.name}</h4>
      {it.particular && <p className="op-item__what">{it.particular}</p>}
      <div className="op-item__latest">
        {it.latest ? <span>{it.latest}</span> : <em>No update yet</em>}
      </div>
      <div className="op-item__foot">
        <span className="op-pics">{it.pic.map((p) => <b key={p}>{p}</b>)}</span>
        {it.latestLabel && <small>{it.latestLabel}</small>}
      </div>
    </button>
  );
}

// All updates of one item, newest first
function ItemDialog({ item, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const dlg = ref.current;
    if (item && !dlg.open) dlg.showModal();
    if (!item && dlg.open) dlg.close();
  }, [item]);
  const st = item && statusOf(item.status);
  const history = item ? [...item.history].reverse() : [];
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog ref={ref} className="sb-dialog" aria-labelledby="op-dialog-title" onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {item && (
        <>
          <div className="sb-dialog__head">
            <div>
              <h3 id="op-dialog-title">{item.name}</h3>
              <p>{[item.section, item.group, item.particular].filter(Boolean).join(' · ')}</p>
            </div>
            <button type="button" className="sb-dialog__close" onClick={onClose}>Close</button>
          </div>
          <div className="sb-dialog__legend">
            <b>Condition</b><span className="op-pill" style={{ '--c': st.color }}>{st.label}</span>
            <b>In charge</b><span className="op-pics">{item.pic.map((p) => <b key={p}>{p}</b>)}</span>
          </div>
          <div className="sb-dialog__body">
            <ol className="op-history">
              {history.map((h, i) => (
                <li key={h.label} className={i === 0 ? 'op-history__latest' : ''}>
                  <span className="op-history__when">{h.label}{i === 0 ? ' · latest' : ''}</span>
                  {h.text ? <p>{h.text}</p> : <p className="op-history__empty">No update</p>}
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
    </dialog>
  );
}
