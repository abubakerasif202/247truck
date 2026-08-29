import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${path}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the production homepage", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /24\/7 Truck Tyre Services Adelaide/);
  assert.match(html, /SERVICE WHEN YOU NEED IT/i);
  assert.match(html, /tel:\+61452636802/);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /Regency Park/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("server-renders every requested route", async () => {
  const routes = [
    "/services",
    "/24-7-truck-tyre-assistance",
    "/truck-tyres",
    "/truck-tyre-fitting",
    "/fleet-tyre-services",
    "/about",
    "/gallery",
    "/contact",
  ];
  for (const route of routes) {
    const response = await render(route);
    assert.equal(response.status, 200, route);
    const html = await response.text();
    assert.match(html, /24\/7 Truck Tyre Services/i, route);
    assert.match(html, /tel:\+61452636802/, route);
  }
});
