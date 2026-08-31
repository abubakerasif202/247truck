import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "../site-components";
import { PHONE_DISPLAY, PHONE_HREF, SITE_URL } from "../site-data";

export const metadata: Metadata = {
  title: "Privacy Notice",
  description: "How 24/7 Truck Tyre Services handles website enquiries and contact information.",
  alternates: { canonical: `${SITE_URL}/privacy` },
};

export default function PrivacyPage() {
  return (
    <SiteShell>
      <section className="page-masthead legal-masthead"><p className="eyebrow"><span />Website information</p><h1>Privacy notice</h1><p>How information submitted through this website is used for enquiries, workshop bookings and membership applications.</p></section>
      <article className="section legal-content">
        <h2>Information we collect</h2><p>Depending on the form you use, we may collect your name, contact and business details, truck registration and vehicle details, fleet and operating information, booking date and appointment time, preferred territory, and information included in your notes.</p>
        <h2>How we use it</h2><p>We use submitted information to manage workshop bookings, review membership and other enquiries, send transactional notifications, understand service requirements, and discuss a potential fleet or franchise relationship. A membership application is not active until separately approved.</p>
        <h2>Service providers</h2><p>Booking and membership records are stored in a server-protected database, and transactional messages are delivered through a server-side email provider. The urgent assistance form opens WhatsApp with a pre-filled message, and the contact page embeds Google Maps. Those providers process information under their own privacy terms.</p>
        <h2>Private access links</h2><p>Booking cancellation and membership-card links contain strong private access codes. Keep these links confidential. Only hashed versions of the codes are stored in the database, and private pages are excluded from search indexing.</p>
        <h2>Security and retention</h2><p>Website forms use validation, anti-automation and rate-limit controls. Records are retained only as reasonably required to fulfil bookings, administer memberships, respond to enquiries, meet business obligations and resolve disputes, then deleted or de-identified when no longer required. Avoid including financial records, identity documents or other sensitive information in notes.</p>
        <h2>Your choices</h2><p>You can call instead of using a website form. To ask about information previously submitted through this website, call <a href={PHONE_HREF}>{PHONE_DISPLAY}</a>.</p>
        <p><Link className="text-link" href="/contact">Contact 24/7 Truck Tyre Services <span>↗</span></Link></p>
      </article>
    </SiteShell>
  );
}
