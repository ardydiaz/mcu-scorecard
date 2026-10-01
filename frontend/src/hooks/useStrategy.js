import { useCallback, useEffect, useState } from 'react';
import { getScorecard, getSheetGrid, getSheets, getStrategyMap, getWorkbook, getWorkbooks } from '../api/strategyApi';
import { getErrorMessage } from '../api/axios';

// Runs `load` whenever its dependencies change; `reload(true)` bypasses the server cache
function useAsync(load, deps) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [forceRefresh, setForceRefresh] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    load(forceRefresh)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((err) => { if (!cancelled) setError(getErrorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, refreshKey]);

  const reload = useCallback((refresh = false) => {
    setForceRefresh(refresh);
    setRefreshKey((k) => k + 1);
  }, []);

  return { data, loading, error, reload };
}

// `workbook` everywhere below is the scorecard file's id ('' = the default file)

export function useWorkbooks() {
  return useAsync(() => getWorkbooks(), []);
}

export function useScorecardSheets({ workbook } = {}) {
  return useAsync(() => getSheets({ workbook }), [workbook]);
}

export function useAllSheets({ workbook } = {}) {
  return useAsync(() => getSheets({ workbook, all: true }), [workbook]);
}

export function useWorkbook({ workbook } = {}) {
  return useAsync(() => getWorkbook({ workbook }), [workbook]);
}

export function useScorecard({ workbook, sheet, department }) {
  return useAsync((refresh) => getScorecard({ workbook, sheet, department, refresh }), [workbook, sheet, department]);
}

export function useSheetGrid({ workbook, sheet, department }) {
  return useAsync(
    (refresh) => (sheet ? getSheetGrid({ workbook, sheet, department, refresh }) : Promise.resolve(null)),
    [workbook, sheet, department]
  );
}

export function useStrategyMap({ workbook, sheet }) {
  return useAsync(() => getStrategyMap({ workbook, sheet }), [workbook, sheet]);
}
