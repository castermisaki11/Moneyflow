// MoneyFlow — zero-dependency static file server.
//
// The app is local-first: all data lives in the browser (localStorage), so
// the server only has to serve the built SPA (dist/public) with correct
// caching headers + an SPA fallback. Works offline after first load because
// the service worker caches the shell.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT) || 3000;
const ROOT = resolve(fileURLToPath(new URL("./dist/public", import.meta.url)));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

async function trySendFile(res, path) {
  let s;
  try {
    s = await stat(path);
  } catch {
    return false;
  }
  if (!s.isFile()) return false;
  const type = MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
  const isHashed = path.includes(`${ROOT}/assets/`);
  const isIndex = path.endsWith("index.html");
  const cacheControl = isHashed
    ? "public, max-age=31536000, immutable" // filenames carry content hashes
    : isIndex
      ? "no-cache" // revalidate so new deploys land without manual refresh
      : "public, max-age=3600";
  const body = await readFile(path);
  send(res, 200, body, { "Content-Type": type, "Content-Length": s.size, "Cache-Control": cacheControl });
  return true;
}

const server = createServer(async (req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  } catch {
    return send(res, 400, "Bad Request");
  }

  // Basic path traversal guard: resolve and require it to stay under ROOT
  const safePath = normalize(join(ROOT, urlPath));
  if (!safePath.startsWith(ROOT)) {
    return send(res, 403, "Forbidden");
  }

  if (urlPath !== "/" && (await trySendFile(res, safePath))) return undefined;

  // SPA fallback: unknown/no-extension routes serve the app shell
  const isProbablyAsset = urlPath.startsWith("/assets/") || /\.[a-zA-Z0-9]+$/.test(urlPath);
  if (isProbablyAsset) return send(res, 404, "Not Found");
  if (await trySendFile(res, join(ROOT, "index.html"))) return undefined;
  return send(res, 404, "Not Found");
});

server.listen(PORT, () => {
  console.log(`MoneyFlow serving dist/public on http://localhost:${PORT}`);
});
