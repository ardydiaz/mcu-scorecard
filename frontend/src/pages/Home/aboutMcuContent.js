// Content of the About MCU page, taken word for word from the University's official page
// https://mcu.edu.ph/mcu-history/ (update both together). Images are served by mcu.edu.ph.

export const SOURCE_URL = 'https://mcu.edu.ph/mcu-history/';
const IMG = (year) => `https://mcu.edu.ph/wp-content/uploads/2024/02/mile-${year}.png`;

export const INTRO = {
  title: 'The Tale of Passion and Partnership',
  text: 'Manila Central University takes pride in its long and rich history of Academic Excellence through the legacy of its founders, Filemon Tanchoco and Purificacion Gallego, who were both education pioneers that gave flesh to a vision through professionalism and camaraderie.',
};

// Highlights shown under the introduction (each is a milestone from the timeline below)
export const HIGHLIGHTS = [
  { value: '1904', label: 'Escuela de Farmacia del Liceo de Manila' },
  { value: '1948', label: 'University status: Manila Central University' },
  { value: '1949', label: 'Nearly 10-hectare campus in Caloocan' },
  { value: '2004', label: 'Centennial: 100 years of commitment' },
];

export const ERAS = [
  { id: 'beginnings', label: 'Beginnings', from: 1903, to: 1940 },
  { id: 'rebirth', label: 'War & Rebirth', from: 1941, to: 1948 },
  { id: 'growth', label: 'Growth', from: 1949, to: 1999 },
  { id: 'century', label: 'A New Century', from: 2000, to: 2100 },
];

