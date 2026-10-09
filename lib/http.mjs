// Response helpers. Successful answers are cached briefly at Netlify's edge so
// a crowd pressing "Update" at once doesn't multiply requests to NOAA.

export function json(body, cdnSeconds = 120) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Netlify-CDN-Cache-Control": `public, s-maxage=${cdnSeconds}, stale-while-revalidate=60`,
    },
  });
}

export function fail(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// Address lookups are personal: never cache them anywhere.
export function privateJson(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
