export const PHONE_DISPLAY = "+61 452 636 802";
export const PHONE_HREF = "tel:+61452636802";
export const SITE_URL = "https://247truck.vercel.app";

export const navItems = [
  ["Home", "/"],
  ["Services", "/services"],
  ["About", "/about"],
  ["Service Areas", "/#service-areas"],
  ["Contact", "/contact"],
] as const;

export const services = [
  {
    number: "01",
    title: "Emergency Breakdown Assistance",
    description: "Practical roadside tyre support when a commercial vehicle is immobilised.",
    href: "/24-7-truck-tyre-assistance",
  },
  {
    number: "02",
    title: "Truck Tyre Fitting",
    description: "Professional fitting for heavy vehicles at the roadside or our workshop.",
    href: "/truck-tyre-fitting",
  },
  {
    number: "03",
    title: "Tyre Repair",
    description: "Practical assessment and repair support for suitable commercial truck tyres.",
    href: "/services",
  },
  {
    number: "04",
    title: "Fleet Maintenance",
    description: "Planned tyre support that helps commercial fleets reduce avoidable downtime.",
    href: "/fleet-tyre-services",
  },
  {
    number: "05",
    title: "Mobile Roadside Service",
    description: "Commercial tyre assistance brought to your vehicle across Adelaide.",
    href: "/24-7-truck-tyre-assistance",
  },
  {
    number: "06",
    title: "Wheel Balancing",
    description: "Commercial wheel support focused on smooth, safe heavy-vehicle operation.",
    href: "/services",
  },
  {
    number: "07",
    title: "Truck Tyre Supply",
    description: "Quality commercial truck tyres selected for your vehicle and operating needs.",
    href: "/truck-tyres",
  },
  {
    number: "08",
    title: "Heavy Vehicle Tyres",
    description: "Tyre solutions for prime movers, rigid trucks and commercial transport vehicles.",
    href: "/truck-tyres",
  },
] as const;

export const faqItems = [
  ["Do you provide 24/7 truck tyre service?", "Yes. Urgent truck tyre assistance is available 24 hours a day. Call the team directly with your location and tyre issue."],
  ["What areas do you service?", "We support truck drivers, fleets and commercial operators across Adelaide from Regency Park, South Australia."],
  ["Do you supply truck tyres?", "Yes. We supply commercial truck tyres for a range of heavy vehicle and operating requirements."],
  ["Can you replace a truck tyre roadside?", "Roadside tyre assistance is available for suitable commercial vehicles and tyre issues. Call so the team can assess what is required."],
  ["Do you provide fleet tyre support?", "Yes. We can discuss tyre supply, fitting and ongoing support for trucks and commercial fleets."],
  ["Can I bring my truck to your workshop?", "Yes. Workshop tyre services are available at Regency Park. Call first to confirm the service and tyre requirements."],
  ["How do I request emergency truck tyre assistance?", `Call ${PHONE_DISPLAY}. Click-to-call buttons are available throughout this website.`],
  ["What information should I provide when I call?", "Share your current location, vehicle type, tyre position, tyre size if known, and a clear description of the issue."],
] as const;

export type DetailPage = {
  slug: string;
  eyebrow: string;
  title: string;
  intro: string;
  image: string;
  imageAlt: string;
  points: string[];
  titleTag: string;
  description: string;
};

