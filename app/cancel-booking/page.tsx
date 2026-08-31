import type { Metadata } from "next";
import { SiteShell } from "../site-components";
import { CancellationClient } from "./cancellation-client";

export const metadata: Metadata = { title: "Manage Wheel Alignment Booking", robots: { index: false, follow: false, noarchive: true }, referrer: "no-referrer" };
export default function CancelBookingPage() {
  return <SiteShell><section className="section private-page"><CancellationClient /></section></SiteShell>;
}
