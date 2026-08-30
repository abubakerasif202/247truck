import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContactPage, DetailPageView, GalleryPage } from "../site-components";
import { detailPages, SITE_URL } from "../site-data";

const specialPages = {
  gallery: {
    title: "Truck Tyre Service Gallery Adelaide",
    description: "Commercial trucks, heavy-duty tyres and workshop environments behind professional truck tyre service.",
  },
  contact: {
    title: "Contact 24/7 Truck Tyre Services Adelaide",
    description: "Request truck tyre assistance in Adelaide or call +61 452 636 802 for urgent 24/7 service.",
  },
};

export function generateStaticParams() {
  return [...Object.keys(detailPages), ...Object.keys(specialPages)].map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const detail = detailPages[slug];
  const special = specialPages[slug as keyof typeof specialPages];
  if (!detail && !special) return {};
  const title = detail?.titleTag ?? special.title;
  const description = detail?.description ?? special.description;
  const url = `${SITE_URL}/${slug}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, images: [{ url: "/og.webp", width: 1200, height: 630, alt: "24/7 Truck Tyre Services Adelaide" }] },
    twitter: { card: "summary_large_image", title, description, images: ["/og.webp"] },
  };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (slug === "gallery") return <GalleryPage />;
  if (slug === "contact") return <ContactPage />;
  const page = detailPages[slug];
  if (!page) notFound();
  return <DetailPageView page={page} />;
}