export const detailPages: Record<string, DetailPage> = {
  services: {
    slug: "services",
    eyebrow: "COMMERCIAL TYRE CAPABILITY",
    title: "TRUCK TYRE SERVICES BUILT FOR WORKING VEHICLES",
    intro: "From urgent roadside help to planned tyre supply and fitting, our service is centred on keeping commercial vehicles moving.",
    image: "/images/pack-03-workshop-truck.png",
    imageAlt: "Heavy commercial truck positioned inside a workshop",
    points: ["24/7 roadside assistance", "Commercial truck tyre supply", "Professional truck tyre fitting", "Fleet tyre support", "Visual tyre inspections", "Regency Park workshop service"],
    titleTag: "Truck Tyre Services Adelaide",
    description: "Commercial truck tyre supply, fitting, roadside assistance and fleet support across Adelaide from Regency Park.",
  },
  "24-7-truck-tyre-assistance": {
    slug: "24-7-truck-tyre-assistance",
    eyebrow: "24/7 ROADSIDE SUPPORT",
    title: "TRUCK TYRE TROUBLE DOESN'T KEEP BUSINESS HOURS",
    intro: "When a tyre issue stops your truck, call our team with your location and vehicle details. We will assess the tyre requirement and organise suitable assistance.",
    image: "/images/pack-05-roadside-technician.png",
    imageAlt: "Commercial truck stopped beside the road",
    points: ["Available 24 hours", "Adelaide service coverage", "Support for punctures and failed tyres", "Commercial vehicle focus", "Direct click-to-call access", "Clear information before dispatch"],
    titleTag: "24/7 Truck Tyre Assistance Adelaide",
    description: "Call for 24/7 roadside truck tyre assistance across Adelaide. Commercial tyre support from Regency Park.",
  },
  "truck-tyres": {
    slug: "truck-tyres",
    eyebrow: "COMMERCIAL TYRE SUPPLY",
    title: "THE RIGHT TRUCK TYRE FOR THE WORK AHEAD",
    intro: "We supply commercial truck tyres for different vehicles, axle positions and operating needs. Speak with the team about the correct fit for your truck.",
    image: "/images/pack-07-tyre-warehouse.png",
    imageAlt: "Close view of heavy-duty truck tyre tread",
    points: ["Commercial truck tyres", "Heavy vehicle applications", "Tyre requirement assessment", "Supply and fitting options", "Competitive pricing", "Fleet supply discussions"],
    titleTag: "Truck Tyres Adelaide & Regency Park",
    description: "Commercial truck tyre supply in Adelaide for heavy vehicles, transport operators and fleets. Call our Regency Park team.",
  },
  "truck-tyre-fitting": {
    slug: "truck-tyre-fitting",
    eyebrow: "PROFESSIONAL FITTING",
    title: "COMMERCIAL TYRE FITTING WITH A PRACTICAL FOCUS",
    intro: "Truck tyre fitting requires the right equipment, tyre selection and attention to the vehicle's working demands. We support commercial vehicles at Regency Park and roadside where suitable.",
    image: "/images/pack-04-wheel-fitting.png",
    imageAlt: "Commercial truck wheels inside a tyre workshop",
    points: ["Truck tyre removal and fitting", "Commercial wheel applications", "Workshop service", "Roadside replacement where suitable", "Tyre condition checks", "Fleet vehicle support"],
    titleTag: "Truck Tyre Fitting Adelaide",
    description: "Professional truck tyre fitting for commercial vehicles and fleets in Adelaide. Workshop service in Regency Park.",
  },
  "fleet-tyre-services": {
    slug: "fleet-tyre-services",
    eyebrow: "B2B TYRE SUPPORT",
    title: "FLEET TYRE SUPPORT THAT HELPS REDUCE DOWNTIME",
    intro: "Reliable tyre support helps commercial operators keep vehicles available for work. Discuss planned tyre supply, fitting and ongoing fleet requirements with our team.",
    image: "/images/pack-06-fleet-yard.png",
    imageAlt: "Heavy commercial truck operating on an Australian road",
    points: ["Commercial fleet discussions", "Truck tyre supply", "Planned tyre fitting", "Urgent tyre assistance", "Support from Regency Park", "Direct team contact"],
    titleTag: "Fleet Tyre Services Adelaide",
    description: "Truck tyre supply, fitting and ongoing fleet support for commercial operators across Adelaide.",
  },
  about: {
    slug: "about",
    eyebrow: "ABOUT THE BUSINESS",
    title: "BUILT AROUND KEEPING TRUCKS MOVING",
    intro: "24/7 Truck Tyre Services provides commercial tyre support for truck drivers, transport businesses and fleet operators across Adelaide.",
    image: "/images/pack-09-workshop-team.png",
    imageAlt: "Commercial truck being serviced in an industrial workshop",
    points: ["Tyre supply and fitting", "Urgent roadside assistance", "Commercial vehicle focus", "Regency Park facility", "Practical service", "Director — 24/7 Truck Tyre Services"],
    titleTag: "About 24/7 Truck Tyre Services",
    description: "Commercial truck tyre support for drivers, transport businesses and fleet operators across Adelaide.",
  },
};
