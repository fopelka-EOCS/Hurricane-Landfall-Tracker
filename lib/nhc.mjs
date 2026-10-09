// Reads National Hurricane Center products. Everything here is public NOAA data.

export const NHC_STORMS_URL = "https://www.nhc.noaa.gov/CurrentStorms.json";
export const MAP_SERVICE =
  "https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer";
const UA = "HurricaneLandfallTracker/1.0 (public service; contact fopelka@eocs.ltd)";

// Small in-memory cache so a burst of visitors doesn't repeat the same requests.
const memo = new Map();
async function cached(key, ttlMs, fn) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fn();
  memo.set(key, { at: Date.now(), value });
  return value;
}

export async function getText(url, timeoutMs = 15000) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "*/*" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.text();
}

export async function getJSON(url, timeoutMs = 15000) {
  return JSON.parse(await getText(url, timeoutMs));
}

// --- Storm list ----------------------------------------------------------------

const CLASS_LABEL = {
  HU: "Hurricane",
  TS: "Tropical Storm",
  TD: "Tropical Depression",
  STS: "Subtropical Storm",
  SD: "Subtropical Depression",
  PTC: "Potential Tropical Cyclone",
  PC: "Post-Tropical Cyclone",
  TY: "Typhoon",
};

export const ktToMph = (kt) => Math.round((kt * 1.15078) / 5) * 5;

export function categoryFromKt(kt) {
  if (kt >= 137) return 5;
  if (kt >= 113) return 4;
  if (kt >= 96) return 3;
  if (kt >= 83) return 2;
  if (kt >= 64) return 1;
  return 0;
}

export async function activeStorms() {
  const raw = await cached("storms", 120_000, () => getJSON(NHC_STORMS_URL));
  return (raw.activeStorms || []).map((s) => {
    const kt = Number(s.intensity);
    return {
      id: s.id,
      name: s.name,
      bin: s.binNumber,
      basin: s.id.slice(0, 2).toUpperCase(),
      classification: s.classification,
      label: CLASS_LABEL[s.classification] || s.classification,
      windMph: ktToMph(kt),
      windKt: kt,
      category: s.classification === "HU" ? categoryFromKt(kt) : 0,
      pressureMb: Number(s.pressure) || null,
      lat: s.latitudeNumeric,
      lon: s.longitudeNumeric,
      movementDir: s.movementDir,
      movementMph: s.movementSpeed,
      lastUpdate: s.lastUpdate,
      advisory: s.publicAdvisory || null,
      graphicsUrl: s.forecastGraphics?.url || null,
      discussionUrl: s.forecastDiscussion?.url || null,
    };
  });
}

// --- Forecast map layers ----------------------------------------------------------

async function layerIndex() {
  return cached("layers", 3_600_000, async () => {
    const svc = await getJSON(`${MAP_SERVICE}?f=json`);
    const byName = {};
    for (const l of svc.layers || []) byName[l.name] = l.id;
    return byName;
  });
}

async function queryLayer(id) {
  if (id == null) return [];
  const url = `${MAP_SERVICE}/${id}/query?where=1%3D1&outFields=*&outSR=4326&f=geojson`;
  const fc = await getJSON(url, 20000);
  return fc.features || [];
}

export async function forecastLayers(bin) {
  const idx = await layerIndex();
  const want = {
    points: `${bin} Forecast Points`,
    track: `${bin} Forecast Track`,
    cone: `${bin} Forecast Cone`,
    warnings: `${bin} Watch-Warning`,
    radii: `${bin} Forecast Wind Radii`,
    earliest: `${bin} Earliest Reasonable Arrival Time`,
    mostLikely: `${bin} Most Likely Arrival Time`,
    pastTrack: `${bin} Past Track`,
  };
  const keys = Object.keys(want);
  const results = await Promise.all(
    keys.map((k) => queryLayer(idx[want[k]]).catch(() => []))
  );
  const out = {};
  keys.forEach((k, i) => (out[k] = results[i]));
  out.surgeImageLayer = idx[`Image_Inun_${bin}`] ?? null;
  return out;
}

