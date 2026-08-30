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
      <section className="page-masthead legal-masthead"><p className="eyebrow"><span />Website information</p><h1>Privacy notice</h1><p>How information submitted through this website is used to respond to service, fleet and franchise enquiries.</p></section>
      <article className="section legal-content">
        <h2>Information we collect</h2><p>Depending on the form you use, we may collect your name, contact details, business details, fleet information, preferred territory and the information you include in your message.</p>
        <h2>How we use it</h2><p>We use submitted information to review and respond to your enquiry, understand service requirements, and discuss a potential fleet or franchise relationship. Submitting a form does not create a commercial account, franchise offer or service agreement.</p>
        <h2>Service providers</h2><p>Fleet and franchise enquiries are delivered through a server-side email provider. The urgent assistance form opens WhatsApp with a pre-filled message, and the contact page embeds Google Maps. Those providers process information under their own privacy terms.</p>
        <h2>Security and retention</h2><p>Website forms use validation and anti-spam controls. Information is retained only as reasonably required to respond to an enquiry and manage any resulting business discussion. Avoid including financial records, identity documents or other sensitive information in a website message.</p>
        <h2>Your choices</h2><p>You can call instead of using a website form. To ask about information previously submitted through this website, call <a href={PHONE_HREF}>{PHONE_DISPLAY}</a>.</p>
        <p><Link className="text-link" href="/contact">Contact 24/7 Truck Tyre Services <span>↗</span></Link></p>
      </article>
    </SiteShell>
  );
}
