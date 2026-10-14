import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useWorkbooks } from './useStrategy';

const STORAGE_KEY = 'mcu-scorecard.workbook';

function readStored() {
  try { return localStorage.getItem(STORAGE_KEY) || ''; } catch { return ''; }
}

/**
 * The scorecard file a page shows: ?workbook= in the URL, else the file last chosen in this
 * browser, else '' (the server's default file). A choice that's no longer in the user's list
 * (unpublished or removed) falls back to the default, and is forgotten.
 * While the file list is still loading, `workbook` is null: pages wait (the data hooks skip a null
 * file), so they never ask for a file that no longer exists.
 */
export default function useSelectedWorkbook() {
  const [params] = useSearchParams();
  const workbooks = useWorkbooks();
  const fromUrl = params.get('workbook') || '';
  const list = workbooks.data || [];
  const chosen = fromUrl || readStored();
  const known = !chosen || list.some((w) => String(w.id) === chosen);

  // Unknown until the list has loaded (or failed to: then the server's default file is used)
  let workbook = null;
  if (workbooks.data) workbook = known ? chosen : '';
  else if (workbooks.error || !chosen) workbook = '';

  useEffect(() => {
    try {
      if (fromUrl && workbook === fromUrl) localStorage.setItem(STORAGE_KEY, fromUrl);
      // A remembered file that's gone (e.g. removed on the Workbooks page) isn't tried again
      if (workbooks.data && !known && readStored() === chosen) localStorage.removeItem(STORAGE_KEY);
    } catch { /* storage unavailable */ }
  }, [fromUrl, workbook, workbooks.data, known, chosen]);

  return { workbooks: list, workbook, error: workbooks.error };
}
