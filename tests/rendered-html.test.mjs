import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const components = await readFile(new URL("../app/site-components.tsx", import.meta.url), "utf8");
const data = await readFile(new URL("../app/site-data.ts", import.meta.url), "utf8");
const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

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

test("official imagery, Instagram and map contracts are complete", async () => {
  const source = `${components}\n${data}\n${layout}\n${styles}`;
  const imageFiles = await readdir(new URL("../public/images/", import.meta.url));
  assert.deepEqual(imageFiles.sort(), [
    "pack-01-hero-roadside.png",
    "pack-02-tyre-banner.png",
    "pack-03-workshop-truck.png",
    "pack-04-wheel-fitting.png",
    "pack-05-roadside-technician.png",
    "pack-06-fleet-yard.png",
    "pack-07-tyre-warehouse.png",
    "pack-08-rescue-van.png",
    "pack-09-workshop-team.png",
    "pack-10-facility-exterior.png",
  ]);
  for (const file of imageFiles) assert.match(source, new RegExp(file.replaceAll(".", "\\.")));
  assert.match(source, /https:\/\/www\.instagram\.com\/247trucktyreservice/);
  assert.match(source, /google\.com\/maps\/embed\?pb=!1m18!1m12!1m3!1d3893\.3547912856266/);
  assert.doesNotMatch(source, /illustrative service imagery|hero-truck\.jpg|roadside-truck\.jpg|tyre-closeup\.jpg/i);
});

test("all requested routes remain configured", () => {
  for (const route of ["services", "24-7-truck-tyre-assistance", "truck-tyres", "truck-tyre-fitting", "fleet-tyre-services", "about"]) {
    assert.match(data, new RegExp(`(?:^|\\n)\\s*[\"']?${route.replaceAll("-", "\\-")}[\"']?\\s*:`));
  }
  assert.match(components, /\/gallery/);
  assert.match(components, /\/contact/);
});
