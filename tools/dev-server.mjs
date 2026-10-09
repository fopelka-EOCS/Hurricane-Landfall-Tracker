// Local preview without any Netlify tooling:  node tools/dev-server.mjs
// Serves public/ and routes /api/* to the same functions Netlify runs.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pub = path.join(root, "public");
const fnDir = path.join(root, "netlify", "functions");
const routes = {};
for (const f of fs.readdirSync(fnDir).filter((f) => f.endsWith(".mjs"))) {
  const mod = await import(pathToFileURL(path.join(fnDir, f)));
  routes[mod.config.path] = mod.default;
}
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (routes[url.pathname]) {
    const out = await routes[url.pathname](new Request(url.href));
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
    return;
  }
  let file = path.join(pub, decodeURIComponent(url.pathname));
  if (!file.startsWith(pub)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(process.env.PORT || 8888, () => console.log("http://localhost:" + (process.env.PORT || 8888)));