export const TIMELINE = [
  { year: 1903, text: 'A private review class for pharmacy students was institutionalized as the Escuela de Farmacia del Liceo de Manila, the first school of Pharmacy run by Filipinos, in 1904 with Dr. Alejandro Albert as Founder and Director.' },
  { year: 1904, text: 'The success of the review resulted in more students wanting to join the sessions and this brought about the establishment of Escuela de Farmacia del Liceo de Manila, the first private institution operated by Filipinos in the country.', image: IMG(1904) },
  { year: 1908, text: 'The Escuela produced its first batch of graduates—Filomena Francisco-Guerrero and Matilde Arquiza-Arroyo, the first Filipino women pharmacists.', image: IMG(1908) },
  { year: 1910, text: 'Atty. Filemon D. Tanchoco was invited to join the institution as teacher and administrator.' },
  { year: 1915, text: 'Manila College of Pharmacy was born with enrollment increases leading to acquisition of new site at Oroquieta and Fugoso Streets in Zurbaran, Manila.', image: IMG(1915) },
  { year: 1917, text: 'The school was authorized to confer post-graduate and doctoral degrees in Pharmacy.' },
  { year: 1918, text: 'The Pharmacy profession reached new heights with around 1,000 registered drugstores in the country.', image: IMG(1918) },
  { year: 1920, text: 'Philippine Pharmaceutical Association was established.', image: IMG(1920) },
  { year: 1925, text: 'The chemistry, botany and pharmacology laboratories were enhanced with major shipments of equipment and chemicals.', image: IMG(1925) },
  { year: 1926, text: 'An increasing enrollment led to the purchase of a lot and construction of a new building at Mayhaligue and Felix Huertas in Manila.', image: IMG(1926) },
  { year: 1929, text: 'The College of Dentistry was founded and the institution was named as Manila College of Pharmacy and Dentistry. Dr. Jose Francisco as first dean.', image: IMG(1929) },
  { year: 1936, text: 'The College started developing competencies in mineral analysis with the creation of the mineral assaying department.', image: IMG(1936) },
  { year: 1938, text: 'The College offered secondary education through the Albert High School and started making laundry soap and medicated soap.', image: IMG(1938) },
  { year: 1940, text: 'High school classes started at the three-story building in Mayhaligue.' },
  { year: 1941, text: 'The College operated remarkably until war shut it down. The school was ravaged during the Japanese occupation to a point where only the bare structure of its buildings remained.' },
  { year: 1945, text: 'Mustering their savings and energy, he and his wife, Mrs. Purificacion Gallego-Tanchoco, reopen the school with a new wing — the College of Liberal Arts, With Dr. Alfredo Guerrero as Dean, it was renamed the Manila College of Pharmacy and Liberal Arts', image: IMG(1945) },
  { year: 1946, text: "The school's Board of Trustees reorganized. Atty. Tanchoco became the chairman and the school was renamed Manila Central Colleges.", image: IMG(1946) },
  { year: 1947, text: 'The College of Medicine opened. The College of Nursing opened after the Bureau of Private Schools grants MCC permit for a four-year course. The Graduate School in Business Administration was established. Mrs. Tanchoco led the construction of the MCU Hospital and acquisition of advanced equipment.', image: IMG(1947) },
  { year: 1948, text: 'With a diversity of courses, Manila Central Colleges was granted with a university status, thus becoming Manila Central University. Atty. Tanchoco became the first MCU President.', image: IMG(1948), milestone: true },
  { year: 1949, text: "MCU inaugurated its nearly 10-hectare campus in Caloocan. Expansion and development projects for the colleges continued to meet the educational demands of the time. MCU Hospital, Nurses' Home, gymnasium and auditorium were constructed there as well.", image: IMG(1949) },
  { year: 1951, text: 'The College of Nursing was authorized to offer the full four-year nursing course.', image: IMG(1951) },
  { year: 1953, text: 'The Graduate Pharmacy building was built housing Industrial Pharmacy and Research Laboratory.', image: IMG(1953) },
  { year: 1954, text: "MCU's Industrial Pharmacy and Research Laboratory was featured on the cover and editorial of the July 1954 issue of the American Journal of Pharmacy as well as in the August 1954 issue of the Pharmacy International." },
  { year: 1955, text: 'The School of Midwifery was established.' },
  { year: 1959, text: 'The College of Optometry opened.', image: IMG(1959) },
  { year: 1960, text: 'Medical Technology, Midwifery, Kindergarten, and Grade and High School levels were opened.' },
  { year: 1963, text: 'Atty. Filemon Tanchoco passed away.' },
  { year: 1964, text: "Purificacion Gallego-Tanchoco became MCU's second president.", image: IMG(1964) },
  { year: 1966, text: 'The Graduate Education Division offered masteral studies in Education.' },
  { year: 1970, text: 'Dr. Filemon G. Tanchoco Jr., MCU Executive Vice President and Comptroller, organized the Project Lingap sa Nayon (LINA) of the World University Service, Philippines.' },
  { year: 1971, text: 'The MCU Hospital and the College of Medicine were converted into the Filemon Dionisio Tanchoco Medical Foundation (FDTMF).' },
  { year: 1974, text: 'The Out-patient Department and Emergency, medical auditorium, and an audiovisual room were added to the hospital.' },
  { year: 1977, text: 'Renato G. Tanchoco was tapped to take on the role of MCU Vice President and Treasurer.' },
  { year: 1984, text: 'The MCU Medical Alumni Foundation USA was organized.' },
  { year: 1985, text: 'The MCU Bagong Silang Health Center started.' },
  { year: 1986, text: "The Formal Committee on Research was created to coordinate all scientific researches of the College of Medicine and to publish the College's Philippine Scientific Journal." },
  { year: 1992, text: 'The College of Medicine adopted a competency-based curriculum. College of Physical Therapy began.' },
  { year: 1993, text: 'A Research Unit was organized in the College of Medicine.' },
  { year: 1994, text: "Dr. Lualhati Tanchoco Gonzalez continued her parents' legacy and spearheaded MCU's growth." },
  { year: 1996, text: 'All the colleges, departments and facilities moved to the Caloocan campus.' },
  { year: 2003, text: 'The Department of Computer Studies was established. MCU was granted a deregulated status by the Commission on Higher Education with the privilege to prescribe curricular programs to achieve global competence.' },
  { year: 2004, text: 'Marked the centennial anniversary of MCU celebrating the "100 Years of Commitment to the Filipino Through Excellence in Education."', milestone: true },
  { year: 2009, text: "Dr. Aristotle T. Malabanan was appointed as the fourth president of MCU and coincided with the institution's 105th anniversary." },
  { year: 2012, text: "The university's Internet Laboratory was centralized at the LRC." },
  { year: 2015, text: 'A review of the MCU Vision, Mission, Institutional Philosophy and Values was conducted.' },
  { year: 2017, text: 'The MCU Board of Trustees led by Chairperson, Mrs. Luningning T. Estanislao, approved the revisions as recommended by MCU President, Dr. Aristotle T. Malabanan.' },
  { year: 2018, text: 'The MCU Board of Trustees elected Mrs. Luningning T. Estanislao as President of MCU. She holds the positions of President and Chief Operating Officer of MCU concurrent with her position as Chairman of the Board and Chief Executive Officer.' },
];

export const CLOSING = {
  title: 'The Ceaseless Quest for Relevance',
  text: 'Revisiting the MCU Vision in a New Century MCU probes its heritage for clues on how to plug gaps in Philippine education. Age-old truths resurface. Universities must not simply enable the acquisition of knowledge and skills—they must also build character, discipline and a higher sense of national purpose among the youth.',
  cta: 'We proudly welcome you to join our growing Centralino Community.',
};
