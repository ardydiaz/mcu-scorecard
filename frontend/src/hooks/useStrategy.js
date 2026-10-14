import { useCallback, useEffect, useState } from 'react';
import { getScoreboard, getSheetGrid, getSheets, getStrategyMap, getWorkbook, getWorkbooks } from '../api/strategyApi';
import { getErrorMessage } from '../api/axios';

// Runs `load` whenever its dependencies change; `reload(true)` bypasses the server cache.
// Results are tagged with the dependencies they were loaded for: right after they change (e.g.
// another file is picked) the old result isn't returned, so pages never combine the new file
// with the previous file's sheet list.
// `wait`: nothing is loaded yet and the result stays "loading" (e.g. until the file to read is known).
function useAsync(load, deps, { wait = false } = {}) {
  const key = JSON.stringify(deps);
  const [result, setResult] = useState({ key: null, data: null, error: '' });
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [forceRefresh, setForceRefresh] = useState(false);

  useEffect(() => {
    if (wait) { setLoading(true); return undefined; }
    let cancelled = false;
    setLoading(true);
    setResult((r) => (r.error ? { ...r, error: '' } : r)); // a reload starts without the old error
    load(forceRefresh)
      .then((data) => { if (!cancelled) setResult({ key, data, error: '' }); })
      .catch((err) => { if (!cancelled) setResult({ key, data: null, error: getErrorMessage(err) }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshKey, wait]);

  const reload = useCallback((refresh = false) => {
    setForceRefresh(refresh);
    setRefreshKey((k) => k + 1);
  }, []);

  const current = result.key === key;
  return {
    data: current ? result.data : null,
    loading: loading || !current,
    error: current ? result.error : '',
    reload,
  };
}

// `workbook` everywhere below is the scorecard file's id ('' = the default file, null = not known
// yet: the hook waits instead of loading, see useSelectedWorkbook)
const pending = (workbook) => ({ wait: workbook === null });

const WORKBOOKS_POLL_MS = 15 * 1000;

// Files for the picker, kept up to date while the page is open: re-read every 15 s and when the
// tab becomes visible again, so a file an admin publishes, hides or makes default shows up
// without reloading. The list only changes (re-renders) when the files actually changed.
export function useWorkbooks() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let last = '';
    const load = () => getWorkbooks()
      .then((list) => {
        if (cancelled) return;
        const json = JSON.stringify(list);
        if (json !== last) { last = json; setData(list); }
        setError('');
      })
      .catch((err) => { if (!cancelled && !last) setError(getErrorMessage(err)); }) // keep the last list on a failed poll
      .finally(() => { if (!cancelled) setLoading(false); });

    load();
    const timer = setInterval(() => { if (!document.hidden) load(); }, WORKBOOKS_POLL_MS);
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return { data, loading, error };
}

export function useScorecardSheets({ workbook } = {}) {
  return useAsync(() => getSheets({ workbook }), [workbook], pending(workbook));
}

export function useAllSheets({ workbook } = {}) {
  return useAsync(() => getSheets({ workbook, all: true }), [workbook], pending(workbook));
}

export function useWorkbook({ workbook } = {}) {
  return useAsync(() => getWorkbook({ workbook }), [workbook], pending(workbook));
}

export function useSheetGrid({ workbook, sheet, department }) {
  return useAsync(
    (refresh) => (sheet ? getSheetGrid({ workbook, sheet, department, refresh }) : Promise.resolve(null)),
    [workbook, sheet, department],
    pending(workbook)
  );
}

export function useScoreboard({ workbook, sheet, department }) {
  return useAsync((refresh) => getScoreboard({ workbook, sheet, department, refresh }), [workbook, sheet, department], pending(workbook));
}

// Summary counts for the rows the user may see; no request while `sheet` is empty
export function useStrategyMap({ workbook, sheet, department }) {
  return useAsync(
    (refresh) => (sheet ? getStrategyMap({ workbook, sheet, department, refresh }) : Promise.resolve(null)),
    [workbook, sheet, department],
    pending(workbook)
  );
}
