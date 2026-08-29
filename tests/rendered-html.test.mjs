import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const components = await readFile(new URL("../app/site-components.tsx", import.meta.url), "utf8");
const data = await readFile(new URL("../app/site-data.ts", import.meta.url), "utf8");
const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");

test("homepage retains the business and conversion contracts", () => {
  const source = `${components}\n${data}\n${layout}`;
  assert.match(source, /24\/7 Truck Tyre Services/);
  assert.match(source, /24\/7 emergency/i);
  assert.match(source, /Complete tyre solutions/i);
  assert.match(source, /Trusted by drivers & fleets/i);
  assert.match(source, /tel:\+61452636802/);
  assert.match(source, /Regency Park/);
  assert.doesNotMatch(source, /1300 247 879|Australia-wide|owner portrait/i);
});

test("all requested routes remain configured", () => {
  for (const route of ["services", "24-7-truck-tyre-assistance", "truck-tyres", "truck-tyre-fitting", "fleet-tyre-services", "about"]) {
    assert.match(data, new RegExp(`(?:^|\\n)\\s*[\"']?${route.replaceAll("-", "\\-")}[\"']?\\s*:`));
  }
  assert.match(components, /\/gallery/);
  assert.match(components, /\/contact/);
});
