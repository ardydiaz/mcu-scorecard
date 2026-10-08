import { useState } from 'react';
import { CLOSING, ERAS, SOURCE_URL, TIMELINE } from './aboutMcuContent';
import HistoryTimeline, { TIMELINE_SPAN, eraOf } from './HistoryTimeline';

const CURRENT_YEAR = new Date().getFullYear();
const range = (e) => `${e.from} – ${e.to >= CURRENT_YEAR ? 'present' : e.to}`;
const countIn = (id) => TIMELINE.filter((t) => eraOf(t.year) === id).length;

// History: the University's timeline from mcu.edu.ph, read era by era
export default function History() {
  const [era, setEra] = useState('all');
  const chapters = [{ id: 'all', label: 'All years', years: TIMELINE_SPAN, count: TIMELINE.length },
    ...ERAS.map((e) => ({ id: e.id, label: e.label, years: range(e), count: countIn(e.id) }))];

  return (
    <div className="page about">
      <section className="about-hero about-hero--compact">
        <div className="about-hero__glow" aria-hidden="true" />
        <div className="about-hero__content">
          <div className="about-hero__eyebrow"><i />Manila Central University · Since 1904</div>
          <h1 className="about-hero__title">History</h1>
          <p className="about-hero__lead">A Century of Heritage, {TIMELINE_SPAN}</p>
        </div>
        <img className="about-hero__logo" src="/mcu-logo.png" alt="Manila Central University logo" />
      </section>

      <section className="hist-chapters" role="group" aria-label="Show an era">
        {chapters.map((c, i) => (
          <button key={c.id} type="button" className="hist-chapter" aria-pressed={era === c.id} onClick={() => setEra(c.id)}>
            <span className="hist-chapter__no">{i === 0 ? '★' : String(i).padStart(2, '0')}</span>
            <b>{c.label}</b>
            <span className="hist-chapter__years">{c.years}</span>
            <span className="hist-chapter__count">{c.count} milestones</span>
          </button>
        ))}
      </section>

      <section className="about-section">
        <HistoryTimeline era={era} />
      </section>

      <section className="about-closing">
        <div>
          <div className="about-kicker about-kicker--light">Looking ahead</div>
          <h2>{CLOSING.title}</h2>
          <p>{CLOSING.text}</p>
          <p className="about-closing__cta">{CLOSING.cta}</p>
        </div>
        <a className="btn btn--primary about-closing__btn" href={SOURCE_URL} target="_blank" rel="noreferrer">
          Read the full story on mcu.edu.ph
        </a>
      </section>

      <p className="about-source">Source: <a href={SOURCE_URL} target="_blank" rel="noreferrer">mcu.edu.ph/mcu-history</a> · Photos © Manila Central University</p>
    </div>
  );
}
