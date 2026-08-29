import type { MetadataRoute } from "next";
import { detailPages, SITE_URL } from "./site-data";

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = ["", ...Object.keys(detailPages), "gallery", "contact"];
  return paths.map((path, index) => ({
    url: `${SITE_URL}${path ? `/${path}` : ""}`,
    lastModified: new Date(),
    changeFrequency: index === 0 ? "weekly" : "monthly",
    priority: index === 0 ? 1 : path === "24-7-truck-tyre-assistance" ? 0.9 : 0.7,
  }));
}
