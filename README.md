# Hurricane Landfall Tracker

A free public-service website, live at **[landfalltracker.org](https://landfalltracker.org)**. Pick an active storm, enter a U.S. address, and see:

- **What reaches your address**: the official National Weather Service alerts for that exact spot, when tropical-storm winds are likely to arrive, which side of the storm you're on, and the National Hurricane Center's surge and rain forecasts.
- **Where the forecast meets the coast**: an estimated coast crossing, inside NHC's forecast cone.
- **Points along the coast**: towns and beach landmarks between your address and the crossing, plus a few on either side, in a table and on the map.
- **How we know this**: every number traced to its government source.

The **Update** button fetches the latest NHC advisory, and the page refreshes itself every 15 minutes.

A public service of [Episodes of Care Solutions](https://www.eocs.ltd).

> Not an official forecast. Evacuation orders come from local emergency managers. Follow them, whatever the map shows.

## Design principle: hazards before the dot

A single "landfall point" invites the wrong conclusion ("it's going east of us, we're fine"). The center can come ashore anywhere in the cone, and surge and wind reach far beyond the center. So the page leads with what reaches your address, shows the cone, and labels the crossing as an estimate.

## How it's built

| Piece | What it does |
|---|---|
| `public/` | The website itself: one page, plain HTML, CSS, and JavaScript. The map library (Leaflet) is bundled here so the site depends on as few outside servers as possible during a storm. |
| `netlify/functions/storms.mjs` | Lists active storms from NHC. |
| `netlify/functions/forecast.mjs` | Gathers one storm's forecast (points, cone, warnings, wind field, arrival times, advisory text) and estimates the coast crossing. Results are cached for 3 minutes so crowds don't overload NOAA. |
| `netlify/functions/geocode.mjs` | Turns an address into coordinates with the U.S. Census Bureau geocoder. Never cached, never stored. |
| `lib/` | Shared code for those helpers. |
| `data/coast.mjs` | Shoreline used for the crossing estimate (Census 1:500,000, which includes barrier islands). |
| `public/data/places.json` | Coastal towns (Census Gazetteer). |
| `public/data/landmarks.json` | Hand-added beach landmarks. Add your own here. |
| `tools/` | The script that rebuilds the data files, a local preview server, and the health check. |
| `.github/workflows/` | The scheduled health check (see below). |

National Weather Service alerts are fetched by the visitor's browser straight from `api.weather.gov`.

## Updating the site

The site is published by Netlify from this repository. Save a change to GitHub and the live site updates within about a minute.

- **Change wording:** edit `public/index.html` on GitHub (pencil icon) and commit.
- **Add a landmark:** add a line to `public/data/landmarks.json` with name, region, latitude, longitude, and source.
- **Add a donation link:** put the page address in `public/js/config.js` (`donateUrl`).
- **Preview locally:** `node tools/dev-server.mjs`, then open http://localhost:8888.
- **Rebuild the data files:** `pip install shapely pyshp`, then `python3 tools/build_data.py .cache`.

## Keeping it working: the health check

Storms and advisories are always live: the site asks NOAA for current data on every visit and every press of **Update**, so new storms appear and finished ones drop off on their own. What the site cannot absorb by itself is a change at the source, such as NOAA renaming or moving a service. The health check exists to catch that early.

**What it checks:** the NHC storm list and advisory text, the NOAA forecast map service, National Weather Service alerts, the Census address lookup, the USGS base map, and the live site end to end (home page, storm list, forecasts, address lookup).

**When it runs:**

| Period | How often |
|---|---|
| May through November | Daily, about 6:15 AM Central |
| All year | Weekly, Mondays |

**If something fails:**
1. GitHub emails you that the run failed, and an issue titled **"Health check failing"** opens on this repository with a plain-English report of which source broke. The issue closes itself once a later check passes.
2. Re-check first, since one-off outages happen: **Actions** tab → **Health check** → **Run workflow**.
3. If it still fails, a source has changed and the code needs adjusting. Ask Claude: *"The landfall tracker health check is failing,"* and share the issue. A redeploy alone won't fix a changed source.

**Other buttons worth knowing:**
- **Re-run the check:** Actions → Health check → Run workflow.
- **Republish the site as-is:** Netlify → landfall-tracker → Deploys → **Trigger deploy**. This only helps if a Netlify publish itself went wrong.

**Last weekly result:** see [HEALTH.md](HEALTH.md). Writing that file each week also keeps GitHub from switching the schedule off during quiet months, since GitHub pauses scheduled checks in repositories with no changes for 60 days.

**Once a year, before May:** skim the National Weather Service's notices of product changes for the coming season (search "NWS Service Change Notices") for anything about NHC products.

To run the check by hand: `node tools/healthcheck.mjs`.

## Roadmap

- **v1 (now):** storm picker, address check, cone and track, warnings, estimated crossing, wind timing, NWS alerts, surge map layer, coastal points table, provenance panel.
- **v2:** sharper "what reaches my address" (surge depth at the address from the NHC map), crossing history across advisories, print-friendly briefing.
- **v3:** Spanish toggle, shareable links, several saved addresses for family.

## Data sources

National Hurricane Center and National Weather Service (NOAA); U.S. Census Bureau geocoder, cartographic boundaries, and gazetteer; U.S. Geological Survey, The National Map; Natural Earth (outside the U.S.); OpenStreetMap for a few landmark coordinates.
