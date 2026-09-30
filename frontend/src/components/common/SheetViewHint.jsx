import useAuth from '../../hooks/useAuth';

// Excel links can't apply a filter, so each department has a saved Sheet View
// (Lead contains <code>) in the workbook. This tells the user which one to pick.
export default function SheetViewHint() {
  const { user } = useAuth();
  const code = user?.department || user?.departments?.[0]?.code;

  if (user?.role === 'admin') {
    return (
      <p className="sheet-view-hint">
        In Excel, use <strong>View → Sheet View</strong> to switch to a department's view, or <strong>Default</strong> for all rows.
      </p>
    );
  }
  if (!code) return null;
  return (
    <p className="sheet-view-hint">
      To see only your rows, in Excel go to <strong>View → Sheet View</strong> and choose <strong>{code}</strong>.
    </p>
  );
}
