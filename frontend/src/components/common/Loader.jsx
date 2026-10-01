// `fullScreen`: fills the window (sign-in). `center`: fills the rest of the page's content area,
// with a larger spinner in the middle (used while a sheet is read from Excel).
export default function Loader({ label = 'Loading…', fullScreen = false, center = false }) {
  const className = ['loader', fullScreen && 'loader--full', center && 'loader--center'].filter(Boolean).join(' ');
  return (
    <div className={className} role="status">
      <span className="loader__spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
