import fs from "node:fs/promises";
import path from "node:path";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

export async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

export function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload, null, 2));
}

export function sendError(response, error) {
  const statusCode = error.statusCode || 500;
  sendJson(response, statusCode, {
    error: error.message || "Internal server error"
  });
}

export async function serveStatic(request, response, publicDir) {
  const url = new URL(request.url, "http://localhost");
  const pathname = decodeURIComponent(url.pathname);
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const resolved = path.resolve(publicDir, `.${safePath}`);

  if (!resolved.startsWith(path.resolve(publicDir))) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const content = await fs.readFile(resolved);
    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(resolved)] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    response.end(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      const fallback = await fs.readFile(path.join(publicDir, "index.html"));
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache"
      });
      response.end(fallback);
      return;
    }
    throw error;
  }
}
