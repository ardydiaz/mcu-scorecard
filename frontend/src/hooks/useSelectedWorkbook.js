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
 * (unpublished or removed) falls back to the default.
 */
export default function useSelectedWorkbook() {
  const [params] = useSearchParams();
  const workbooks = useWorkbooks();
  const fromUrl = params.get('workbook') || '';
  const list = workbooks.data || [];

  let workbook = fromUrl || readStored();
  if (workbooks.data && workbook && !list.some((w) => String(w.id) === workbook)) workbook = '';

  useEffect(() => {
    if (fromUrl && workbook === fromUrl) {
      try { localStorage.setItem(STORAGE_KEY, fromUrl); } catch { /* storage unavailable */ }
    }
  }, [fromUrl, workbook]);

  return { workbooks: list, workbook, error: workbooks.error };
}
