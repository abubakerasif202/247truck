import type { Metadata } from "next";
import { FleetRoadsidePageView } from "../program-components";
import { SITE_URL } from "../site-data";

const title = "National Roadside Assistance Membership";
const description = "Apply for a one-year National Roadside Assistance Membership for a commercial truck or fleet. Activation and service arrangements are confirmed separately.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: `${SITE_URL}/fleet-roadside-assistance` },
  openGraph: { title, description, url: `${SITE_URL}/fleet-roadside-assistance`, images: [{ url: "/og.webp", width: 1200, height: 630, alt: "National roadside assistance program registration" }] },
  twitter: { card: "summary_large_image", title, description, images: ["/og.webp"] },
};

export default function FleetRoadsidePage() {
  return <FleetRoadsidePageView />;
}
