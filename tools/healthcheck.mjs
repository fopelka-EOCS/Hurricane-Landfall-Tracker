// Health check for the Hurricane Landfall Tracker.
//
// Confirms that every outside source still answers in the shape the site
// expects, and that the live site works end to end. Run by GitHub on a
// schedule (see .github/workflows/health-check.yml), or by hand:
//
//   node tools/healthcheck.mjs            # prints a report, exits 1 on any failure
//   node tools/healthcheck.mjs --out report.md
//
// No packages needed. Each check retries a few times so a one-minute blip at
// NOAA doesn't raise a false alarm.

import fs from "node:fs";
import { parseAdvisory, publicAdvisory, MAP_SERVICE, NHC_STORMS_URL } from "../lib/nhc.mjs";

const SITE = process.env.SITE_URL || "https://www.landfalltracker.org";
const UA = "HurricaneLandfallTracker-HealthCheck/1.0 (contact fopelka@eocs.ltd)";
// A public address and point used only for testing (not anyone's home).
const TEST_ADDRESS = "1600 Pennsylvania Ave NW, Washington, DC 20500";
const TEST_POINT = "30.4213,-87.2169"; // downtown Pensacola, FL

const results = [];

async function fetchWithRetry(url, opts = {}, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        ...opts,
        headers: { "User-Agent": UA, ...(opts.headers || {}) },
        signal: AbortSignal.timeout(25000),
      });
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      lastErr = err;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, Number(process.env.RETRY_MS || 15000)));
    }
  }
  throw lastErr;
}

