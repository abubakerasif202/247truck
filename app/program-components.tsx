"use client";

import Image from "next/image";
import Link from "next/link";
import { EnquiryForm } from "./enquiry-form";
import { MembershipApplicationForm } from "./membership-components";
import { PHONE_DISPLAY, PHONE_HREF, SITE_URL } from "./site-data";
import { SectionHeading, SiteShell } from "./site-components";

const franchiseBenefits = [
  ["Recognisable identity", "Build under the established 24/7 Truck Tyre Services name and visual identity."],
  ["Commercial market", "Focus on the practical tyre needs of trucks, transport operators and fleet customers."],
  ["Operating model", "Discuss how the existing service approach may translate to a suitable local territory."],
  ["Business support", "Explore available operational and marketing guidance during the enquiry process."],
  ["Local opportunity", "Review an area of interest with the team before any offer or commitment is made."],
  ["Roadside focus", "Build around commercial tyre assistance for vehicles that need to keep moving."],
] as const;

const franchiseSteps = ["Submit interest", "Initial discussion", "Territory and business review", "Further information", "Agreement and onboarding if suitable"];

const fleetBenefits = [
  "Central fleet contact details",
  "Vehicle information available when assistance is requested",
  "A direct commercial enquiry pathway",
  "Roadside tyre support discussions",
  "Scheduled tyre service enquiries",
  "Service coordination based on location and requirements",
] as const;

function ProgramSchema({ kind }: { kind: "franchise" | "fleet" }) {
  const isFleet = kind === "fleet";
  const path = isFleet ? "/fleet-roadside-assistance" : "/franchise";
  const name = isFleet ? "National Roadside Assistance Program Registration" : "Truck Tyre Franchise Opportunities";
  const data = [{
    "@context": "https://schema.org",
    "@type": isFleet ? "Service" : "WebPage",
    name,
    url: `${SITE_URL}${path}`,
    ...(isFleet
      ? { provider: { "@type": "Organization", name: "24/7 Truck Tyre Services", url: SITE_URL, telephone: "+61452636802" } }
      : { about: { "@type": "Organization", name: "24/7 Truck Tyre Services", url: SITE_URL } }),
    areaServed: { "@type": "Country", name: "Australia" },
  }, {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name, item: `${SITE_URL}${path}` },
    ],
  }];
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}

function ProgramHero({ eyebrow, title, intro, image, imageAlt, children }: { eyebrow: string; title: string; intro: string; image: string; imageAlt: string; children: React.ReactNode }) {
  return (
    <section className="program-hero">
      <div className="program-hero-copy"><p className="eyebrow"><span />{eyebrow}</p><h1>{title}</h1><p>{intro}</p><div className="program-hero-actions">{children}</div></div>
      <div className="program-hero-media"><Image src={image} alt={imageAlt} fill priority sizes="(max-width: 900px) 100vw, 48vw" /></div>
    </section>
  );
}

function MembershipProgramHero() {
  return (
    <section className="membership-program-hero" aria-labelledby="membership-program-title">
      <div className="membership-program-hero__inner">
        <div className="membership-program-hero__copy">
          <p className="eyebrow"><span />24/7 Truck Tyre Services</p>
          <h1 id="membership-program-title">National Roadside Assistance Program</h1>
          <p>Registered members receive access to a priority roadside support pathway when assistance is needed, with service arrangements confirmed by our team for each commercial vehicle or fleet.</p>
          <div className="program-hero-actions">
            <a className="button button--red" href="#fleet-registration">Register for Roadside Assistance <span>↘</span></a>
            <a className="button button--ghost" href="#program-overview">Learn More <span>↓</span></a>
          </div>
        </div>
        <figure className="membership-program-hero__artwork">
          <div className="membership-program-hero__label"><strong>Premium Roadside Membership</strong><span>24/7 support when you need it most.</span></div>
          <div className="membership-program-hero__image">
            <Image src="/images/premium-roadside-membership-card.png" alt="24/7 Truck Tyre Services premium roadside membership card" width={1448} height={1086} priority sizes="(max-width: 900px) calc(100vw - 40px), (max-width: 1180px) 52vw, 48vw" />
          </div>
          <figcaption>Card artwork shown for program presentation. Service availability and arrangements are confirmed separately.</figcaption>
        </figure>
      </div>
    </section>
  );
}

