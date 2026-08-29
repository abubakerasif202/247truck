"use client";

import Link from "next/link";
import Image from "next/image";
import { FormEvent, ReactNode, useEffect, useState } from "react";
import {
  detailPages,
  faqItems,
  navItems,
  PHONE_DISPLAY,
  PHONE_HREF,
  services,
  type DetailPage,
} from "./site-data";

function Logo({ compact = false, white = false }: { compact?: boolean; white?: boolean }) {
  return (
    <Link className={`brand-logo${compact ? " brand-logo--compact" : ""}`} href="/" aria-label="24/7 Truck Tyre Services home">
      <Image src={white ? "/brand/logo-real-white.png" : "/brand/logo-real-horizontal.png"} alt="24/7 Truck Tyre Services" width={2172} height={724} priority unoptimized />
    </Link>
  );
}

function Header() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const update = () => {
      setIsMobile(query.matches);
      if (!query.matches) setOpen(false);
    };
    const initial = window.setTimeout(update, 0);
    query.addEventListener("change", update);
    return () => { window.clearTimeout(initial); query.removeEventListener("change", update); };
  }, []);

  useEffect(() => {
    document.body.classList.toggle("menu-open", open);
    return () => document.body.classList.remove("menu-open");
  }, [open]);

  return (
    <header className={`site-header${scrolled ? " is-scrolled" : ""}`}>
      <div className="header-inner">
        <Logo compact />
        <nav className={`main-nav${open ? " is-open" : ""}`} aria-label="Primary navigation" aria-hidden={isMobile && !open} inert={isMobile && !open ? true : undefined}>
          {navItems.map(([label, href]) => (
            <Link key={href} href={href} onClick={() => setOpen(false)}>{label}</Link>
          ))}
        </nav>
        <div className="header-actions">
          <a className="header-call" href={PHONE_HREF}><span>Call</span> {PHONE_DISPLAY}</a>
          <button className="menu-toggle" type="button" aria-label="Toggle navigation" aria-expanded={open} onClick={() => setOpen(!open)}>
            <span /><span />
          </button>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-grid">
        <div className="footer-brand">
          <Logo white />
          <p>Truck tyre supply, fitting and commercial tyre support across Adelaide.</p>
          <p>Regency Park, South Australia</p>
          <a className="footer-phone" href={PHONE_HREF}>{PHONE_DISPLAY}</a>
        </div>
        <div>
          <h2>Quick links</h2>
          <Link href="/">Home</Link>
          <Link href="/services">Services</Link>
          <Link href="/about">About</Link>
          <Link href="/#service-areas">Service Areas</Link>
          <Link href="/contact">Contact</Link>
        </div>
        <div>
          <h2>Services</h2>
          <Link href="/24-7-truck-tyre-assistance">Emergency Assistance</Link>
          <Link href="/truck-tyre-fitting">Truck Tyre Fitting</Link>
          <Link href="/truck-tyres">Truck Tyre Supply</Link>
          <Link href="/fleet-tyre-services">Fleet Support</Link>
          <h2 className="footer-subhead">Leadership</h2>
          <p>Director</p>
        </div>
        <div className="footer-emergency">
          <span>Available 24/7</span>
          <h2>Truck tyre trouble?</h2>
          <a className="button button--red" href={PHONE_HREF}>Call now <span aria-hidden="true">↗</span></a>
        </div>
      </div>
      <div className="footer-bottom">
        <p>© {new Date().getFullYear()} 24/7 Truck Tyre Services</p>
        <p>Regency Park · Adelaide, South Australia</p>
      </div>
    </footer>
  );
}

function MobileActions() {
  return (
    <div className="mobile-actions" aria-label="Quick contact actions">
      <a href={PHONE_HREF}>Call now</a>
      <Link href="/contact">Get help</Link>
    </div>
  );
}

function Intro() {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const seen = sessionStorage.getItem("247tts-intro-seen");
    if (reduced || seen) return;
    const show = window.setTimeout(() => setVisible(true), 0);
    const finish = window.setTimeout(() => {
      setLeaving(true);
      sessionStorage.setItem("247tts-intro-seen", "1");
    }, 3000);
    const remove = window.setTimeout(() => setVisible(false), 3600);
    return () => { window.clearTimeout(show); window.clearTimeout(finish); window.clearTimeout(remove); };
  }, []);

  const skip = () => {
    setLeaving(true);
    sessionStorage.setItem("247tts-intro-seen", "1");
    window.setTimeout(() => setVisible(false), 450);
  };

  if (!visible) return null;
  return (
    <div className={`site-intro${leaving ? " is-leaving" : ""}`} role="dialog" aria-modal="true" aria-label="24/7 Truck Tyre Services introduction" onKeyDown={(event) => { if (event.key === "Tab") event.preventDefault(); if (event.key === "Escape") skip(); }}>
      <div className="intro-glow" />
      <div className="intro-wheel" aria-hidden="true"><div className="intro-rim" /></div>
      <Image className="intro-logo intro-logo--stacked" src="/brand/logo-real-stacked.png" alt="24/7 Truck Tyre Services" width={1254} height={1254} priority unoptimized />
      <div className="intro-sweep" aria-hidden="true" />
      <button type="button" onClick={skip} autoFocus>Skip <span aria-hidden="true">→</span></button>
    </div>
  );
}