async function getJSON(url, opts) {
  const res = await fetchWithRetry(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function expect(cond, message) {
  if (!cond) throw new Error(message);
}

async function check(group, name, fn) {
  const started = Date.now();
  try {
    const note = await fn();
    results.push({ group, name, ok: true, note: note || "", ms: Date.now() - started });
  } catch (err) {
    results.push({ group, name, ok: false, note: err.message, ms: Date.now() - started });
  }
}

// ---------------------------------------------------------------------------
// 1. Outside sources
// ---------------------------------------------------------------------------
let storms = [];

await check("Sources", "NHC active-storm list", async () => {
  const d = await getJSON(NHC_STORMS_URL);
  expect(Array.isArray(d.activeStorms), "activeStorms list is missing — NHC changed the file format");
  for (const s of d.activeStorms) {
    expect(s.id && s.binNumber && s.name, `storm entry is missing id/binNumber/name: ${JSON.stringify(s).slice(0, 120)}`);
    expect(s.publicAdvisory && s.publicAdvisory.url, `${s.name}: public advisory link is missing`);
  }
  storms = d.activeStorms;
  return storms.length ? `${storms.length} active: ${storms.map((s) => s.name).join(", ")}` : "no active storms (normal off-season)";
});

let layerNames = new Set();
await check("Sources", "NOAA forecast map service (layer names)", async () => {
  const d = await getJSON(`${MAP_SERVICE}?f=json`);
  expect(Array.isArray(d.layers), "layer list is missing — the map service may have moved");
  layerNames = new Set(d.layers.map((l) => l.name));
  const needed = ["Forecast Points", "Forecast Track", "Forecast Cone", "Watch-Warning",
    "Forecast Wind Radii", "Most Likely Arrival Time", "Earliest Reasonable Arrival Time", "Past Track"];
  const missing = [];
  for (const bin of ["AT1", "EP1"]) for (const n of needed) if (!layerNames.has(`${bin} ${n}`)) missing.push(`${bin} ${n}`);
  if (!layerNames.has("Image_Inun_AT1")) missing.push("Image_Inun_AT1");
  expect(!missing.length, `layers renamed or removed: ${missing.join(", ")}`);
  return `${d.layers.length} layers, all expected names present`;
});

await check("Sources", "NOAA forecast map service (query)", async () => {
  const id = [...(await getJSON(`${MAP_SERVICE}?f=json`)).layers].find((l) => l.name === "AT1 Forecast Points")?.id;
  expect(id != null, "AT1 Forecast Points layer not found");
  const fc = await getJSON(`${MAP_SERVICE}/${id}/query?where=1%3D1&outFields=*&outSR=4326&f=geojson`);
  expect(fc.type === "FeatureCollection" && Array.isArray(fc.features), "query no longer returns GeoJSON");
  return `GeoJSON OK (${fc.features.length} features in slot AT1)`;
});

await check("Sources", "NHC advisory text reader (saved sample)", async () => {
  const text = fs.readFileSync(new URL("./fixtures/nhc-public-advisory-sample.txt", import.meta.url), "utf8");
  const a = parseAdvisory(text);
  expect(a.summary.LOCATION, "could not read the storm location");
  expect(a.warnings.length > 0, "could not read watches and warnings");
  expect(a.hazards.storm_surge && a.hazards.storm_surge.list.length > 0, "could not read the storm surge list");
  expect(a.next.length > 0, "could not read next-advisory times");
  return "reads location, warnings, surge, next advisory";
});

for (const s of storms) {
  await check("Sources", `NHC advisory text: ${s.name}`, async () => {
    const a = await publicAdvisory(s.publicAdvisory.url);
    expect(a.summary.LOCATION, "location line not found — advisory layout may have changed");
    expect(a.next.length > 0 || /final/i.test(a.headlines.join(" ")), "next-advisory section not found");
    return `advisory ${a.number || "?"}: ${a.summary.LOCATION}`;
  });
}

await check("Sources", "National Weather Service alerts", async () => {
  const d = await getJSON(`https://api.weather.gov/alerts/active?point=${TEST_POINT}`, { headers: { Accept: "application/geo+json" } });
  expect(d.type === "FeatureCollection" && Array.isArray(d.features), "alerts no longer return GeoJSON");
  return `${d.features.length} alerts at test point`;
});

await check("Sources", "Census address lookup", async () => {
  const d = await getJSON("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=" + encodeURIComponent(TEST_ADDRESS));
  const m = d?.result?.addressMatches?.[0];
  expect(m && m.coordinates && typeof m.coordinates.y === "number", "no match or new response shape (benchmark name may have changed)");
  return m.matchedAddress;
});

await check("Sources", "USGS base map tiles", async () => {
  const res = await fetchWithRetry("https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/6/26/16");
  expect(res.ok && (res.headers.get("content-type") || "").startsWith("image/"), `tile request returned ${res.status} ${res.headers.get("content-type")}`);
  return "tile image OK";
});

// ---------------------------------------------------------------------------
// 2. The live site, end to end
// ---------------------------------------------------------------------------
await check("Live site", "Home page", async () => {
  const res = await fetchWithRetry(`${SITE}/`);
  const html = await res.text();
  expect(res.ok && html.includes("Hurricane Landfall Tracker"), `home page returned ${res.status}`);
  return `${SITE} OK`;
});

await check("Live site", "Storm list helper", async () => {
  const d = await getJSON(`${SITE}/api/storms`);
  expect(Array.isArray(d.storms), "storms list missing");
  return `${d.storms.length} storms`;
});

for (const s of storms) {
  await check("Live site", `Forecast helper: ${s.name}`, async () => {
    const d = await getJSON(`${SITE}/api/forecast?storm=${s.id}`);
    expect(d.points && d.points.length >= 1, "no forecast points");
    expect(d.crossing && d.crossing.status, "no coast-crossing result");
    const c = d.crossing.status === "crossing" ? ` — crossing ${d.crossing.lat.toFixed(2)}, ${d.crossing.lon.toFixed(2)}` : ` — ${d.crossing.status}`;
    return `${d.points.length} points, cone ${d.cone ? "yes" : "no"}${c}`;
  });
}

await check("Live site", "Address lookup helper", async () => {
  const d = await getJSON(`${SITE}/api/geocode?address=${encodeURIComponent(TEST_ADDRESS)}`);
  expect(typeof d.lat === "number" && typeof d.lon === "number", "no coordinates returned");
  return d.matched;
});

await check("Live site", "Coastal places file", async () => {
  const d = await getJSON(`${SITE}/data/places.json`);
  expect(Array.isArray(d.places) && d.places.length > 1000, "places list missing or short");
  return `${d.places.length} places`;
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
const stamp = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
let md = `# Health check — ${failed.length ? `❌ ${failed.length} problem${failed.length > 1 ? "s" : ""}` : "✅ all clear"}\n\n`;
md += `Checked ${stamp} against ${SITE}\n\n| | Check | Result |\n|---|---|---|\n`;
for (const r of results) md += `| ${r.ok ? "✅" : "❌"} | ${r.group}: ${r.name} | ${r.note.replace(/\|/g, "/")} |\n`;
if (failed.length) {
  md += `\n## What to do\n\n`;
  md += `Something the site depends on has changed or is down. Press **Run workflow** on the Actions tab to re-check; if it still fails, ask Claude: "The landfall tracker health check is failing" and share this report.\n`;
}
console.log(md);
const outIdx = process.argv.indexOf("--out");
if (outIdx > -1) fs.writeFileSync(process.argv[outIdx + 1], md);
process.exit(failed.length ? 1 : 0);
