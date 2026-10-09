// Geography helpers for the page. Coordinates are [lon, lat] unless named.
(function () {
  const R = 3958.8; // earth radius, miles
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;
  const NM_TO_MI = 1.15078;

  function miles([lon1, lat1], [lon2, lat2]) {
    const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function bearing([lon1, lat1], [lon2, lat2]) {
    const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
    const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }

  const COMPASS = ["north", "north-northeast", "northeast", "east-northeast", "east", "east-southeast", "southeast", "south-southeast",
    "south", "south-southwest", "southwest", "west-southwest", "west", "west-northwest", "northwest", "north-northwest"];
  const compass = (b) => COMPASS[Math.round(b / 22.5) % 16];
  const SHORT = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const compassShort = (b) => SHORT[Math.round(b / 22.5) % 16];

  // Flat x/y in miles around a reference latitude (fine at these distances).
  function toXY([lon, lat], lat0) {
    return [lon * 69.17 * Math.cos(rad(lat0)), lat * 69.17];
  }

  function segmentsCross(p1, p2, q1, q2) {
    const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const d1 = d(q1, q2, p1), d2 = d(q1, q2, p2), d3 = d(p1, p2, q1), d4 = d(p1, p2, q2);
    return d1 * d2 < 0 && d3 * d4 < 0;
  }

  // Where along the forecast the storm center is at a given time.
  function positionAt(points, t) {
    if (t <= points[0].time) return [points[0].lon, points[0].lat];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      if (t <= b.time) {
        const f = (t - a.time) / (b.time - a.time);
        return [a.lon + (b.lon - a.lon) * f, a.lat + (b.lat - a.lat) * f];
      }
    }
    const z = points[points.length - 1];
    return [z.lon, z.lat];
  }

  // NHC wind radii (nautical miles, by quadrant) interpolated in time.
  function radiusAt(radii, points, kt, t, quadrant) {
    const byTau = radii.filter((r) => r.kt === kt);
    const tauTime = (tau) => {
      const p = points.find((p) => p.tau === tau);
      return p ? p.time : null;
    };
    const rows = byTau.map((r) => ({ time: tauTime(r.tau), nm: r[quadrant] || 0 })).filter((r) => r.time != null);
    // A forecast time with no row for this wind speed means the storm no longer has winds that strong.
    for (const p of points) {
      if (!rows.some((r) => r.time === p.time)) rows.push({ time: p.time, nm: 0 });
    }
    rows.sort((a, b) => a.time - b.time);
    if (!rows.length || t < rows[0].time || t > rows[rows.length - 1].time) return 0;
    for (let i = 0; i < rows.length - 1; i++) {
      const a = rows[i], b = rows[i + 1];
      if (t <= b.time) return (a.nm + (b.nm - a.nm) * ((t - a.time) / (b.time - a.time))) * NM_TO_MI;
    }
    return rows[rows.length - 1].nm * NM_TO_MI;
  }

  function quadrantOf(b) {
    if (b < 90) return "ne";
    if (b < 180) return "se";
    if (b < 270) return "sw";
    return "nw";
  }

  // Step through the forecast every 30 minutes: when does each wind-speed
  // band first reach the address, and how close does the center come?
  function windTimeline(points, radii, addr) {
    const start = points[0].time, end = points[points.length - 1].time;
    const out = { first: { 34: null, 50: null, 64: null }, closest: null };
    for (let t = start; t <= end; t += 30 * 60000) {
      const c = positionAt(points, t);
      const dist = miles(c, addr);
      if (!out.closest || dist < out.closest.miles) out.closest = { miles: dist, time: t, center: c };
      const q = quadrantOf(bearing(c, addr));
      for (const kt of [34, 50, 64]) {
        if (out.first[kt] == null && dist <= radiusAt(radii, points, kt, t, q)) out.first[kt] = t;
      }
    }
    return out;
  }

  // NHC arrival-time maps are drawn as contour lines. Walk from the storm
  // center to the address; the contours crossed bracket the arrival time.
  function arrivalBracket(contours, center, addr) {
    if (!contours || !contours.length) return null;
    const lat0 = addr[1];
    const A = toXY(center, lat0), B = toXY(addr, lat0);
    let lastCrossed = -1;
    contours.forEach((c, i) => {
      const crossed = c.lines.some((line) => {
        for (let k = 0; k < line.length - 1; k++) {
          if (segmentsCross(A, B, toXY(line[k], lat0), toXY(line[k + 1], lat0))) return true;
        }
        return false;
      });
      if (crossed) lastCrossed = i;
    });
    if (lastCrossed === -1) return { before: contours[0].label };
    if (lastCrossed === contours.length - 1) return { after: contours[lastCrossed].label };
    return { from: contours[lastCrossed].label, to: contours[lastCrossed + 1].label };
  }

  // Which side of the track a place is on, looking the way the storm moves.
  function sideOfTrack(crossing, heading, p) {
    const b = bearing([crossing.lon, crossing.lat], p);
    const diff = (b - heading + 360) % 360;
    if (miles([crossing.lon, crossing.lat], p) < 3) return "on the track";
    return diff > 0 && diff < 180 ? "right" : "left";
  }

  // Choose a handful of coastal places on either side of, and between,
  // the address and the estimated crossing.
  function pickPlaces(candidates, addr, crossing, heading) {
    const lat0 = (addr[1] + crossing[1]) / 2;
    const C = toXY(crossing, lat0);
    let A = toXY(addr, lat0);
    let L = Math.hypot(C[0] - A[0], C[1] - A[1]);
    let u;
    if (L < 15) {
      // Address is near the crossing: lay the axis across the track instead.
      const h = rad(heading + 90);
      u = [Math.sin(h), Math.cos(h)];
      A = [C[0] - u[0] * 40, C[1] - u[1] * 40];
      L = 80;
    } else {
      u = [(C[0] - A[0]) / L, (C[1] - A[1]) / L];
    }
    const scored = candidates
      .map((p) => {
        const P = toXY([p.lon, p.lat], lat0);
        const v = [P[0] - A[0], P[1] - A[1]];
        return { ...p, t: v[0] * u[0] + v[1] * u[1], off: Math.abs(v[0] * u[1] - v[1] * u[0]) };
      })
      .filter((p) => p.off <= 14 && p.t >= -45 && p.t <= L + 45);

    const targets = [-30, -12];
    for (let k = 1; k <= 4; k++) targets.push((L * k) / 5);
    targets.push(L + 12, L + 30);

    const chosen = [];
    for (const target of targets) {
      let best = null, bestScore = Infinity;
      for (const p of scored) {
        if (chosen.includes(p)) continue;
        if (chosen.some((c) => miles([c.lon, c.lat], [p.lon, p.lat]) < 5)) continue;
        if (miles([p.lon, p.lat], addr) < 3 || miles([p.lon, p.lat], crossing) < 3) continue;
        const score = Math.abs(p.t - target) + p.off * 0.4 - (p.landmark ? 4 : 0);
        if (score < bestScore && Math.abs(p.t - target) < 14) { best = p; bestScore = score; }
      }
      if (best) chosen.push(best);
    }
    return { places: chosen, axis: { A, u, lat0 } };
  }

  function alongAxis(axis, p) {
    const P = toXY(p, axis.lat0);
    return (P[0] - axis.A[0]) * axis.u[0] + (P[1] - axis.A[1]) * axis.u[1];
  }

  window.Geo = { miles, bearing, compass, compassShort, positionAt, windTimeline, arrivalBracket, sideOfTrack, pickPlaces, alongAxis };
})();
