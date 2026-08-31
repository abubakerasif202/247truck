import type { Metadata } from "next";
import { SiteShell } from "../site-components";
import { SITE_URL } from "../site-data";
import { WheelAlignmentBooking } from "./booking-form";

const title = "Book Truck Wheel Alignment Adelaide";
const description = "Book a Truck Wheel Alignment workshop appointment in Regency Park. Monday to Saturday appointments with payment at the workshop.";
export const metadata: Metadata = { title, description, alternates: { canonical: `${SITE_URL}/book-wheel-alignment` }, openGraph: { title, description, url: `${SITE_URL}/book-wheel-alignment` } };

export default function BookWheelAlignmentPage() {
  return <SiteShell><section className="booking-masthead"><p className="eyebrow"><span />Regency Park workshop</p><h1>Book truck wheel alignment</h1><p>Choose one of five scheduled workshop appointments. All booking decisions use Adelaide local time.</p></section><section className="section booking-section"><WheelAlignmentBooking /></section></SiteShell>;
}
