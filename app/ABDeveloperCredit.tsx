import Image from "next/image";

const AB_STUDIO_URL = "https://www.abwebstudio.com.au/";

export default function ABDeveloperCredit() {
  return (
    <div className="ab-developer-credit">
      <span className="ab-developer-credit__label">Designed &amp; Developed by</span>
      <a
        className="ab-developer-credit__link"
        href={AB_STUDIO_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Visit AB Digital Solutions"
      >
        <Image
          src="/branding/ab-digital-solutions-watermark.webp"
          alt="AB Digital Solutions"
          width={672}
          height={309}
          sizes="(max-width: 620px) 150px, 160px"
        />
        <span className="ab-developer-credit__arrow" aria-hidden="true">↗</span>
      </a>
    </div>
  );
}
