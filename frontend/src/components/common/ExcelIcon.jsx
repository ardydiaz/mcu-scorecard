// Excel-style file icon (green sheet with an "X"), drawn inline so it needs no image file
export default function ExcelIcon({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path d="M14 4h20l10 10v28a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="#21a366" />
      <path d="M34 4l10 10h-8a2 2 0 0 1-2-2z" fill="#185c37" />
      <path d="M24 22h16M24 29h16M24 36h16M32 18v22" stroke="#fff" strokeOpacity="0.55" strokeWidth="1.6" />
      <rect x="2" y="15" width="22" height="22" rx="3" fill="#107c41" />
      <path d="M8 21l10 10M18 21L8 31" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
