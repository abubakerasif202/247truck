import type { Metadata, Viewport } from "next";
import "./globals.css";

const siteUrl = "https://truck-tyre-services-adelaide.mamun1.chatgpt.site";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "24/7 Truck Tyre Services Adelaide | Roadside Assistance",
    template: "%s | 24/7 Truck Tyre Services",
  },
  description:
    "24/7 truck tyre service in Adelaide for commercial vehicles and fleets. Truck tyre supply, fitting and roadside assistance from Regency Park. Call +61 452 636 802.",
  applicationName: "24/7 Truck Tyre Services",
  keywords: [
    "truck tyres Adelaide",
    "24/7 truck tyre service Adelaide",
    "truck tyre fitting Adelaide",
    "truck tyres Regency Park",
    "fleet tyre service Adelaide",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "en_AU",
    siteName: "24/7 Truck Tyre Services",
    title: "24/7 Truck Tyre Services Adelaide",
    description:
      "Truck tyre supply, fitting and roadside assistance across Adelaide—available 24/7.",
    url: siteUrl,
    images: [{ url: "/og.png", width: 1536, height: 1024, alt: "24/7 Truck Tyre Services Adelaide" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "24/7 Truck Tyre Services Adelaide",
    description: "Commercial truck tyre supply, fitting and roadside support across Adelaide.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#050505",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-AU">
      <head>
        <link rel="preload" href="/brand/logo.webp" as="image" type="image/webp" />
        <link rel="preload" href="/images/hero-truck.jpg" as="image" type="image/jpeg" />
        <link rel="icon" href="/brand/logo.webp" type="image/webp" />
      </head>
      <body>{children}</body>
    </html>
  );
}
