import { HomePage } from "./site-components";

export default function Home() {
  return (
    <>
      {/* Homepage hero uses a CSS background image, so preload it explicitly for LCP. */}
      <link rel="preload" href="/images/pack-01-hero-roadside.webp" as="image" type="image/webp" fetchPriority="high" />
      <HomePage />
    </>
  );
}
