import { useCallback, useEffect, useState } from 'react';
import { getScorecard, getSheetGrid, getSheets, getStrategyMap, getWorkbook } from '../api/strategyApi';
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

export function useScorecardSheets() {
  return useAsync(() => getSheets(), []);
}

export function useAllSheets() {
  return useAsync(() => getSheets({ all: true }), []);
}

export function useWorkbook() {
  return useAsync(() => getWorkbook(), []);
}

export function useScorecard({ sheet, department }) {
  return useAsync((refresh) => getScorecard({ sheet, department, refresh }), [sheet, department]);
}

export function useSheetGrid({ sheet, department }) {
  return useAsync(
    (refresh) => (sheet ? getSheetGrid({ sheet, department, refresh }) : Promise.resolve(null)),
    [sheet, department]
  );
}

export function useStrategyMap({ sheet }) {
  return useAsync(() => getStrategyMap({ sheet }), [sheet]);
}
