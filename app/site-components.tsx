"use client";

import Link from "next/link";
import Image from "next/image";
import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  detailPages,
  faqItems,
  navItems,
  PHONE_DISPLAY,
  PHONE_HREF,
  SITE_URL,
  services,
  type DetailPage,
} from "./site-data";

const INSTAGRAM_URL = "https://www.instagram.com/247trucktyreservice";

function Logo({ compact = false, white = false }: { compact?: boolean; white?: boolean }) {
  return (
    <Link className={`brand-logo${compact ? " brand-logo--compact" : ""}`} href="/" aria-label="24/7 Truck Tyre Services home">
      <Image src={white ? "/brand/logo-real-white.png" : "/brand/logo-real-horizontal.png"} alt="24/7 Truck Tyre Services" width={2172} height={724} priority={compact} sizes={compact ? "220px" : "300px"} />
    </Link>
  );
}

function Header() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const closeMenu = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => menuButton.current?.focus());
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1100px)");
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

  useEffect(() => {
    if (!open) return;
    navigation.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    const background = [
      document.querySelector<HTMLElement>("#main-content"),
      document.querySelector<HTMLElement>(".site-footer"),
      document.querySelector<HTMLElement>(".mobile-actions"),
    ].filter((element): element is HTMLElement => Boolean(element));
    background.forEach((element) => { element.inert = true; });
    const handleMenuKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
        return;
      }
      if (event.key === "Tab") {
        const focusable = Array.from(navigation.current?.querySelectorAll<HTMLElement>("a[href]") ?? []);
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleMenuKeys);
    return () => {
      background.forEach((element) => { element.inert = false; });
      window.removeEventListener("keydown", handleMenuKeys);
    };
  }, [open, closeMenu]);

  return (
    <header className={`site-header${scrolled ? " is-scrolled" : ""}`}>
      <div className="header-inner">
        <Logo compact />
        <nav ref={navigation} id="primary-navigation" className={`main-nav${open ? " is-open" : ""}`} aria-label="Primary navigation" aria-hidden={isMobile && !open} inert={isMobile && !open ? true : undefined}>
          {navItems.map(([label, href]) => (
            <Link key={href} href={href} onClick={closeMenu}>{label}</Link>
          ))}
        </nav>
        <button className={`menu-backdrop${open ? " is-open" : ""}`} type="button" aria-label="Close navigation" tabIndex={open ? 0 : -1} onClick={closeMenu} />
        <div className="header-actions">
          <a className="header-social" href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" aria-label="Follow 24/7 Truck Tyre Services on Instagram">IG</a>
          <a className="header-call" href={PHONE_HREF}><span>Call</span> {PHONE_DISPLAY}</a>
          <button ref={menuButton} className="menu-toggle" type="button" aria-label={open ? "Close navigation" : "Open navigation"} aria-controls="primary-navigation" aria-expanded={open} onClick={() => open ? closeMenu() : setOpen(true)}>
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
          <a className="footer-instagram" href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer">Instagram · @247trucktyreservice ↗</a>
        </div>
        <div>
          <h2>Company</h2>
          <Link href="/">Home</Link>
          <Link href="/services">Services</Link>
          <Link href="/about">About</Link>
          <Link href="/franchise">Franchise Opportunities</Link>
          <Link href="/contact">Contact</Link>
        </div>
        <div>
          <h2>Services</h2>
          <Link href="/24-7-truck-tyre-assistance">Emergency Assistance</Link>
          <Link href="/truck-tyre-fitting">Truck Tyre Fitting</Link>
          <Link href="/truck-tyres">Truck Tyre Supply</Link>
          <Link href="/fleet-tyre-services">Fleet Support</Link>
          <Link href="/fleet-roadside-assistance">Fleet Roadside Program</Link>
          <Link href="/privacy">Privacy</Link>
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
    <nav className="mobile-actions" aria-label="Quick contact actions">
      <a href={PHONE_HREF}>Call now</a>
      <Link href="/contact">Get help</Link>
    </nav>
  );
}

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <Header />
      <main id="main-content">{children}</main>
      <Footer />
      <MobileActions />
    </>
  );
}

