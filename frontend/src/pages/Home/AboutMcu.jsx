import { useState } from 'react';
import { CLOSING, ERAS, HIGHLIGHTS, INTRO, SOURCE_URL } from './aboutMcuContent';
import HistoryTimeline, { TIMELINE_SPAN } from './HistoryTimeline';

// About MCU: the University's history from mcu.edu.ph, as a hero, highlights and an era-filtered timeline
export default function AboutMcu() {
  const [era, setEra] = useState('all');

  return (
    <div className="page about">
      <section className="about-hero">
        <div className="about-hero__glow" aria-hidden="true" />
        <div className="about-hero__content">
          <div className="about-hero__eyebrow"><i />Manila Central University · Since 1904</div>
          <h1 className="about-hero__title">{INTRO.title}</h1>
          <blockquote className="about-hero__quote">{INTRO.text}</blockquote>
          <div className="about-hero__founders">
            <span>Filemon Tanchoco</span>
            <span className="about-hero__amp">&amp;</span>
            <span>Purificacion Gallego</span>
          </div>
        </div>
        <img className="about-hero__logo" src="/mcu-logo.png" alt="Manila Central University logo" />
      </section>

      <section className="about-highlights" aria-label="Milestones">
        {HIGHLIGHTS.map((h) => (
          <div key={h.value} className="about-highlight">
            <b>{h.value}</b>
            <span>{h.label}</span>
          </div>
        ))}
      </section>

      <section className="about-section">
        <div className="about-section__head">
          <div>
            <div className="about-kicker">A Century of Heritage</div>
            <h2>Our journey, {TIMELINE_SPAN}</h2>
          </div>
          <div className="about-eras" role="group" aria-label="Show an era">
            <button type="button" aria-pressed={era === 'all'} onClick={() => setEra('all')}>All years</button>
            {ERAS.map((e) => (
              <button key={e.id} type="button" aria-pressed={era === e.id} onClick={() => setEra(e.id)}>
                {e.label}
              </button>
            ))}
          </div>
        </div>

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