function SiteShell({ children, intro = false }: { children: ReactNode; intro?: boolean }) {
  return (
    <>
      {intro && <Intro />}
      <Header />
      <main>{children}</main>
      <Footer />
      <MobileActions />
    </>
  );
}

function SectionHeading({ eyebrow, title, intro, dark = false }: { eyebrow: string; title: string; intro?: string; dark?: boolean }) {
  return (
    <div className={`section-heading${dark ? " section-heading--dark" : ""}`}>
      <p className="eyebrow"><span />{eyebrow}</p>
      <h2>{title}</h2>
      {intro && <p className="section-intro">{intro}</p>}
    </div>
  );
}

function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-image" aria-hidden="true" />
      <div className="hero-grid" aria-hidden="true" />
      <div className="hero-copy">
        <p className="eyebrow"><span />Adelaide truck tyre specialists</p>
        <h1 id="hero-title">24/7 emergency <span>truck tyre services</span></h1>
        <p className="hero-intro">Fast roadside tyre assistance, truck tyre fitting, tyre replacement and fleet support across Adelaide.</p>
        <div className="hero-buttons">
          <a className="button button--red button--phone" href={PHONE_HREF}><small>Call now</small>{PHONE_DISPLAY}</a>
          <Link className="button button--ghost" href="/contact">Get tyre assistance <span aria-hidden="true">→</span></Link>
        </div>
      </div>
      <div className="hero-status">
        <span className="live-dot" />
        <div><small>24/7 emergency service</small><a href={PHONE_HREF}>{PHONE_DISPLAY}</a></div>
      </div>
      <div className="hero-rail"><span>Regency Park · South Australia</span><i /></div>
    </section>
  );
}

function TrustStrip() {
  const items = ["24/7 service", "Truck tyre specialists", "Fast response", "Fleet support", "Competitive pricing", "Adelaide service"];
  return <div className="trust-strip" aria-label="Service highlights"><div>{items.concat(items).map((item, index) => <span key={`${item}-${index}`}><i />{item}</span>)}</div></div>;
}

