import { PVMV_URL, STATEMENTS, VALUES } from './pvmvContent';

// Line icons (24×24, drawn with the text color); the four cards use the same symbols as mcu.edu.ph
const ICONS = {
  purpose: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01" />,
  vision: <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />,
  mission: <path d="M5 21V4M5 4h12l-2.5 4L17 12H5" />,
  values: <path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" />,
  Integrity: <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6zM9 12l2 2 4-4" />,
  Nurturing: <path d="M7 20h10M12 20v-8M12 12c0-4 3-6 7-6 0 4-3 6-7 6zM12 14c0-3-2.5-5-6-5 0 3 2.5 5 6 5z" />,
  Prudence: <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.9.7 1.5 1.6 1.5 2.6V17h4v-.5c0-1 .6-1.9 1.5-2.6A6 6 0 0 0 12 3z" />,
  Resilience: <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" />,
  Perseverance: <path d="m3 20 6-10 4 6 3-4 5 8zM15 4v6M15 4h4l-1 1.5 1 1.5h-4" />,
};
const Icon = ({ name }) => <svg className="pvmv-icon" viewBox="0 0 24 24" aria-hidden="true">{ICONS[name]}</svg>;

// Purpose, Vision, Mission and Values from mcu.edu.ph: four cards, Values listed as chips
export default function Purpose() {
  const cards = [...STATEMENTS, { id: 'values', label: 'Our Values' }];

  return (
    <div className="page about">
      <section className="about-hero about-hero--compact">
        <div className="about-hero__glow" aria-hidden="true" />
        <div className="about-hero__content">
          <div className="about-hero__eyebrow"><i />Manila Central University · Since 1904</div>
          <h1 className="about-hero__title">Purpose, Vision, Mission &amp; Values</h1>
        </div>
        <img className="about-hero__logo" src="/mcu-logo.png" alt="Manila Central University logo" />
      </section>

      <section className="pvmv-grid">
        {cards.map((c, i) => (
          <article key={c.id} className={`pvmv-card pvmv-card--${c.id}`}>
            <span className="pvmv-card__no" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
            <span className="pvmv-card__icon"><Icon name={c.id} /></span>
            <h2 className="pvmv-card__label">{c.label}</h2>
            {c.text ? (
              <p className="pvmv-card__text">{c.text}</p>
            ) : (
              <ul className="pvmv-values">
                {VALUES.map((v) => (
                  <li key={v}><Icon name={v} />{v}</li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </section>

      <p className="about-source">Source: <a href={PVMV_URL} target="_blank" rel="noreferrer">mcu.edu.ph/mcu-pvmv</a></p>
    </div>
  );
}
