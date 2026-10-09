// GET /api/geocode?address=...
// Turns a U.S. street address into coordinates using the U.S. Census Bureau
// geocoder. The address is passed straight through and never stored or logged.

import { getJSON } from "../../lib/nhc.mjs";
import { fail, privateJson } from "../../lib/http.mjs";

const CENSUS =
  "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=";

export default async (req) => {
  const address = (new URL(req.url).searchParams.get("address") || "").trim().slice(0, 200);
  if (address.length < 5) return fail(400, "Please enter a street address, city, and state.");
  try {
    const data = await getJSON(CENSUS + encodeURIComponent(address), 15000);
    const matches = data?.result?.addressMatches || [];
    if (!matches.length) {
      return fail(404, "The Census Bureau couldn't match that address. Try adding the city, state, or ZIP code.");
    }
    const m = matches[0];
    return privateJson({
      matched: m.matchedAddress,
      lat: m.coordinates.y,
      lon: m.coordinates.x,
      source: "U.S. Census Bureau geocoder (address-range match)",
      alternatives: matches.length - 1,
    });
  } catch (err) {
    return fail(502, `The Census geocoder didn't answer just now (${err.message}). Try again shortly.`);
  }
};

export const config = { path: "/api/geocode" };
