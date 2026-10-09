// Small geography helpers shared by the server functions.
// Coordinates are [longitude, latitude] in degrees unless named otherwise.

const R_MILES = 3958.8;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

export function milesBetween([lon1, lat1], [lon2, lat2]) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_MILES * Math.asin(Math.sqrt(a));
}

// --- Land test against the shipped coastline polygons -----------------------

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function makeLandTest(coast) {
  const polys = coast.polygons;
  return function onLand([x, y]) {
    for (const p of polys) {
      const b = p.b;
      if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
      if (!inRing(x, y, p.r[0])) continue;
      let inHole = false;
      for (let k = 1; k < p.r.length; k++) {
        if (inRing(x, y, p.r[k])) { inHole = true; break; }
      }
      if (!inHole) return true;
    }
    return false;
  };
}

// --- Where the forecast track first crosses the shoreline -------------------
//
// points: [{ lon, lat, time (ms), tau, windMph, label }...] in time order.
// The track between NHC forecast points is drawn as straight lines, so the
// same straight-line interpolation is used here. The result is an estimate,
// not an NHC product.

export function findCoastCrossing(points, onLand) {
  if (points.length < 2) return null;
  const start = [points[0].lon, points[0].lat];
  if (onLand(start)) {
    return { status: "over-land", lon: start[0], lat: start[1], time: points[0].time };
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const segMiles = milesBetween([a.lon, a.lat], [b.lon, b.lat]);
    const steps = Math.max(2, Math.ceil(segMiles / 0.5)); // sample every half mile
    let prevF = 0;
    for (let s = 1; s <= steps; s++) {
      const f = s / steps;
      const p = [a.lon + (b.lon - a.lon) * f, a.lat + (b.lat - a.lat) * f];
      if (onLand(p)) {
        // refine between the last water sample and this land sample
        let lo = prevF;
        let hi = f;
        for (let k = 0; k < 25; k++) {
          const mid = (lo + hi) / 2;
          const q = [a.lon + (b.lon - a.lon) * mid, a.lat + (b.lat - a.lat) * mid];
          if (onLand(q)) hi = mid;
          else lo = mid;
        }
        const lon = a.lon + (b.lon - a.lon) * hi;
        const lat = a.lat + (b.lat - a.lat) * hi;
        return {
          status: "crossing",
          lon,
          lat,
          time: a.time + (b.time - a.time) * hi,
          before: a,   // last NHC point offshore
          after: b,    // next NHC point
          heading: bearingDeg([a.lon, a.lat], [b.lon, b.lat]),
        };
      }
      prevF = f;
    }
  }
  return { status: "no-crossing" };
}

export function bearingDeg([lon1, lat1], [lon2, lat2]) {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
