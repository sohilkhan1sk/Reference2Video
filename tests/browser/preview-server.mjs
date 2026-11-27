import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "../..");
const fixtureRoutes = new Map([
  ["/api/generated/job-a", "tests/browser/fixtures/red.mp4"],
  ["/api/generated/job-b", "tests/browser/fixtures/blue.mp4"]
]);
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mp4": "video/mp4",
  ".json": "application/json; charset=utf-8"
};

function resolveFile(pathname) {
  if (pathname === "/") return path.join(root, "templates/index.html");
  if (fixtureRoutes.has(pathname)) return path.join(root, fixtureRoutes.get(pathname));
  if (pathname.startsWith("/static/")) {
    const relative = pathname.slice("/static/".length);
    const candidate = path.resolve(root, "static", relative);
    const staticRoot = path.resolve(root, "static") + path.sep;
    return candidate.startsWith(staticRoot) ? candidate : null;
  }
  return null;
}

const server = http.createServer((request, response) => {
  if (!["GET", "HEAD"].includes(request.method || "GET")) {
    response.writeHead(405, { "Allow": "GET, HEAD" }).end();
    return;
  }
  const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
  const file = resolveFile(pathname);
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404, { "Cache-Control": "no-store" }).end("Not found");
    return;
  }

  const stat = fs.statSync(file);
  const headers = {
    "Content-Type": contentTypes[path.extname(file)] || "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store"
  };
  const range = request.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      response.writeHead(416, { "Content-Range": "bytes */" + stat.size }).end();
      return;
    }
    let start = match[1] ? Number(match[1]) : 0;
    let end = match[2] ? Number(match[2]) : stat.size - 1;
    if (!match[1] && match[2]) {
      const suffix = Number(match[2]);
      start = Math.max(0, stat.size - suffix);
      end = stat.size - 1;
    }
    if (start >= stat.size || end < start) {
      response.writeHead(416, { "Content-Range": "bytes */" + stat.size }).end();
      return;
    }
    end = Math.min(end, stat.size - 1);
    response.writeHead(206, {
      ...headers,
      "Content-Length": end - start + 1,
      "Content-Range": "bytes " + start + "-" + end + "/" + stat.size
    });
    if (request.method === "HEAD") response.end();
    else fs.createReadStream(file, { start, end }).pipe(response);
    return;
  }

  response.writeHead(200, { ...headers, "Content-Length": stat.size });
  if (request.method === "HEAD") response.end();
  else fs.createReadStream(file).pipe(response);
});

const port = Number(process.env.PORT || 4173);
server.listen(port, "127.0.0.1", () => {
  process.stdout.write("Reference2Video browser-test server listening on " + port + String.fromCharCode(10));
});
