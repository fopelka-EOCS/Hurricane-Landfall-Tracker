// Hurricane Landfall Tracker — page logic.
(function () {
  "use strict";
  const CFG = window.TRACKER_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
  };

  const state = { storms: [], stormId: null, fc: null, addr: null, alerts: null, places: null, checkedAt: null };

  // ---------- formatting ----------
  const tzOpts = { weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short" };
  const fmtTime = (ms) => new Date(ms).toLocaleString([], tzOpts);
  const fmtHour = (ms) => {
    const d = new Date(Math.round(ms / 3600000) * 3600000);
    return d.toLocaleString([], { weekday: "short", hour: "numeric", timeZoneName: "short" });
  };
  const fmtLatLon = (lat, lon) => `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(2)}°${lon <= 0 ? "W" : "E"}`;
  const mi = (n) => (n < 10 ? n.toFixed(1) : Math.round(n)) + " mi";
  const catText = (p) => (p.category > 0 ? `Category ${p.category}` : p.type || "");
  const BASIN = { AL: "Atlantic", EP: "Eastern Pacific", CP: "Central Pacific" };

  function setStatus(msg, kind) {
    const el = $("status");
    el.textContent = msg || "";
    el.className = "status" + (kind ? " " + kind : "");
  }

  async function getJSON(url) {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    let body = null;
    try { body = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) throw new Error((body && body.error) || `Request failed (${res.status})`);
    return body;
  }

  // ---------- map ----------
  const map = L.map("map", { zoomControl: true, worldCopyJump: true }).setView([27, -85], 5);
  const topo = L.tileLayer("https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 16, attribution: 'Base map: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS The National Map</a>',
  }).addTo(map);
  const imagery = L.tileLayer("https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 16, attribution: 'Base map: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS The National Map</a>',
  });
  L.control.layers({ "Map": topo, "Satellite": imagery }, null, { position: "topright" }).addTo(map);
  L.control.scale({ imperial: true, metric: false }).addTo(map);

  const stormLayer = L.layerGroup().addTo(map);
  const personalLayer = L.layerGroup().addTo(map);
  const gridLayer = L.layerGroup().addTo(map);
  let surgeOverlay = null;

  const WARN_COLORS = { HWR: "#d6372b", HWA: "#f39ac0", TWR: "#2f6fd6", TWA: "#f2d43b" };
  const CAT_COLORS = ["#5b8def", "#f5c542", "#f39a2c", "#e8562a", "#c42b2b", "#8e1a5e"];
  const ll = ([lon, lat]) => [lat, lon];

  function drawStorm() {
    stormLayer.clearLayers();
    const fc = state.fc;
    if (!fc) return;
    if (fc.cone) {
      const rings = fc.cone.type === "MultiPolygon" ? fc.cone.coordinates.flat() : fc.cone.coordinates;
      L.polygon(rings.map((r) => r.map(ll)), { color: "#5d6b7a", weight: 1, fillColor: "#ffffff", fillOpacity: 0.38, interactive: false }).addTo(stormLayer);
    }
    for (const w of fc.warnings) {
      for (const line of w.lines) {
        L.polyline(line.map(ll), { color: WARN_COLORS[w.code] || "#888", weight: 5, opacity: 0.85, lineCap: "butt" })
          .bindTooltip(w.label, { sticky: true }).addTo(stormLayer);
      }
    }
    for (const line of fc.pastTrack) {
      L.polyline(line.map(ll), { color: "#4b5563", weight: 2, dashArray: "4 5", interactive: false }).addTo(stormLayer);
    }
    const pts = fc.points;
    L.polyline(pts.map((p) => [p.lat, p.lon]), { color: "#111827", weight: 2.5, interactive: false }).addTo(stormLayer);
    pts.forEach((p, i) => {
      const m = L.circleMarker([p.lat, p.lon], {
        radius: i === 0 ? 9 : 7, color: "#111827", weight: 1.5, fillColor: CAT_COLORS[p.category] || "#5b8def", fillOpacity: 1,
      }).addTo(stormLayer);
      m.bindTooltip(`<strong>${esc(p.label)}</strong><br>${p.windMph} mph · ${esc(catText(p))}${i === 0 ? "<br>Current position" : ""}`, {
        permanent: true, direction: "right", offset: [8, 0], className: "pt-label",
      });
    });
    const c = fc.crossing;
    if (c && c.status === "crossing") {
      L.circleMarker([c.lat, c.lon], { radius: 11, color: "#6d28d9", weight: 3, fill: false }).addTo(stormLayer);
      L.circleMarker([c.lat, c.lon], { radius: 3, color: "#6d28d9", weight: 1, fillColor: "#6d28d9", fillOpacity: 1 })
        .bindTooltip(`<strong>Estimated coast crossing</strong><br>${fmtLatLon(c.lat, c.lon)}<br>around ${esc(fmtHour(c.time))}`, { direction: "left", offset: [-10, 0] })
        .addTo(stormLayer);
    }
    refreshSurge();
  }

  function drawPersonal(placesShown) {
    personalLayer.clearLayers();
    if (state.addr) {
      const icon = L.divIcon({ className: "home-pin", html: '<svg viewBox="0 0 24 24"><path d="M12 2C7.6 2 4 5.4 4 9.7 4 15.3 12 22 12 22s8-6.7 8-12.3C20 5.4 16.4 2 12 2z" fill="#b91c1c" stroke="#fff" stroke-width="1.5"/><path d="M8.5 11 12 8l3.5 3v3.5h-7z" fill="#fff"/></svg>', iconSize: [30, 30], iconAnchor: [15, 29] });
      L.marker([state.addr.lat, state.addr.lon], { icon, title: "Your address" })
        .bindTooltip("Your address", { permanent: true, direction: "top", offset: [0, -28], className: "home-label" })
        .addTo(personalLayer);
    }
    for (const p of placesShown || []) {
      L.circleMarker([p.lat, p.lon], { radius: 4, color: "#0b2340", weight: 1, fillColor: p.landmark ? "#0f766e" : "#ffffff", fillOpacity: 1 })
        .bindTooltip(esc(p.name), { permanent: true, direction: "bottom", offset: [0, 4], className: "place-label" })
        .addTo(personalLayer);
    }
  }

  function fitView(extra) {
    const fc = state.fc;
    const b = L.latLngBounds([]);
    if (state.addr && fc && fc.crossing && fc.crossing.status === "crossing") {
      b.extend([state.addr.lat, state.addr.lon]);
      b.extend([fc.crossing.lat, fc.crossing.lon]);
      // Frame the stretch between the address and the crossing; outer table rows may sit just off-screen.
      const span = Geo.miles([state.addr.lon, state.addr.lat], [fc.crossing.lon, fc.crossing.lat]);
      (extra || []).forEach((p) => {
        if (Geo.miles([p.lon, p.lat], [fc.crossing.lon, fc.crossing.lat]) <= Math.max(span, 20) + 5) b.extend([p.lat, p.lon]);
      });
      map.fitBounds(b.pad(span < 15 ? 0.6 : 0.3), { maxZoom: 11 });
    } else if (fc) {
      fc.points.slice(0, 4).forEach((p) => b.extend([p.lat, p.lon]));
      if (state.addr) b.extend([state.addr.lat, state.addr.lon]);
      if (b.isValid()) map.fitBounds(b.pad(0.35), { maxZoom: 8 });
    }
  }

  // Latitude/longitude grid that adapts to zoom.
  function drawGrid() {
    gridLayer.clearLayers();
    if (!$("grid-toggle").checked) return;
    const z = map.getZoom();
    const step = z <= 4 ? 10 : z <= 5 ? 5 : z <= 6 ? 2 : z <= 7 ? 1 : z <= 8 ? 0.5 : z <= 9 ? 0.2 : 0.1;
    const b = map.getBounds();
    const s = Math.floor(b.getSouth() / step) * step, n = Math.ceil(b.getNorth() / step) * step;
    const w = Math.floor(b.getWest() / step) * step, e = Math.ceil(b.getEast() / step) * step;
    const style = { color: "#1f2937", weight: 0.6, opacity: 0.45, interactive: false };
    const dec = step < 1 ? (step < 0.2 ? 1 : 1) : 0;
    for (let lat = s; lat <= n + 1e-9; lat += step) {
      L.polyline([[lat, w], [lat, e]], style).addTo(gridLayer);
      L.marker([lat, b.getWest()], { interactive: false, icon: L.divIcon({ className: "grid-label", html: `${Math.abs(lat).toFixed(dec)}°${lat >= 0 ? "N" : "S"}`, iconSize: [44, 14], iconAnchor: [-2, 7] }) }).addTo(gridLayer);
    }
    for (let lon = w; lon <= e + 1e-9; lon += step) {
      L.polyline([[s, lon], [n, lon]], style).addTo(gridLayer);
      L.marker([b.getNorth(), lon], { interactive: false, icon: L.divIcon({ className: "grid-label", html: `${Math.abs(lon).toFixed(dec)}°${lon <= 0 ? "W" : "E"}`, iconSize: [44, 14], iconAnchor: [22, -2] }) }).addTo(gridLayer);
    }
  }

  function refreshSurge() {
    if (surgeOverlay) { map.removeLayer(surgeOverlay); surgeOverlay = null; }
    const on = $("surge-toggle").checked;
    $("surge-legend").hidden = !on;
    const s = state.fc && state.fc.surge;
    if (!on) return;
    if (!s) { setStatus("NHC has not issued a storm surge flooding map for this storm.", "warn"); return; }
    const b = map.getBounds();
    const sw = map.options.crs.project(b.getSouthWest()), ne = map.options.crs.project(b.getNorthEast());
    const size = map.getSize();
    const url = `${s.exportUrl}?bbox=${sw.x},${sw.y},${ne.x},${ne.y}&bboxSR=102100&imageSR=102100&size=${size.x},${size.y}` +
      `&format=png32&transparent=true&layers=show:${s.layer}&f=image&dpi=96`;
    surgeOverlay = L.imageOverlay(url, b, { opacity: 0.7, interactive: false }).addTo(map);
  }

  const placeLabels = () => $("map").classList.toggle("hide-places", map.getZoom() < 9);
  map.on("zoomend", placeLabels);
  map.on("moveend", () => { drawGrid(); refreshSurge(); });
  $("grid-toggle").addEventListener("change", drawGrid);
  $("surge-toggle").addEventListener("change", refreshSurge);

  // ---------- data ----------
  async function loadPlaces() {
    if (state.places) return state.places;
    const [p, l] = await Promise.all([getJSON("/data/places.json"), getJSON("/data/landmarks.json")]);
    state.places = p.places.map(([name, region, lat, lon]) => ({ name: `${name}, ${region}`, lat, lon }))
      .concat(l.landmarks.map((x) => ({ name: `${x.name}`, lat: x.lat, lon: x.lon, landmark: true })));
    return state.places;
  }

  async function loadStorms() {
    const data = await getJSON("/api/storms");
    state.storms = data.storms.sort((a, b) => (a.basin === "AL" ? 0 : 1) - (b.basin === "AL" ? 0 : 1) || b.windKt - a.windKt);
    const sel = $("storm");
    sel.innerHTML = "";
    if (!state.storms.length) {
      sel.innerHTML = "<option>No active storms right now</option>";
      sel.disabled = true;
      return false;
    }
    for (const s of state.storms) {
      const o = document.createElement("option");
      o.value = s.id;
      o.textContent = `${s.label} ${s.name} · ${s.windMph} mph · ${BASIN[s.basin] || s.basin}`;
      sel.appendChild(o);
    }
    const saved = store.get("hlt.storm");
    state.stormId = state.storms.some((s) => s.id === state.stormId) ? state.stormId
      : state.storms.some((s) => s.id === saved) ? saved : state.storms[0].id;
    sel.value = state.stormId;
    sel.disabled = false;
    return true;
  }

  async function loadForecast() {
    state.fc = await getJSON(`/api/forecast?storm=${encodeURIComponent(state.stormId)}`);
    state.checkedAt = Date.now();
  }

  async function loadAlerts() {
    state.alerts = null;
    if (!state.addr) return;
    try {
      const url = `https://api.weather.gov/alerts/active?point=${state.addr.lat.toFixed(4)},${state.addr.lon.toFixed(4)}`;
      const res = await fetch(url, { headers: { Accept: "application/geo+json" } });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      const rank = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };
      const newest = {};
      for (const f of data.features || []) {
        const p = f.properties;
        if (!newest[p.event] || new Date(p.sent) > new Date(newest[p.event].sent)) newest[p.event] = p;
      }
      state.alerts = Object.values(newest).sort((a, b) => (rank[a.severity] ?? 5) - (rank[b.severity] ?? 5) || new Date(b.sent) - new Date(a.sent));
    } catch {
      state.alerts = "unavailable";
    }
  }

  // ---------- rendering ----------
  function renderStormCard() {
    const fc = state.fc, s = fc.storm, a = fc.advisory || {};
    const p0 = fc.points[0];
    const card = $("storm-card");
    const headlines = (a.headlines || []).map((h) => `<li>${esc(h.charAt(0) + h.slice(1).toLowerCase())}</li>`).join("");
    card.innerHTML = `
      <p class="eyebrow">${esc(BASIN[s.basin] || s.basin)} · NHC advisory ${esc(a.number || s.advisory?.advNum || "")}</p>
      <h2>${esc(s.label)} ${esc(s.name)}</h2>
      <div class="stats">
        <div><span class="big">${s.windMph}</span><span class="unit">mph</span><span class="cap">${s.category ? "Category " + s.category : esc(s.label)}</span></div>
        <div><span class="big">${s.pressureMb ?? "—"}</span><span class="unit">mb</span><span class="cap">pressure</span></div>
        <div><span class="big">${s.movementMph ?? "—"}</span><span class="unit">mph</span><span class="cap">moving ${esc(Geo.compass(s.movementDir || 0))}</span></div>
      </div>
      <p class="muted">Center at ${fmtLatLon(p0.lat, p0.lon)}. Advisory issued ${esc(a.issued || fmtTime(new Date(s.advisory?.issuance)))}.</p>
      ${headlines ? `<ul class="headlines">${headlines}</ul>` : ""}
      <p class="small">${(a.next || []).map(esc).join(" ")} Checked ${fmtTime(state.checkedAt)}; this page refreshes itself every 15 minutes.</p>
      <p class="small"><a href="${esc(s.graphicsUrl || "https://www.nhc.noaa.gov")}" rel="noopener">NHC graphics for ${esc(s.name)}</a> · <a href="${esc(s.advisory?.url || "#")}" rel="noopener">Full advisory text</a></p>`;
    card.hidden = false;
  }

  function nearestPlace(lon, lat, maxMiles = 15) {
    let best = null, bd = Infinity;
    for (const p of state.places || []) {
      const d = Geo.miles([lon, lat], [p.lon, p.lat]);
      if (d < bd) { bd = d; best = p; }
    }
    return best && bd <= maxMiles ? { ...best, miles: bd } : null;
  }

  function renderCrossingCard() {
    const fc = state.fc, c = fc.crossing, card = $("crossing-card");
    let html = `<h2>Estimated coast crossing</h2>`;
    if (!c || c.status === "no-crossing") {
      html += `<p>The ${fc.points.length > 1 ? "five-day " : ""}forecast track stays over water. No coast crossing is forecast in this advisory.</p>`;
    } else if (c.status === "over-land") {
      html += `<p>The center is already over land at ${fmtLatLon(c.lat, c.lon)}.</p>`;
    } else {
      const near = nearestPlace(c.lon, c.lat);
      const key = "hlt.cross." + fc.storm.id;
      const prev = store.get(key);
      let shift = "";
      const advNum = fc.advisory?.number || fc.storm.advisory?.advNum;
      if (prev && prev.adv !== advNum) {
        const d = Geo.miles([prev.lon, prev.lat], [c.lon, c.lat]);
        shift = d < 1 ? `<p class="small">About the same place as advisory ${esc(prev.adv)}, the last one this device saw.</p>`
          : `<p class="small">${mi(d)} ${Geo.compass(Geo.bearing([prev.lon, prev.lat], [c.lon, c.lat]))} of where advisory ${esc(prev.adv)} put it, the last one this device saw.</p>`;
      }
      if (!prev || prev.adv !== advNum) store.set(key, { adv: advNum, lat: c.lat, lon: c.lon, prev: prev || null });
      else if (prev.prev) {
        const d = Geo.miles([prev.prev.lon, prev.prev.lat], [c.lon, c.lat]);
        shift = `<p class="small">${d < 1 ? "About the same place as" : mi(d) + " " + Geo.compass(Geo.bearing([prev.prev.lon, prev.prev.lat], [c.lon, c.lat])) + " of where"} advisory ${esc(prev.prev.adv)}${d < 1 ? "" : " put it"}, the previous one this device saw.</p>`;
      }
      html += `
        <p class="lead">${near ? `Near <strong>${esc(near.name)}</strong>` : "On the coast"} at ${fmtLatLon(c.lat, c.lon)}, around <strong>${esc(fmtHour(c.time))}</strong>.</p>
        <p>This is where NHC's forecast track, drawn as straight lines between its forecast points, first meets the shoreline. NHC forecasts <strong>${c.before.windMph} mph</strong> at ${esc(c.before.label)} offshore and <strong>${c.after.windMph} mph</strong> at ${esc(c.after.label)} inland.</p>
        ${shift}`;
      if (state.addr) {
        const d = Geo.miles([state.addr.lon, state.addr.lat], [c.lon, c.lat]);
        const dir = Geo.compass(Geo.bearing([c.lon, c.lat], [state.addr.lon, state.addr.lat]));
        html += `<p>Your address is <strong>${mi(d)} ${esc(dir)}</strong> of this point.</p>`;
      }
      html += `<p class="caveat">An estimate, not an NHC product. The center can come ashore anywhere in the white cone, and the hazards reach far beyond the center. Read what reaches your address, not the dot.</p>`;
    }
    card.innerHTML = html;
    card.hidden = false;
  }

  function renderReachCard() {
    const card = $("reach-card");
    if (!state.addr) { card.hidden = true; return; }
    const fc = state.fc, a = state.addr, addr = [a.lon, a.lat];
    let html = `<p class="eyebrow">What reaches my address</p><h2>${esc(a.matched)}</h2>`;

    // Official alerts
    if (state.alerts === "unavailable") {
      html += `<p class="warn-box">National Weather Service alerts didn't load. Check <a href="https://www.weather.gov" rel="noopener">weather.gov</a> for your location.</p>`;
    } else if (state.alerts && state.alerts.length) {
      html += `<h3>Official alerts for this location</h3><ul class="alerts">`;
      for (const al of state.alerts) {
        const sev = (al.severity || "").toLowerCase();
        html += `<li class="alert ${esc(sev)}"><details>
          <summary><span class="ev">${esc(al.event)}</span><span class="by">${esc(al.senderName || "")}</span></summary>
          ${al.headline ? `<p><strong>${esc(al.headline)}</strong></p>` : ""}
          ${al.description ? `<div class="pre">${esc(al.description)}</div>` : ""}
          ${al.instruction ? `<p><strong>What to do:</strong></p><div class="pre">${esc(al.instruction)}</div>` : ""}
        </details></li>`;
      }
      html += `</ul>`;
    } else if (state.alerts) {
      html += `<p>No National Weather Service alerts are in effect for this exact location right now.</p>`;
    }

    // Wind timing
    const tl = Geo.windTimeline(fc.points, fc.radii, addr);
    const center0 = [fc.points[0].lon, fc.points[0].lat];
    const ml = Geo.arrivalBracket(fc.arrival.mostLikely, center0, addr);
    const er = Geo.arrivalBracket(fc.arrival.earliest, center0, addr);
    const bracketText = (b) => !b ? null : b.before ? `by ${b.before}` : b.after ? `after ${b.after}` : `between ${b.from} and ${b.to}`;
    const now = fc.points[0].time;
    const whenText = (t) => (t <= now ? "already within reach now" : `from about ${fmtHour(t)}`);
    html += `<h3>Wind</h3><ul class="facts">`;
    html += `<li><strong>Tropical-storm-force winds (39+ mph):</strong> ${tl.first[34] != null ? whenText(tl.first[34]) : "not in the forecast wind field for your address"}.`;
    if (ml) html += ` NHC's most likely arrival: <strong>${esc(bracketText(ml))}</strong>.`;
    if (er) html += ` Earliest reasonable arrival, the time to have preparations done: <strong>${esc(bracketText(er))}</strong>.`;
    html += `</li>`;
    html += `<li><strong>Damaging winds (58+ mph):</strong> ${tl.first[50] != null ? whenText(tl.first[50]) : "not forecast to reach your address"}.</li>`;
    if (tl.first[64] != null) {
      html += `<li><strong>Hurricane-force winds (74+ mph):</strong> forecast to reach your address ${whenText(tl.first[64])}.</li>`;
    } else if (tl.closest) {
      const dirToCenter = Geo.compass(Geo.bearing(addr, tl.closest.center));
      html += `<li><strong>Hurricane-force winds (74+ mph):</strong> not forecast to reach your address. At its closest, about ${esc(fmtHour(tl.closest.time))}, the center passes about <strong>${mi(tl.closest.miles)} to your ${esc(dirToCenter)}</strong>.</li>`;
    }
    html += `</ul><p class="small">From NHC's forecast wind field, which marks the farthest reach of each wind speed in each direction. It leans cautious, and it moves with every advisory.</p>`;

    // Side of track
    const c = fc.crossing;
    const officialSurge = Array.isArray(state.alerts) && state.alerts.some((x) => /Storm Surge (Warning|Watch)/.test(x.event));
    const officialHurricane = Array.isArray(state.alerts) && state.alerts.some((x) => /Hurricane (Warning|Watch)/.test(x.event));
    if (c && c.status === "crossing") {
      const side = Geo.sideOfTrack(c, c.heading, addr);
      html += `<h3>Which side of the storm</h3>`;
      if (side === "right") {
        html += `<p>Your address is on the <strong>right side</strong> of the forecast track, looking the way the storm moves. That side usually brings the highest surge and strongest winds.</p>`;
      } else if (side === "left") {
        html += `<p>Your address is on the <strong>left side</strong> of the forecast track, looking the way the storm moves. The right side usually brings the highest surge and strongest winds.${officialSurge || officialHurricane ? " Even so, official warnings cover your location; the left side is still dangerous." : ""}</p>`;
      } else {
        html += `<p>Your address is <strong>on or very near the forecast track</strong>.</p>`;
      }
    }

    // Surge
    const sg = fc.advisory?.hazards?.storm_surge;
    if (sg || officialSurge) {
      html += `<h3>Storm surge</h3>`;
      if (officialSurge) html += `<p class="warn-box"><strong>A storm surge ${state.alerts.some((x) => x.event === "Storm Surge Warning") ? "warning" : "watch"} covers your location.</strong> That means a danger of life-threatening flooding from rising water. Follow evacuation instructions from local officials.</p>`;
      if (sg && sg.list.length) {
        html += `<p class="small">NHC peak surge forecast, if the peak arrives at high tide. Find your stretch of coast:</p><table class="mini"><tbody>` +
          sg.list.map((r) => `<tr><td>${esc(r.area)}</td><td class="num">${esc(r.height)}</td></tr>`).join("") + `</tbody></table>`;
      }
      if (fc.surge && sg && sg.list.length) html += `<p class="small">Turn on <em>Show NHC potential storm surge flooding</em> under the map and zoom in to see depths near you.</p>`;
    }

    // Rain
    const rain = fc.advisory?.hazards?.rainfall;
    if (rain && rain.length) html += `<h3>Rain</h3><p>${esc(rain[0])}</p>`;

    // Distance rule
    if (c && c.status === "crossing") {
      const d = Geo.miles(addr, [c.lon, c.lat]);
      if (d > (CFG.compareRadiusMiles || 100)) {
        html += `<p class="small">Your address is ${mi(d)} from the estimated crossing, farther than the ${CFG.compareRadiusMiles || 100}-mile comparison this page is built for. The alerts and wind timing above still apply to you.</p>`;
      }
    }
    card.innerHTML = html;
    card.hidden = false;
  }

  function renderPoints() {
    const fc = state.fc, c = fc.crossing, sec = $("points-section");
    if (!c || c.status !== "crossing" || !state.places) { sec.hidden = true; drawPersonal([]); return []; }
    const crossing = [c.lon, c.lat];
    let addr = state.addr ? [state.addr.lon, state.addr.lat] : null;
    const farAway = addr && Geo.miles(addr, crossing) > 2 * (CFG.compareRadiusMiles || 100);
    if (farAway) addr = null; // too far to line up along one stretch of coast
    const { places, axis } = Geo.pickPlaces(state.places, addr || crossing, crossing, c.heading);
    const rows = places.map((p) => ({ ...p, kind: p.landmark ? "landmark" : "town" }));
    rows.push({ name: "Estimated coast crossing", lat: c.lat, lon: c.lon, kind: "crossing" });
    if (addr) rows.push({ name: "Your address", lat: addr[1], lon: addr[0], kind: "home" });
    rows.forEach((r) => (r.t = Geo.alongAxis(axis, [r.lon, r.lat])));
    rows.sort((a, b) => a.t - b.t);

    const head = `<thead><tr><th>Place</th><th>Lat, long</th><th>From the crossing</th><th>Side of track<span class="th-hint">looking the way the storm moves</span></th>${addr ? "<th>From your address</th>" : ""}</tr></thead>`;
    const body = rows.map((r) => {
      const dC = Geo.miles(crossing, [r.lon, r.lat]);
      const dirC = Geo.compassShort(Geo.bearing(crossing, [r.lon, r.lat]));
      const side = r.kind === "crossing" ? "—" : Geo.sideOfTrack(c, c.heading, [r.lon, r.lat]);
      const sideCell = side === "right" ? '<span class="side right">Right</span>' : side === "left" ? '<span class="side left">Left</span>' : esc(side);
      const dA = addr ? Geo.miles(addr, [r.lon, r.lat]) : null;
      const dirA = addr ? Geo.compassShort(Geo.bearing(addr, [r.lon, r.lat])) : "";
      return `<tr class="${r.kind}"><td>${esc(r.name)}${r.kind === "landmark" ? ' <span class="tag">landmark</span>' : ""}</td>
        <td class="mono">${r.lat.toFixed(3)}, ${r.lon.toFixed(3)}</td>
        <td class="num">${r.kind === "crossing" ? "—" : `${mi(dC)} ${dirC}`}</td>
        <td>${sideCell}</td>
        ${addr ? `<td class="num">${r.kind === "home" ? "—" : `${mi(dA)} ${dirA}`}</td>` : ""}</tr>`;
    }).join("");
    $("points-table").innerHTML = head + `<tbody>${body}</tbody>`;
    $("points-note").textContent = farAway
      ? "Your address is far from this storm's estimated crossing, so this list shows towns and beach landmarks on either side of the crossing only."
      : addr
      ? "Towns and beach landmarks between your address and the estimated crossing, plus a few on either side, in order along the coast."
      : "Towns and beach landmarks on either side of the estimated crossing, in order along the coast. Enter your address to add it to this list.";
    sec.hidden = false;
    drawPersonal(places);
    return places;
  }

  function renderAdvisory() {
    const a = state.fc.advisory, sec = $("advisory-section");
    if (!a) { sec.hidden = true; return; }
    const block = (title, body, open) => body ? `<details${open ? " open" : ""}><summary>${esc(title)}</summary>${body}</details>` : "";
    const ps = (arr) => (arr || []).map((p) => `<p>${esc(p)}</p>`).join("");
    const ww = (a.warnings || []).map((w) => `<p><strong>${esc(w.type)}</strong></p><ul>${w.areas.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`).join("");
    const sg = a.hazards?.storm_surge;
    const surge = sg ? `<p>${esc(sg.intro)}</p><table class="mini"><tbody>${sg.list.map((r) => `<tr><td>${esc(r.area)}</td><td class="num">${esc(r.height)}</td></tr>`).join("")}</tbody></table>${ps(sg.notes)}` : "";
    sec.innerHTML = `<h2>From the NHC advisory</h2>
      <p class="muted">Quoted from National Hurricane Center advisory ${esc(a.number || "")}${a.issued ? ", " + esc(a.issued) : ""}${a.forecaster ? ", forecaster " + esc(a.forecaster) : ""}.</p>
      ${block("Watches and warnings in effect", ww, true)}
      ${block("Discussion and outlook", ps(a.discussion))}
      ${block("Storm surge", surge)}
      ${block("Wind", ps(a.hazards?.wind))}
      ${block("Rainfall", ps(a.hazards?.rainfall))}
      ${block("Tornadoes", ps(a.hazards?.tornadoes))}
      ${block("Surf", ps(a.hazards?.surf))}`;
    sec.hidden = false;
  }

  function renderAll(refit) {
    drawStorm();
    renderStormCard();
    renderCrossingCard();
    renderReachCard();
    const picked = renderPoints();
    renderAdvisory();
    if (refit) fitView(picked);
    drawGrid();
  }

  // ---------- actions ----------
  async function refresh(refit) {
    const btn = $("update");
    btn.disabled = true;
    setStatus("Getting the latest from the National Hurricane Center…");
    try {
      await loadPlaces();
      const any = await loadStorms();
      if (!any) {
        setStatus("The National Hurricane Center lists no active storms right now.", "ok");
        ["storm-card", "reach-card", "crossing-card", "points-section", "advisory-section"].forEach((id) => ($(id).hidden = true));
        stormLayer.clearLayers();
        return;
      }
      await Promise.all([loadForecast(), loadAlerts()]);
      renderAll(refit);
      setStatus("");
    } catch (err) {
      setStatus(err.message || "Something went wrong. Try Update again.", "error");
    } finally {
      btn.disabled = false;
    }
  }

  async function checkAddress(address) {
    setStatus("Finding your address with the U.S. Census Bureau…");
    try {
      state.addr = await getJSON(`/api/geocode?address=${encodeURIComponent(address)}`);
      if ($("remember").checked) store.set("hlt.address", address); else store.del("hlt.address");
      if (!state.fc) await refresh(true);
      else {
        await loadAlerts();
        renderAll(true);
        setStatus("");
      }
      $("reach-card").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      setStatus(err.message, "error");
    }
  }

  $("storm").addEventListener("change", async (e) => {
    state.stormId = e.target.value;
    store.set("hlt.storm", state.stormId);
    setStatus("Loading the forecast…");
    try { await loadForecast(); renderAll(true); setStatus(""); } catch (err) { setStatus(err.message, "error"); }
  });
  $("addr-form").addEventListener("submit", (e) => { e.preventDefault(); checkAddress($("address").value); });
  $("remember").addEventListener("change", (e) => { if (!e.target.checked) store.del("hlt.address"); });
  $("update").addEventListener("click", () => refresh(false));

  if (CFG.donateUrl) { $("donate-link").href = CFG.donateUrl; $("donate-line").hidden = false; }

  // Start
  const savedAddress = store.get("hlt.address");
  if (savedAddress) { $("address").value = savedAddress; $("remember").checked = true; }
  refresh(true).then(() => { if (savedAddress && state.fc) checkAddress(savedAddress); });
  setInterval(() => { if (!document.hidden) refresh(false); }, 15 * 60000);
})();