function ServicesSection({ limit }: { limit?: number }) {
  const visible = limit ? services.slice(0, limit) : services;
  return (
    <section className="section services-section" id="services">
      <div className="section-topline"><SectionHeading eyebrow="Our services" title="Complete tyre solutions" intro="Roadside, workshop and fleet tyre support built around the demands of working heavy vehicles." /><Link className="text-link" href="/services">View all services <span>↗</span></Link></div>
      <div className="service-grid">
        {visible.map((service) => (
          <Link className="service-card" href={service.href} key={`${service.number}-${service.title}`}>
            <span className="service-number">{service.number}</span>
            <div className="service-icon" aria-hidden="true"><span /></div>
            <h3>{service.title}</h3>
            <p>{service.description}</p>
            <span className="card-link">Explore service <i>↗</i></span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function EmergencyBand() {
  return (
    <section className="emergency-band">
      <div className="emergency-image" aria-hidden="true" />
      <div className="emergency-content">
        <div className="phone-pulse" aria-hidden="true"><span>☎</span></div>
        <p className="eyebrow"><span />Emergency tyre assistance</p>
        <h2>Broken down?<br /><strong>We&apos;re ready 24/7.</strong></h2>
        <p>Truck tyre trouble can stop your entire operation. Call our team for fast tyre assistance across Adelaide.</p>
        <a className="button button--white" href={PHONE_HREF}>Call {PHONE_DISPLAY} <span aria-hidden="true">↗</span></a>
      </div>
    </section>
  );
}

function WhyUs() {
  const reasons = ["Premium quality truck tyres", "Fast & reliable service", "Expert professional support", "Competitive pricing", "24/7 availability", "Commercial vehicle experience"];
  return (
    <section className="section why-section">
      <SectionHeading eyebrow="Why choose us" title="Reliable. Fast. Professional." intro="We understand tyre issues can stop your business. That’s why the focus is on fast, practical and dependable truck tyre support." />
      <div className="why-layout">
        <div className="why-wheel" aria-hidden="true"><span>24/7</span></div>
        <ol>{reasons.map((reason, index) => <li key={reason}><span>{String(index + 1).padStart(2, "0")}</span><h3>{reason}</h3><i>↗</i></li>)}</ol>
      </div>
    </section>
  );
}

const serviceAreas = ["Regency Park", "Adelaide", "Wingfield", "Gillman", "Port Adelaide", "Outer Adelaide Areas"];

function ServiceAreas() {
  return (
    <section className="service-areas" id="service-areas">
      <div className="area-map" aria-hidden="true"><div className="sa-shape"><span>ADL</span><i /></div><p>South Australia<br /><strong>Adelaide response zone</strong></p></div>
      <div className="area-content">
        <SectionHeading dark eyebrow="Where we operate" title="Adelaide, covered." intro="We provide truck tyre services across Adelaide and surrounding industrial and transport areas." />
        <div className="area-grid">{serviceAreas.map((area, index) => <div key={area}><span>{String(index + 1).padStart(2, "0")}</span><strong>{area}</strong></div>)}</div>
        <a className="button button--red" href="#contact">View service areas <span>↗</span></a>
      </div>
    </section>
  );
}

const testimonialExamples = [
  "Fast, clear communication when a truck tyre issue interrupted the run. The response process was straightforward.",
  "Dependable commercial tyre support and practical advice for keeping fleet vehicles moving.",
  "Professional service from the first call, with the tyre requirement explained clearly.",
];

function Testimonials() {
  return (
    <section className="testimonials-section">
      <SectionHeading eyebrow="What our clients say" title="Trusted by drivers & fleets" intro="Editable testimonial examples — replace with verified customer reviews before publication." />
      <div className="testimonial-grid">{testimonialExamples.map((quote, index) => <article key={quote}><div className="stars" aria-label="Five stars">★★★★★</div><blockquote>“{quote}”</blockquote><footer><span>Customer review placeholder</span><small>Editable example {index + 1}</small></footer></article>)}</div>
    </section>
  );
}

function EmergencyStrip() {
  return <section className="emergency-strip"><div><span className="phone-ring">☎</span><div><h2>Truck tyre emergency? We&apos;re ready 24/7</h2><p>Call now for fast truck tyre assistance across Adelaide.</p></div></div><a href={PHONE_HREF}><small>Call now</small>{PHONE_DISPLAY}</a></section>;
}

const galleryItems = [
  ["/images/workshop-truck.jpg", "Workshop", "Commercial truck positioned for workshop service"],
  ["/images/tyre-closeup.jpg", "Tyre detail", "Heavy-duty truck tyre tread detail"],
  ["/images/truck-wheels.jpg", "Heavy vehicle", "Commercial truck wheels and polished metal equipment"],
  ["/images/hero-truck.jpg", "On the road", "Black heavy-duty commercial truck"],
  ["/images/australian-truck.jpg", "Fleet movement", "Commercial truck operating on an Australian road"],
  ["/images/roadside-truck.jpg", "Roadside", "Commercial vehicle stopped beside the road"],
] as const;

function Gallery({ full = false }: { full?: boolean }) {
  const items = full ? galleryItems : galleryItems.slice(0, 4);
  return (
    <section className={`section gallery-section${full ? " gallery-section--full" : ""}`}>
      <div className="section-topline"><SectionHeading eyebrow="On the job" title="Heavy vehicles. Real-world demands." intro="A look at the trucks, tyres and workshop environments that define commercial tyre work." />{!full && <Link className="text-link" href="/gallery">Open gallery <span>↗</span></Link>}</div>
      <div className="gallery-grid">
        {items.map(([src, label, alt], index) => <figure key={src} className={`gallery-item gallery-item--${index + 1}`}><Image src={src} alt={alt} fill sizes={full ? "(max-width: 620px) 100vw, 50vw" : "(max-width: 620px) 100vw, (max-width: 900px) 50vw, 33vw"} priority={index < 2} unoptimized /><figcaption><span>{label}</span><small>Illustrative service imagery</small></figcaption></figure>)}
      </div>
    </section>
  );
}

function AboutPreview() {
  return (
    <section className="about-preview">
      <div className="about-image"><Image src="/images/workshop-truck.jpg" alt="Heavy truck inside a commercial workshop" fill sizes="(max-width: 900px) 100vw, 53vw" unoptimized /><span>Regency Park<br />South Australia</span></div>
      <div className="about-copy">
        <SectionHeading dark eyebrow="Who we are" title="Built around keeping trucks moving" />
        <p>24/7 Truck Tyre Services provides commercial tyre support for truck drivers, transport businesses and fleet operators across Adelaide.</p>
        <p>From tyre supply and fitting to urgent roadside assistance, the focus is on practical service, dependable support and getting vehicles moving again quickly.</p>
        <div className="director-line"><span>Director</span><small>24/7 Truck Tyre Services</small></div>
        <Link className="button button--ghost-dark" href="/about">About the business <span>→</span></Link>
      </div>
    </section>
  );
}

function Process() {
  const steps = [["01", "Call us"], ["02", "Tell us your location & tyre issue"], ["03", "We organise the right tyre / service"], ["04", "Get your truck moving again"]];
  return (
    <section className="section process-section"><SectionHeading eyebrow="How it works" title="One call starts the response." /><div className="process-grid">{steps.map(([number, label]) => <div key={number}><span>{number}</span><i /><h3>{label}</h3></div>)}</div></section>
  );
}

function FleetBand() {
  return (
    <section className="fleet-band"><div className="fleet-image" aria-hidden="true" /><div className="fleet-copy"><p className="eyebrow"><span />For transport operators</p><h2>Fleet tyre support</h2><p>Reliable tyre support helps reduce vehicle downtime and keeps commercial operations moving. Speak with the team about tyre supply, fitting and ongoing support for trucks and commercial fleets.</p><Link className="button button--red" href="/contact">Discuss fleet support <span>↗</span></Link></div></section>
  );
}

function Location() {
  return (
    <section className="location-section">
      <div className="location-copy"><p className="eyebrow"><span />Our base</p><h2>Regency Park<br /><strong>South Australia</strong></h2><p>Commercial truck tyre supply, fitting and support from Adelaide&apos;s industrial north.</p><div><a className="button button--red" href="https://www.google.com/maps/search/?api=1&query=24%2F7+Truck+Tyre+Services+Regency+Park+SA" target="_blank" rel="noreferrer">Get directions <span>↗</span></a><a className="button button--ghost" href={PHONE_HREF}>Call now</a></div></div>
      <div className="map-wrap"><iframe title="Map showing 24/7 Truck Tyre Services in Regency Park, South Australia" src="https://www.google.com/maps?q=24%2F7%20Truck%20Tyre%20Services%20Regency%20Park%20SA&z=15&output=embed" loading="lazy" referrerPolicy="no-referrer-when-downgrade" /><span className="map-label">Regency Park · Adelaide</span></div>
    </section>
  );
}

function FAQ() {
  return (
    <section className="section faq-section"><SectionHeading eyebrow="Common questions" title="Straight answers before you call." /><div className="faq-list">{faqItems.map(([question, answer], index) => <details key={question} open={index === 0}><summary><span>{String(index + 1).padStart(2, "0")}</span>{question}<i /></summary><p>{answer}</p></details>)}</div></section>
  );
}

function ContactForm() {
  const [status, setStatus] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const body = ["24/7 Truck Tyre Services enquiry", ...["name", "company", "phone", "email", "vehicle", "service", "location", "message"].map((key) => `${key[0].toUpperCase()}${key.slice(1)}: ${data.get(key) || "—"}`)].join("\n");
    setStatus("Opening a secure WhatsApp message to the service team…");
    window.location.href = `https://wa.me/61452636802?text=${encodeURIComponent(body)}`;
  };
  return (
    <form className="assistance-form" onSubmit={submit}>
      <div className="field-grid">
        <label><span>Name *</span><input name="name" autoComplete="name" required /></label>
        <label><span>Company</span><input name="company" autoComplete="organization" /></label>
        <label><span>Phone *</span><input name="phone" type="tel" autoComplete="tel" required /></label>
        <label><span>Email</span><input name="email" type="email" autoComplete="email" /></label>
        <label><span>Vehicle type *</span><input name="vehicle" required placeholder="e.g. prime mover, rigid truck" /></label>
        <label><span>Tyre / service required *</span><select name="service" required defaultValue=""><option value="" disabled>Select a service</option><option>Emergency Truck Tyre Assistance</option><option>Truck Tyre Supply</option><option>Truck Tyre Fitting</option><option>Fleet Support</option><option>Workshop Service</option><option>General Enquiry</option></select></label>
        <label className="field-wide"><span>Current location *</span><input name="location" autoComplete="street-address" required /></label>
        <label className="field-wide"><span>Message</span><textarea name="message" rows={4} placeholder="Tyre position, size if known, and what happened" /></label>
      </div>
      <div className="form-actions"><button className="button button--red" type="submit">Request assistance <span>↗</span></button><p><strong>For urgent tyre assistance</strong><a href={PHONE_HREF}>Call {PHONE_DISPLAY}</a></p></div>
      {status && <p className="form-status" role="status">{status}</p>}
      <p className="form-note">Submitting opens a pre-filled WhatsApp message to the service number so you can review and send it. No information is stored by this website.</p>
    </form>
  );
}

function ContactSection() {
  return (
    <section className="contact-section" id="contact"><div className="contact-heading"><SectionHeading dark eyebrow="Request assistance" title="Tell us what your truck needs." intro="For an urgent roadside issue, calling is the fastest way to reach the team." /><a href={PHONE_HREF}><small>For urgent tyre assistance</small>Call {PHONE_DISPLAY}</a></div><ContactForm /></section>
  );
}

function StructuredData() {
  const data = [{
    "@context": "https://schema.org",
    "@type": ["LocalBusiness", "AutomotiveBusiness"],
    name: "24/7 Truck Tyre Services",
    telephone: "+61452636802",
    url: "https://247truck.vercel.app",
    image: "https://247truck.vercel.app/brand/logo-real-horizontal.png",
    address: { "@type": "PostalAddress", addressLocality: "Regency Park", addressRegion: "SA", addressCountry: "AU" },
    areaServed: { "@type": "City", name: "Adelaide" },
    openingHours: "Mo-Su 00:00-23:59",
  }, {
    "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqItems.map(([name, text]) => ({ "@type": "Question", name, acceptedAnswer: { "@type": "Answer", text } })),
  }];
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}

function ServiceStructuredData({ page }: { page: DetailPage }) {
  const url = `https://247truck.vercel.app/${page.slug}`;
  const data = [{
    "@context": "https://schema.org",
    "@type": "Service",
    name: page.titleTag,
    description: page.description,
    url,
    areaServed: { "@type": "City", name: "Adelaide" },
    provider: { "@type": "AutomotiveBusiness", name: "24/7 Truck Tyre Services", telephone: "+61452636802" },
  }, {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: "https://247truck.vercel.app" }, { "@type": "ListItem", position: 2, name: page.titleTag, item: url }],
  }];
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}

export function HomePage() {
  return <SiteShell intro><StructuredData /><Hero /><TrustStrip /><ServicesSection /><WhyUs /><AboutPreview /><Gallery /><Process /><FleetBand /><ServiceAreas /><Testimonials /><EmergencyStrip /><FAQ /><ContactSection /></SiteShell>;
}

export function DetailPageView({ page }: { page: DetailPage }) {
  return (
    <SiteShell>
      <ServiceStructuredData page={page} />
      <section className="inner-hero"><div className="inner-hero-image" style={{ backgroundImage: `linear-gradient(90deg, rgba(5,5,5,.98) 0%, rgba(5,5,5,.74) 48%, rgba(5,5,5,.2) 100%), url(${page.image})` }} /><div className="inner-hero-copy"><p className="eyebrow"><span />{page.eyebrow}</p><h1>{page.title}</h1><p>{page.intro}</p><div><a className="button button--red" href={PHONE_HREF}>Call now <span>↗</span></a><Link className="button button--ghost" href="/contact">Request assistance</Link></div></div></section>
      <section className="section detail-section"><div><SectionHeading eyebrow="What to expect" title="Commercial tyre support, clearly organised." /><p>Call with your truck location, tyre position and tyre size if known. This helps the team assess the requirement and organise the right tyre or workshop service.</p></div><ul>{page.points.map((point, index) => <li key={point}><span>{String(index + 1).padStart(2, "0")}</span>{point}</li>)}</ul></section>
      {page.slug === "services" && <ServicesSection />}
      {page.slug === "fleet-tyre-services" && <Process />}
      <EmergencyBand /><FAQ /><ContactSection />
    </SiteShell>
  );
}

export function GalleryPage() {
  return <SiteShell><section className="page-masthead"><p className="eyebrow"><span />24/7 Truck Tyre Services</p><h1>On the job</h1><p>Commercial trucks, heavy-duty tyres and the environments where dependable tyre service matters.</p></section><Gallery full /><EmergencyBand /><ContactSection /></SiteShell>;
}

export function ContactPage() {
  return <SiteShell><section className="page-masthead page-masthead--contact"><p className="eyebrow"><span />Contact the team</p><h1>Truck tyre help starts here.</h1><p>Send the service details by text, or call now for urgent 24/7 tyre assistance.</p></section><ContactSection /><Location /><FAQ /></SiteShell>;
}

export { detailPages };
