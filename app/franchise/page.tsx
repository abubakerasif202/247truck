import type { Metadata } from "next";
import { FranchisePageView } from "../program-components";
import { SITE_URL } from "../site-data";

const title = "Truck Tyre Franchise Opportunities Australia";
const description = "Explore a 24/7 Truck Tyre Services franchise opportunity and submit your interest in operating a local commercial truck tyre and roadside assistance business.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: `${SITE_URL}/franchise` },
  openGraph: { title, description, url: `${SITE_URL}/franchise`, images: [{ url: "/og.webp", width: 1200, height: 630, alt: "24/7 Truck Tyre Services franchise opportunities" }] },
  twitter: { card: "summary_large_image", title, description, images: ["/og.webp"] },
};

export default function FranchisePage() {
  return <FranchisePageView />;
}
