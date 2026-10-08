import { useState } from 'react';
import { ERAS, TIMELINE } from './aboutMcuContent';

export const eraOf = (year) => ERAS.find((e) => year >= e.from && year <= e.to)?.id;
export const TIMELINE_SPAN = `${TIMELINE[0].year}–${TIMELINE.at(-1).year}`;

// One timeline photo; hidden when the image can't be loaded from mcu.edu.ph
function Photo({ src, year }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return <img className="about-tl__img" src={src} alt={`MCU in ${year}`} loading="lazy" onError={() => setFailed(true)} />;
}

// The University's milestones as an alternating vertical timeline; `era` = 'all' or an ERAS id
export default function HistoryTimeline({ era = 'all' }) {
  const items = era === 'all' ? TIMELINE : TIMELINE.filter((t) => eraOf(t.year) === era);
  return (
    <ol className="about-tl" key={era}>
      {items.map((t, i) => (
        <li key={t.year} className={`about-tl__item${i % 2 ? ' about-tl__item--right' : ''}${t.milestone ? ' about-tl__item--milestone' : ''}`}>
          <span className="about-tl__dot" aria-hidden="true" />
          <article className="about-tl__card">
            <span className="about-tl__year">{t.year}</span>
            <p>{t.text}</p>
            <Photo src={t.image} year={t.year} />
          </article>
        </li>
      ))}
    </ol>
  );
}
