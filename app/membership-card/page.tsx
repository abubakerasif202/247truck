import type { Metadata } from "next";
import { SiteShell } from "../site-components";
import { MembershipCardClient } from "./membership-card-client";

export const metadata: Metadata = { title: "National Roadside Assistance Membership Card", robots: { index: false, follow: false, noarchive: true }, referrer: "no-referrer" };
export default function MembershipCardPage() { return <SiteShell><section className="section private-page"><div><p className="eyebrow"><span />Digital membership card</p><h1>National Roadside Assistance Membership</h1><MembershipCardClient /></div></section></SiteShell>; }