export function FranchisePageView() {
  return (
    <SiteShell>
      <ProgramSchema kind="franchise" />
      <ProgramHero eyebrow="Franchise opportunities" title="Own a 24/7 Truck Tyre Services franchise" intro="Explore the opportunity to build a local commercial truck tyre and roadside assistance business under the 24/7 Truck Tyre Services brand." image="/images/pack-09-workshop-team.webp" imageAlt="Commercial truck tyre work in an industrial workshop">
        <a className="button button--red" href="#franchise-enquiry">Submit your interest <span>↘</span></a>
        <a className="button button--ghost" href={PHONE_HREF}>Call {PHONE_DISPLAY}</a>
      </ProgramHero>

      <section className="section program-intro"><SectionHeading eyebrow="Build a local operation" title="A commercial tyre business opportunity." intro="This enquiry page is for motivated operators who want to learn more about serving truck drivers, transport businesses and fleets in a local area. Submitting interest is the start of a discussion, not an offer or guarantee of approval." /><div className="program-callout"><strong>No income promises. No automatic approval.</strong><p>Territory, operating requirements, costs, support and formal terms must be reviewed directly with the business before any decision is made.</p></div></section>

      <section className="section program-benefits"><SectionHeading eyebrow="Why explore the opportunity" title="A practical model for a specialised market." /><div className="program-card-grid">{franchiseBenefits.map(([title, copy], index) => <article key={title}><span>{String(index + 1).padStart(2, "0")}</span><h3>{title}</h3><p>{copy}</p></article>)}</div></section>

      <section className="program-split"><div><SectionHeading dark eyebrow="Ideal franchise partner" title="Commercially minded and ready to serve." /><p>Relevant tyre, automotive or transport experience can be valuable, but the team is interested in understanding the complete person and business plan.</p></div><ul>{["Customer-service focused", "Comfortable around commercial vehicles", "Prepared for emergency and on-call work", "Business ownership mindset", "Committed to safe, professional service", "Interested in building a local territory"].map((item) => <li key={item}>{item}</li>)}</ul></section>

      <section className="section program-process"><SectionHeading eyebrow="How it works" title="A clear enquiry journey." /><ol>{franchiseSteps.map((step, index) => <li key={step}><span>{String(index + 1).padStart(2, "0")}</span><strong>{step}</strong>{index === franchiseSteps.length - 1 && <small>If both parties decide to proceed</small>}</li>)}</ol></section>

      <section className="program-form-section" id="franchise-enquiry"><div className="program-form-heading"><SectionHeading dark eyebrow="Franchise enquiry" title="Tell us about your interest." intro="Provide enough detail for an initial review. The team will contact you to discuss suitability and next steps." /></div><EnquiryForm type="franchise" submitLabel="Submit franchise interest" successMessage="Your franchise enquiry has been received. Our team will review your details and contact you to discuss next steps.">
        <div className="field-grid">
          <label><span>First name *</span><input name="firstName" autoComplete="given-name" required maxLength={80} /></label>
          <label><span>Last name *</span><input name="lastName" autoComplete="family-name" required maxLength={80} /></label>
          <label><span>Email *</span><input name="email" type="email" autoComplete="email" required maxLength={160} /></label>
          <label><span>Phone *</span><input name="phone" type="tel" autoComplete="tel" required maxLength={40} /></label>
          <label><span>City / suburb *</span><input name="city" autoComplete="address-level2" required maxLength={100} /></label>
          <label><span>State / territory *</span><select name="state" autoComplete="address-level1" required defaultValue=""><option value="" disabled>Select</option>{["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"].map((state) => <option key={state}>{state}</option>)}</select></label>
          <label><span>Postcode *</span><input name="postcode" inputMode="numeric" autoComplete="postal-code" required pattern="[0-9]{4}" maxLength={4} /></label>
          <label><span>Current occupation / business</span><input name="occupation" autoComplete="organization-title" maxLength={160} /></label>
          <label><span>Tyre, automotive or transport experience?</span><select name="industryExperience" defaultValue=""><option value="">Select</option><option>Yes</option><option>No</option><option>Some related experience</option></select></label>
          <label><span>Business ownership experience *</span><select name="businessExperience" required defaultValue=""><option value="" disabled>Select</option><option>Current business owner</option><option>Previous business owner</option><option>Management experience</option><option>New to business ownership</option></select></label>
          <label className="field-wide"><span>Preferred franchise area / territory *</span><input name="preferredArea" required maxLength={160} /></label>
          <label><span>Estimated timeframe to start</span><select name="timeframe" defaultValue=""><option value="">Select</option><option>Within 3 months</option><option>3–6 months</option><option>6–12 months</option><option>More than 12 months</option><option>Exploring options</option></select></label>
          <label className="field-wide"><span>Message</span><textarea name="message" rows={5} maxLength={2000} /></label>
          <label className="field-wide consent-field"><input name="consent" type="checkbox" required /><span>I consent to 24/7 Truck Tyre Services contacting me regarding franchise opportunities. *</span></label>
          <p className="field-wide form-note">Please read our <Link href="/privacy">privacy notice</Link> before submitting.</p>
        </div>
      </EnquiryForm></section>
    </SiteShell>
  );
}

