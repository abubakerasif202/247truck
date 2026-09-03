import type { Metadata, Viewport } from "next";
import { Oswald } from "next/font/google";
import "./globals.css";
import { SITE_URL } from "./site-data";

const siteUrl = SITE_URL;

const oswald = Oswald({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-oswald",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "24/7 Truck Tyre Services Adelaide | Roadside Assistance",
    template: "%s | 24/7 Truck Tyre Services",
  },
  description:
    "24/7 truck tyre service in Adelaide for commercial vehicles and fleets. Truck tyre supply, fitting and roadside assistance from Regency Park. Call +61 452 636 802.",
  applicationName: "24/7 Truck Tyre Services",
  category: "automotive",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "en_AU",
    siteName: "24/7 Truck Tyre Services",
    title: "24/7 Truck Tyre Services Adelaide",
    description:
      "Truck tyre supply, fitting and roadside assistance across Adelaide—available 24/7.",
    url: siteUrl,
    images: [{ url: "/og.webp", width: 1200, height: 630, alt: "24/7 Truck Tyre Services Adelaide" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "24/7 Truck Tyre Services Adelaide",
    description: "Commercial truck tyre supply, fitting and roadside support across Adelaide.",
    images: ["/og.webp"],
  },
  icons: {
    icon: "/brand/favicon.svg",
    apple: "/brand/favicon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0c0e",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-AU" className={oswald.variable}>
      <body>{children}</body>
    </html>
  );
}
