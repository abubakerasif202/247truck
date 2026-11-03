import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { SiteShell } from "../site-components";
import { PHONE_DISPLAY, PHONE_HREF, SITE_URL } from "../site-data";
import styles from "../workshop-updates.module.css";

export const metadata: Metadata = {
  title: "Mechanic Jobs, Internships & Job Ready Program Opportunities",
  description:
    "24/7 Truck Tyre Services in Regency Park, Adelaide is hiring experienced mechanics and welcomes enquiries from students seeking internships or Job Ready Program workshop experience.",
  alternates: { canonical: `${SITE_URL}/careers` },
  openGraph: {
    title: "Careers & Student Opportunities | 24/7 Truck Tyre Services",
    description: "Experienced mechanic hiring, student internships and Job Ready Program enquiries at our Adelaide workshop.",
    url: `${SITE_URL}/careers`,
  },
};

const messageLink = (subject: string) =>
  `https://wa.me/61452636802?text=${encodeURIComponent(
    `Hello 24/7 Truck Tyre Services, I am interested in ${subject}. My name is: [name]. My experience or course is: [details]. Please let me know how to apply.`
  )}`;

const opportunities = [
  {
    number: "01",
    title: "Experienced Mechanics",
    body: "We are hiring experienced mechanics who are confident working with automotive and/or heavy commercial vehicles. If you take pride in practical, dependable repair work, we would like to hear from you.",
    points: ["Automotive or truck mechanical experience", "Repair, servicing and fault-finding skills", "A practical approach to workshop safety and teamwork"],
    action: "Enquire about mechanic jobs",
    subject: "an experienced mechanic position",
  },
  {
    number: "02",
    title: "Student Internships",
    body: "Starting a career in automotive technology? We welcome enquiries from students who want to learn in a working automotive and truck repair environment through an internship opportunity.",
    points: ["Exposure to day-to-day workshop work", "Opportunities to develop practical skills", "Enquire about suitable student placements"],
    action: "Ask about internships",
    subject: "a student internship",
  },
  {
    number: "03",
    title: "Job Ready Program",
    body: "We also welcome enquiries from students undertaking a Job Ready Program who are looking for relevant workshop experience and a chance to discuss possible practical training opportunities.",
    points: ["Discuss your course and current program stage", "Ask about practical workshop experience", "Check placement requirements and availability"],
    action: "Ask about Job Ready support",
    subject: "Job Ready Program workshop experience",
  },
];

export default function CareersPage() {
  return (
    <SiteShell>
      <section className={styles.careersHero} aria-labelledby="careers-heading">
        <div className={styles.careersHeroMedia}>
          <Image
            src="/images/pack-09-workshop-team.webp"
            alt="Commercial vehicle technicians in an Adelaide workshop"
            fill
            priority
            sizes="100vw"
          />
        </div>
        <div className={styles.careersHeroContent}>
          <p className={styles.eyebrow}>Join our Regency Park workshop</p>
          <h1 id="careers-heading">WE ARE <span>HIRING.</span></h1>
          <p>
            Build your future with 24/7 Truck Tyre Services. We are looking for experienced
            mechanics and opening conversations with students seeking internships or Job
            Ready Program workshop experience.
          </p>
          <div className={styles.careersHeroActions}>
            <Link className={styles.primaryButton} href="#opportunities">View opportunities ↗</Link>
            <a className={styles.ghostButton} href={PHONE_HREF}>Call {PHONE_DISPLAY}</a>
          </div>
        </div>
      </section>

      <section className={styles.careersMain} id="opportunities" aria-labelledby="opportunities-heading">
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>Work · Learn · Grow</p>
          <h2 id="opportunities-heading">OPPORTUNITIES IN OUR WORKSHOP</h2>
          <p>
            Whether you already have hands-on mechanical experience or are starting out,
            contact our Adelaide team to discuss the right opportunity.
          </p>
        </div>
        <div className={styles.careersGrid}>
          {opportunities.map((opportunity) => (
            <article className={styles.careerCard} key={opportunity.number}>
              <span className={styles.careerNumber}>{opportunity.number} / 03</span>
              <h3>{opportunity.title}</h3>
              <p>{opportunity.body}</p>
              <ul>{opportunity.points.map((point) => <li key={point}>{point}</li>)}</ul>
              <a href={messageLink(opportunity.subject)} target="_blank" rel="noopener noreferrer">
                {opportunity.action} <span aria-hidden="true">↗</span>
              </a>
            </article>
          ))}
        </div>
        <p className={styles.careersNote}>
          <strong>For students:</strong> Internship and Job Ready Program opportunities are
          subject to workshop capacity, suitability and any applicable program rules.
          Contact us before making arrangements. Students are responsible for confirming
          their eligibility and documentation requirements with their education or
          skills-assessment provider.
        </p>
      </section>

      <section className={styles.applyPanel} aria-labelledby="apply-heading">
        <div>
          <p className={styles.eyebrow}>Your next step</p>
          <h2 id="apply-heading">TELL US ABOUT YOUR EXPERIENCE.</h2>
          <p>
            Send your name, contact details, trade experience or current course, and the
            opportunity you are interested in. We can discuss whether there is a suitable
            opening or student placement.
          </p>
        </div>
        <a className={styles.applyLink} href={messageLink("workshop employment or student opportunities")} target="_blank" rel="noopener noreferrer">
          Contact us on WhatsApp ↗
        </a>
      </section>
    </SiteShell>
  );
}
