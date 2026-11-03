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
    default: "Automotive & Truck Repairs Adelaide | 24/7 Truck Tyre Services",
    template: "%s | 24/7 Truck Tyre Services",
  },
  description:
    "Automotive repairs, truck mechanical servicing, tyres, batteries and 24/7 emergency truck tyre assistance in Adelaide. Regency Park workshop. Call +61 452 636 802.",
  applicationName: "24/7 Truck Tyre Services",
  category: "automotive",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "en_AU",
    siteName: "24/7 Truck Tyre Services",
    title: "Automotive & Truck Repair Workshop Adelaide",
    description:
      "Automotive and heavy truck repair enquiries, servicing and tyres in Adelaide. Emergency commercial truck tyre assistance available 24/7.",
    url: siteUrl,
    images: [{ url: "/og.webp", width: 1200, height: 630, alt: "24/7 Truck Tyre Services Adelaide" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Automotive & Truck Repairs Adelaide",
    description: "Automotive and truck mechanical repair enquiries and 24/7 emergency commercial truck tyre assistance across Adelaide.",
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