export function FleetRoadsidePageView() {
  const fleetFaq = [
    ["Does registration create a fleet account?", "No. Registration lets the team review your fleet and contact you. Any account, pricing or service terms require a separate agreement."],
    ["Is roadside service available everywhere in Australia?", "The program accepts fleet enquiries from across Australia. Actual assistance and coordination depend on vehicle location, service availability and the agreed arrangement."],
    ["Can we enquire about scheduled tyre servicing?", "Yes. Include scheduled servicing in your requirements so the team can discuss what may be suitable."],
    ["What happens in an emergency?", `Call ${PHONE_DISPLAY}. Registered fleet details may help the team identify your business, but availability still depends on the situation and location.`],
  ];
  return (
    <SiteShell>
      <ProgramSchema kind="fleet" />
      <MembershipProgramHero />

      <section className="section program-intro" id="program-overview"><SectionHeading eyebrow="For commercial operators" title="Plan the support pathway before a truck stops." intro="The registration program is designed for transport operators, fleet managers, logistics businesses and commercial organisations that want to discuss truck tyre and roadside support." /><div className="program-callout"><strong>Australia-wide enquiries are welcome.</strong><p>Service availability and coordination depend on location, vehicle requirements and the arrangement confirmed with 24/7 Truck Tyre Services.</p></div></section>

      <section className="section program-benefits"><SectionHeading eyebrow="Program benefits" title="Useful fleet information in one place." /><div className="program-card-grid">{fleetBenefits.map((benefit, index) => <article key={benefit}><span>{String(index + 1).padStart(2, "0")}</span><h3>{benefit}</h3></article>)}</div></section>

      <section className="section program-process"><SectionHeading eyebrow="How registration works" title="Simple information. Clear next step." /><ol>{["Submit fleet details", "Requirements review", "Team discussion", "Service options considered", "Separate agreement if suitable"].map((step, index) => <li key={step}><span>{String(index + 1).padStart(2, "0")}</span><strong>{step}</strong></li>)}</ol></section>

      <section className="program-form-section" id="fleet-registration"><div className="program-form-heading"><SectionHeading dark eyebrow="Membership application" title="Tell us about your operation." intro="Applications are reviewed before activation. Active memberships run for one calendar year from the confirmed activation date." /></div><MembershipApplicationForm /></section>

      <section className="section faq-section"><SectionHeading eyebrow="National program FAQ" title="Important details before registering." /><div className="faq-list">{fleetFaq.map(([question, answer], index) => <details key={question} open={index === 0}><summary><span>{String(index + 1).padStart(2, "0")}</span>{question}<i /></summary><p>{answer}</p></details>)}</div></section>
      <section className="emergency-strip"><div><span className="phone-ring">☎</span><div><h2>Truck tyre emergency?</h2><p>Registration is not an emergency request. Call the team directly for urgent assistance.</p></div></div><a href={PHONE_HREF}><small>Call now</small>{PHONE_DISPLAY}</a></section>
    </SiteShell>
  );
}
