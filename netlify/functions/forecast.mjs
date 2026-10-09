// GET /api/forecast?storm=al092026
// Everything storm-wide: NHC forecast points, cone, warnings, wind radii,
// arrival-time contours, the public advisory text, and our estimated
// coast crossing. Nothing about the visitor's address is sent here.

import coast from "../../data/coast.mjs";
import { findCoastCrossing, makeLandTest } from "../../lib/geo.mjs";
import {
  activeStorms, categoryFromKt, forecastLayers, ktToMph, publicAdvisory, MAP_SERVICE,
} from "../../lib/nhc.mjs";
import { json, fail } from "../../lib/http.mjs";

const onLand = makeLandTest(coast);

const TCWW = {
  HWR: { label: "Hurricane Warning", rank: 1 },
  HWA: { label: "Hurricane Watch", rank: 3 },
  TWR: { label: "Tropical Storm Warning", rank: 2 },
  TWA: { label: "Tropical Storm Watch", rank: 4 },
};

// NHC forecast points carry their valid time as "DD/HHMM" in UTC.
function validTime(dayHHMM, issuedIso) {
  const issued = new Date(issuedIso);
  const [d, hm] = dayHHMM.split("/");
  const t = new Date(Date.UTC(issued.getUTCFullYear(), issued.getUTCMonth(), Number(d),
    Number(hm.slice(0, 2)), Number(hm.slice(2) || 0)));
  if (t.getTime() < issued.getTime() - 15 * 86400000) t.setUTCMonth(t.getUTCMonth() + 1);
  return t.getTime();
}

const lines = (g) => (g.type === "MultiLineString" ? g.coordinates : [g.coordinates]);

export default async (req) => {
  const id = new URL(req.url).searchParams.get("storm") || "";
  try {
    const storms = await activeStorms();
    const storm = storms.find((s) => s.id === id.toLowerCase());
    if (!storm) return fail(404, "That storm is no longer active, or the ID is wrong.");

    const issuedIso = storm.advisory?.issuance || storm.lastUpdate;
    const [layers, advisory] = await Promise.all([
      forecastLayers(storm.bin),
      storm.advisory?.url ? publicAdvisory(storm.advisory.url).catch(() => null) : null,
    ]);

    const points = layers.points
      .map((f) => {
        const p = f.properties;
        const [lon, lat] = f.geometry.coordinates;
        const tau = Number(p.tau);
        return {
          lon: Math.round(lon * 100) / 100,
          lat: Math.round(lat * 100) / 100,
          tau,
          time: tau === 0 ? new Date(issuedIso).getTime() : validTime(p.validtime, issuedIso),
          label: p.datelbl,
          windMph: ktToMph(Number(p.maxwind)),
          gustMph: ktToMph(Number(p.gust)),
          category: ["HU", "MH"].includes(p.stormtype) ? categoryFromKt(Number(p.maxwind)) : 0,
          type: p.tcdvlp,
        };
      })
      .sort((a, b) => a.tau - b.tau);

    const crossing = findCoastCrossing(points, onLand);

    const radii = layers.radii
      .map((f) => {
        const p = f.properties;
        return {
          kt: Number(p.radii),
          tau: Number(p.tau),
          ne: Number(p.ne), se: Number(p.se), sw: Number(p.sw), nw: Number(p.nw),
        };
      })
      .sort((a, b) => a.tau - b.tau || a.kt - b.kt);

    const contour = (fs) =>
      fs
        .filter((f) => (f.properties.arrival_time || "").trim())
        .map((f) => ({ label: f.properties.arrival_time.trim(), lines: lines(f.geometry) }));

    const warnings = layers.warnings
      .map((f) => {
        const code = f.properties.tcww;
        const meta = TCWW[code] || { label: code, rank: 9 };
        return { code, label: meta.label, rank: meta.rank, lines: lines(f.geometry) };
      })
      .sort((a, b) => b.rank - a.rank);

    return json(
      {
        storm,
        advisory,
        points,
        cone: layers.cone[0]?.geometry || null,
        pastTrack: layers.pastTrack.flatMap((f) => lines(f.geometry)),
        warnings,
        radii,
        arrival: { mostLikely: contour(layers.mostLikely), earliest: contour(layers.earliest) },
        surge: layers.surgeImageLayer != null
          ? { exportUrl: `${MAP_SERVICE}/export`, layer: layers.surgeImageLayer }
          : null,
        crossing,
        fetchedAt: new Date().toISOString(),
      },
      180
    );
  } catch (err) {
    return fail(502, `Could not reach the National Hurricane Center just now (${err.message}). Try Update again in a minute.`);
  }
};

export const config = { path: "/api/forecast" };
