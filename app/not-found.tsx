import Link from "next/link";
import { PHONE_DISPLAY, PHONE_HREF } from "./site-data";
import { SiteShell } from "./site-components";

export default function NotFound() {
  return (
    <SiteShell>
      <section className="page-masthead">
        <p className="eyebrow"><span />Page not found</p>
        <h1>Wrong turn</h1>
        <p>The page you requested is not available. Return home, browse our services, or call the team for truck tyre assistance.</p>
        <div className="hero-buttons">
          <a className="button button--red" href={PHONE_HREF}>Call {PHONE_DISPLAY} <span aria-hidden="true">↗</span></a>
          <Link className="button button--ghost" href="/">Return home</Link>
          <Link className="button button--ghost" href="/services">View services</Link>
        </div>
      </section>
    </SiteShell>
  );
}
