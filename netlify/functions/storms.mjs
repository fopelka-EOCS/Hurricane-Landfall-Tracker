// GET /api/storms  ->  active storms from the National Hurricane Center
import { activeStorms } from "../../lib/nhc.mjs";
import { json, fail } from "../../lib/http.mjs";

export default async () => {
  try {
    return json({ storms: await activeStorms(), fetchedAt: new Date().toISOString() }, 120);
  } catch (err) {
    return fail(502, `Could not reach the National Hurricane Center just now (${err.message}).`);
  }
};

export const config = { path: "/api/storms" };