export function SectionHeading({ eyebrow, title, intro, dark = false, id }: { eyebrow: string; title: string; intro?: string; dark?: boolean; id?: string }) {
  return (
    <div className={`section-heading${dark ? " section-heading--dark" : ""}`}>
      <p className="eyebrow"><span />{eyebrow}</p>
      <h2 id={id}>{title}</h2>
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
        <p className="eyebrow"><span />24/7 truck tyre &amp; roadside assistance</p>
        <h1 id="hero-title">Truck tyre help <span>when you need it</span></h1>
        <p className="hero-intro">Mobile roadside tyre assistance, commercial truck tyre fitting and practical fleet support across Adelaide.</p>
        <div className="hero-buttons">
          <a className="button button--red button--phone" href={PHONE_HREF}><small>Call for 24/7 assistance</small>{PHONE_DISPLAY}</a>
          <Link className="button button--ghost" href="/fleet-roadside-assistance">Fleet roadside program <span aria-hidden="true">→</span></Link>
        </div>
        <Link className="hero-tertiary" href="/franchise">Explore franchise opportunities <span aria-hidden="true">↗</span></Link>
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
  const items = [
    ["24/7", "24/7 support", "Urgent tyre help when the road does not wait."],
    ["↗", "Mobile tyre service", "Roadside support brought to suitable commercial vehicles."],
    ["▰", "Commercial trucks", "Tyre supply and fitting for working heavy vehicles."],
    ["✓", "Fleet support", "A direct enquiry pathway for transport operators."],
  ];
  return <section className="trust-strip" aria-label="Service highlights">{items.map(([icon, title, copy]) => <article key={title}><span aria-hidden="true">{icon}</span><div><strong>{title}</strong><small>{copy}</small></div></article>)}</section>;
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
  const reasons = ["Commercial truck focus", "Direct call access", "Tyre supply and fitting", "Roadside assistance", "Fleet support", "Regency Park workshop"];
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

function EmergencyStrip() {
  return <section className="emergency-strip"><div><span className="phone-ring">☎</span><div><h2>Truck tyre emergency? We&apos;re ready 24/7</h2><p>Call now for fast truck tyre assistance across Adelaide.</p></div></div><a href={PHONE_HREF}><small>Call now</small>{PHONE_DISPLAY}</a></section>;
}

const galleryItems = [
  ["/images/pack-01-hero-roadside.webp", "Rapid response", "Black commercial truck and tyre service van on a wet Adelaide road"],
  ["/images/pack-02-tyre-banner.webp", "Heavy-duty tread", "Cinematic heavy truck tyre with crimson light trails"],
  ["/images/pack-03-workshop-truck.webp", "Workshop service", "Black heavy truck inside a commercial tyre workshop"],
  ["/images/pack-04-wheel-fitting.webp", "Precision fitting", "Commercial tyre fitter servicing a heavy truck wheel"],
  ["/images/pack-05-roadside-technician.webp", "Roadside callout", "Roadside tyre technician working beside a service van in rain"],
  ["/images/pack-06-fleet-yard.webp", "Fleet support", "Commercial truck fleet and service vehicles at an industrial yard"],
  ["/images/pack-07-tyre-warehouse.webp", "Tyre supply", "Heavy vehicle tyre stock inside an industrial warehouse"],
  ["/images/pack-08-rescue-van.webp", "Mobile service", "Roadside rescue van attending a heavy truck at night"],
  ["/images/pack-09-workshop-team.webp", "Commercial expertise", "Workshop technicians servicing heavy trucks and wheels"],
  ["/images/pack-10-facility-exterior.webp", "Adelaide facility", "Truck tyre service facility with service van and truck at dusk"],
] as const;

function Gallery({ full = false }: { full?: boolean }) {
  const [selected, setSelected] = useState<(typeof galleryItems)[number] | null>(null);
  const galleryOpener = useRef<HTMLButtonElement | null>(null);
  const items = full ? galleryItems : galleryItems.slice(0, 4);
  useEffect(() => {
    document.body.classList.toggle("lightbox-open", Boolean(selected));
    return () => document.body.classList.remove("lightbox-open");
  }, [selected]);
  const closeLightbox = () => {
    setSelected(null);
    window.requestAnimationFrame(() => galleryOpener.current?.focus());
  };
  return (
    <section className={`section gallery-section${full ? " gallery-section--full" : ""}`}>
      <div className="section-topline"><SectionHeading eyebrow="On the job" title="Heavy vehicles. Real-world demands." intro="A look at the trucks, tyres and workshop environments that define commercial tyre work." />{!full && <Link className="text-link" href="/gallery">Open gallery <span>↗</span></Link>}</div>
      <div className="gallery-grid">
        {items.map((item, index) => { const [src, label, alt] = item; return <figure key={src} className={`gallery-item gallery-item--${index + 1}`}><button type="button" onClick={(event) => { galleryOpener.current = event.currentTarget; setSelected(item); }} aria-label={`Open ${label} image`}><Image src={src} alt={alt} fill sizes={full ? "(max-width: 620px) 100vw, 50vw" : "(max-width: 620px) 100vw, (max-width: 900px) 50vw, 33vw"} /><figcaption><span>{label}</span><small>View image ↗</small></figcaption></button></figure>; })}
      </div>
      {selected && <div className="gallery-lightbox" role="dialog" aria-modal="true" aria-label={selected[1]} onClick={closeLightbox} onKeyDown={(event) => { if (event.key === "Escape") closeLightbox(); if (event.key === "Tab") event.preventDefault(); }}><button type="button" className="lightbox-close" onClick={closeLightbox} aria-label="Close image" autoFocus>×</button><div onClick={(event) => event.stopPropagation()}><Image src={selected[0]} alt={selected[2]} fill sizes="95vw" /><p>{selected[1]}</p></div></div>}
    </section>
  );
}

function InstagramSection() {
  return (
    <section className="instagram-section">
      <div className="instagram-collage" aria-hidden="true"><Image src="/images/pack-05-roadside-technician.webp" alt="" fill sizes="30vw" /><Image src="/images/pack-07-tyre-warehouse.webp" alt="" fill sizes="30vw" /><Image src="/images/pack-10-facility-exterior.webp" alt="" fill sizes="30vw" /></div>
      <div className="instagram-copy"><p className="eyebrow"><span />24/7 Truck Tyre Services</p><h2>Follow us on Instagram</h2><p>See truck tyre work, roadside callouts and updates from 24/7 Truck Tyre Services.</p><a className="button button--red" href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer">Follow @247trucktyreservice <span>↗</span></a></div>
    </section>
  );
}

function AboutPreview() {
  return (
    <section className="about-preview">
      <div className="about-image"><Image src="/images/pack-03-workshop-truck.webp" alt="Black heavy truck inside a commercial tyre workshop" fill sizes="(max-width: 900px) 100vw, 53vw" /><span>Regency Park<br />South Australia</span></div>
      <div className="about-copy">
        <SectionHeading dark eyebrow="Who we are" title="Built around keeping trucks moving" />
        <p>24/7 Truck Tyre Services provides truck tyre supply, fitting and roadside support for truck drivers, commercial operators and fleets across Adelaide.</p>
        <p>The focus is on practical service, reliable support and getting heavy vehicles back on the road as quickly as possible.</p>
        <div className="director-line"><span>Commercial tyre support</span><small>Truck drivers · fleets · transport operators</small></div>
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
    <section className="fleet-band"><div className="fleet-image" aria-hidden="true" /><div className="fleet-copy"><p className="eyebrow"><span />For transport operators</p><h2>Fleet roadside registration</h2><p>Register your fleet details so our team can understand your vehicles, operating regions and roadside support requirements before discussing a service arrangement.</p><Link className="button button--red" href="/fleet-roadside-assistance">Register your fleet <span>↗</span></Link></div></section>
  );
}

function CustomerJourneys() {
  const journeys = [
    ["Need help now", "Emergency truck tyre assistance", "Call 24/7", PHONE_HREF, "journey-card--urgent"],
    ["Manage a fleet", "Register fleet details and support requirements", "Register your fleet", "/fleet-roadside-assistance", ""],
    ["Grow with us", "Explore a local franchise opportunity", "Franchise opportunities", "/franchise", ""],
  ];
  return (
    <section className="section journey-section" aria-labelledby="journey-title">
      <SectionHeading id="journey-title" eyebrow="Choose your next step" title="Three ways we can help." intro="Emergency assistance stays one call away, with dedicated pathways for fleet operators and prospective franchise partners." />
      <div className="journey-grid">{journeys.map(([eyebrow, title, label, href, modifier], index) => <article className={`journey-card ${modifier}`} key={title}><span>{String(index + 1).padStart(2, "0")}</span><p>{eyebrow}</p><h3>{title}</h3>{href.startsWith("tel:") ? <a href={href}>{label} <i>↗</i></a> : <Link href={href}>{label} <i>↗</i></Link>}</article>)}</div>
    </section>
  );
}

function FranchiseBand() {
  return (
    <section className="franchise-band"><div><p className="eyebrow"><span />Franchise opportunities</p><h2>Grow with 24/7 Truck Tyre Services</h2><p>We are looking to hear from motivated operators interested in building a local truck tyre and roadside assistance business under the 24/7 Truck Tyre Services brand.</p><Link className="button button--white" href="/franchise">Explore franchise opportunities <span>↗</span></Link></div><div className="franchise-band-image" aria-hidden="true" /></section>
  );
}

function Location() {
  return (
    <section className="location-section">
      <div className="location-copy"><p className="eyebrow"><span />Regency Park · Adelaide</p><h2>Find 24/7 Truck Tyre Services</h2><p>Truck tyre supply, fitting and roadside support from our Adelaide service location.</p><div><a className="button button--red" href="https://www.google.com/maps/dir/?api=1&destination=-34.85853674026474%2C138.57081007443298" target="_blank" rel="noopener noreferrer">Get directions <span>↗</span></a><a className="button button--ghost" href={PHONE_HREF}>Call now</a><a className="button button--ghost" href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer">Instagram</a></div><div className="location-facility"><Image src="/images/pack-10-facility-exterior.webp" alt="24/7 Truck Tyre Services facility exterior at dusk" fill sizes="(max-width: 900px) 100vw, 38vw" /></div></div>
      <div className="map-wrap"><iframe title="Official Google Map for 24/7 Truck Tyre Services" src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3893.3547912856266!2d138.57081007443298!3d-34.85853674026474!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x6ab0c76a14442a27%3A0x827811fdc4c4f1da!2s24%2F7%20Truck%20tyre%20service!5e0!3m2!1sen!2sau!4v1788033590845!5m2!1sen!2sau" width="600" height="450" style={{ border: 0 }} allowFullScreen loading="lazy" referrerPolicy="strict-origin-when-cross-origin" /><span className="map-label">Regency Park · Adelaide</span></div>
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
    setStatus("Opening a pre-filled WhatsApp message for you to review…");
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
      <p className="form-note">Submitting opens WhatsApp with your details in a pre-filled message for you to review before sending. WhatsApp processes information under its own terms. See our <Link href="/privacy">privacy notice</Link>.</p>
    </form>
  );
}

function ContactSection() {
  return (
    <section className="contact-section" id="contact"><div className="contact-heading"><SectionHeading dark eyebrow="Request assistance" title="Tell us what your truck needs." intro="For an urgent roadside issue, calling is the fastest way to reach the team." /><a href={PHONE_HREF}><small>For urgent tyre assistance</small>Call {PHONE_DISPLAY}</a><a className="contact-instagram" href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer">Follow @247trucktyreservice ↗</a></div><ContactForm /></section>
  );
}

function StructuredData() {
  const data = [{
    "@context": "https://schema.org",
    "@type": ["LocalBusiness", "AutomotiveBusiness"],
    name: "24/7 Truck Tyre Services",
    telephone: "+61452636802",
    url: SITE_URL,
    image: `${SITE_URL}/brand/logo-real-horizontal.png`,
    sameAs: [INSTAGRAM_URL],
    address: { "@type": "PostalAddress", addressLocality: "Regency Park", addressRegion: "SA", addressCountry: "AU" },
    areaServed: { "@type": "City", name: "Adelaide" },
    openingHours: "Mo-Su 00:00-23:59",
  }, {
    "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqItems.map(([name, text]) => ({ "@type": "Question", name, acceptedAnswer: { "@type": "Answer", text } })),
  }];
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}

function ServiceStructuredData({ page }: { page: DetailPage }) {
  const url = `${SITE_URL}/${page.slug}`;
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
    itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: SITE_URL }, { "@type": "ListItem", position: 2, name: page.titleTag, item: url }],
  }];
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}

export function HomePage() {
  return <SiteShell><StructuredData /><Hero /><TrustStrip /><CustomerJourneys /><ServicesSection limit={6} /><FleetBand /><WhyUs /><FranchiseBand /><ServiceAreas /><AboutPreview /><Gallery /><InstagramSection /><Process /><EmergencyStrip /><FAQ /><ContactSection /><Location /></SiteShell>;
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
  return <SiteShell><section className="page-masthead"><p className="eyebrow"><span />24/7 Truck Tyre Services</p><h1>On the job</h1><p>Commercial trucks, heavy-duty tyres and the environments where dependable tyre service matters.</p></section><Gallery full /><InstagramSection /><EmergencyBand /><ContactSection /></SiteShell>;
}

export function ContactPage() {
  return <SiteShell><section className="page-masthead page-masthead--contact"><p className="eyebrow"><span />Contact the team</p><h1>Truck tyre help starts here.</h1><p>Send your service details through WhatsApp, or call now for urgent 24/7 tyre assistance.</p></section><ContactSection /><Location /><FAQ /></SiteShell>;
}

export { detailPages };