// --- Public advisory text -----------------------------------------------------

const stripTags = (s) =>
  s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

export async function publicAdvisory(url) {
  const html = await getText(url);
  const m = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  const text = stripTags(m ? m[1] : html).replace(/\r/g, "");
  return parseAdvisory(text);
}

function section(text, title) {
  // Sections look like:  TITLE\n-----\nbody ... until the next TITLE\n----
  const re = new RegExp(`\\n${title}\\s*\\n-+\\n([\\s\\S]*?)(?=\\n[A-Z][A-Z ]+\\n-{4,}\\n|\\n\\$\\$|$)`);
  const m = text.match(re);
  return m ? m[1].trim() : "";
}

const paras = (s) =>
  s.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);

export function parseAdvisory(text) {
  const out = { headlines: [], summary: {}, warnings: [], discussion: [], hazards: {}, next: [], issued: "" };

  const issued = text.match(/\n(\d{3,4} (?:AM|PM) [A-Z]{3} \w{3} \w{3} \d{1,2} \d{4})\n/);
  if (issued) out.issued = issued[1];
  const num = text.match(/Advisory Number\s+(\w+)/i);
  if (num) out.number = num[1];

  for (const h of text.matchAll(/(?<=\n)\.\.\.([\s\S]*?)\.\.\.\.?\s*(?=\n)/g)) {
    const line = h[1].replace(/\s*\n\s*/g, " ").trim();
    if (line && line.length < 200) out.headlines.push(line);
  }

  const summaryTitle = text.match(/\n(SUMMARY OF [^\n]*INFORMATION)\n-+\n([\s\S]*?)\n\s*\n/);
  if (summaryTitle) {
    for (const line of summaryTitle[2].split("\n")) {
      const kv = line.match(/^([A-Z ]+)\.\.\.(.*)$/);
      if (kv) out.summary[kv[1].trim()] = kv[2].trim();
    }
  }

  const ww = section(text, "WATCHES AND WARNINGS");
  const inEffect = ww.split("SUMMARY OF WATCHES AND WARNINGS IN EFFECT:")[1] || "";
  const changes = (ww.split("SUMMARY OF WATCHES AND WARNINGS IN EFFECT:")[0] || "")
    .replace("CHANGES WITH THIS ADVISORY:", "").trim();
  out.warningChanges = paras(changes);
  for (const block of inEffect.matchAll(/An? ([A-Za-z ]+?) is in effect for\.\.\.\n((?:\* .*\n?)+)/g)) {
    out.warnings.push({
      type: block[1].trim(),
      areas: block[2].split("\n").map((l) => l.replace(/^\*\s*/, "").trim()).filter(Boolean),
    });
  }

  out.discussion = paras(section(text, "DISCUSSION AND OUTLOOK"));

  const hz = section(text, "HAZARDS AFFECTING LAND");
  const parts = hz.split(/\n(?=[A-Z][A-Z ]+:)/);
  for (const p of parts) {
    const m = p.match(/^([A-Z][A-Z ]+):\s*([\s\S]*)$/);
    if (!m) continue;
    const key = m[1].trim().toLowerCase().replace(/\s+/g, "_");
    const body = m[2];
    if (key === "storm_surge") {
      const list = [];
      for (const l of body.matchAll(/^(.+?)\.\.\.(\d+(?:-\d+)?\s*ft)\s*$/gm)) {
        list.push({ area: l[1].trim(), height: l[2].replace(/\s+/g, " ") });
      }
      const ps = paras(body.replace(/^(.+?)\.\.\.(\d+(?:-\d+)?\s*ft)\s*$/gm, ""));
      out.hazards.storm_surge = { intro: ps[0] || "", list, notes: ps.slice(1) };
    } else {
      out.hazards[key] = paras(body);
    }
  }

  out.next = section(text, "NEXT ADVISORY").split("\n").map((s) => s.trim()).filter(Boolean);
  const fc = text.match(/\$\$\s*\nForecaster\s+([^\n]+)/);
  if (fc) out.forecaster = fc[1].trim();
  return out;
}
