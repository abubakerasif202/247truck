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
