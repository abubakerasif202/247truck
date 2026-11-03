import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/site-components.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/home-redesign.module.css", import.meta.url), "utf8");

test("homepage booking actions reuse the booking route and mobile emergency bar", () => {
  assert.match(source, /Book Truck Wheel Alignment/);
  assert.match(source, /data-home-booking/);
  assert.match(source, /pathname === "\/"/);
  assert.match(source, /href="\/book-wheel-alignment"/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /bookingCard:focus-visible/);
});

test("automotive enquiry is prominent on homepage and automotive detail page", () => {
  assert.match(source, /Need Car Servicing or Repairs\? Contact Us/);
  assert.match(source, /page.slug === "automotive-repairs" && <AutomotiveEnquiry/);
  assert.match(source, /function AutomotiveEnquiry/);
});

test("wheel alignment is featured in the homepage top nav and hero", () => {
  assert.match(source, /\["Wheel Alignment", "\/book-wheel-alignment"\]/);
  assert.match(source, /homeDesign\.alignmentNavLink/);
  assert.match(source, /className=\{homeDesign\.alignmentHeroLink\}/);
  assert.match(source, /Choose a workshop appointment/);
  assert.match(css, /\.alignmentHeroLink:focus-visible/);
  assert.match(css, /@media \(max-width: 1180px\)/);
});
