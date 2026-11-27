import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const MEDIA_DIR = path.join(__dirname, "media");
const PORT = Number(process.env.PORT || 8765);
const HOST = process.env.HOST || "127.0.0.1";

const VIDEO_EXTS = new Set([
  ".mp4",
  ".webm",
  ".mkv",
  ".mov",
  ".m4v",
  ".ogg",
  ".ogv",
]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".ogg": "audio/ogg",
  ".ogv": "video/ogg",
};

await fsp.mkdir(MEDIA_DIR, { recursive: true });

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
    "Cache-Control": "no-store",
  });
  res.end(data);
}

function safeJoin(root, target) {
  const resolved = path.resolve(root, target);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    return null;
  }
  return resolved;
}

async function listMedia() {
  const entries = await fsp.readdir(MEDIA_DIR, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!VIDEO_EXTS.has(ext)) continue;
    const full = path.join(MEDIA_DIR, entry.name);
    const stat = await fsp.stat(full);
    files.push({
      id: encodeURIComponent(entry.name),
      name: entry.name,
      title: entry.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "),
      size: stat.size,
      mime: MIME[ext] || "application/octet-stream",
      url: `/api/stream/${encodeURIComponent(entry.name)}`,
      mtime: stat.mtimeMs,
    });
  }
  files.sort((a, b) => b.mtime - a.mtime);
  return files;
}

async function streamFile(req, res, filePath) {
  const stat = await fsp.stat(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || "application/octet-stream";
  const total = stat.size;
  const range = req.headers.range;
  const headOnly = req.method === "HEAD";

  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", mime);
  res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");

  if (!range) {
    res.writeHead(200, { "Content-Length": total });
    if (headOnly) {
      res.end();
      return;
    }
    await pipeline(fs.createReadStream(filePath), res);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    res.writeHead(416, { "Content-Range": `bytes */${total}` });
    res.end();
    return;
  }

  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : total - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
    res.writeHead(416, { "Content-Range": `bytes */${total}` });
    res.end();
    return;
  }
  end = Math.min(end, total - 1);
  const chunk = end - start + 1;

  res.writeHead(206, {
    "Content-Range": `bytes ${start}-${end}/${total}`,
    "Content-Length": chunk,
  });
  if (headOnly) {
    res.end();
    return;
  }
  await pipeline(fs.createReadStream(filePath, { start, end }), res);
}

async function serveStatic(req, res, urlPath) {
  const rel = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = safeJoin(PUBLIC_DIR, "." + rel);
  if (!filePath) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) {
      res.writeHead(404).end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=3600",
    });
    await pipeline(fs.createReadStream(filePath), res);
  } catch {
    res.writeHead(404).end("Not found");
  }
}

function readBody(req, limit = 512 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("Payload too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseMultipart(buffer, boundary) {
  const delim = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = buffer.indexOf(delim) + delim.length;
  while (start < buffer.length) {
    if (buffer[start] === 45 && buffer[start + 1] === 45) break; // --
    if (buffer[start] === 13 && buffer[start + 1] === 10) start += 2;
    const next = buffer.indexOf(delim, start);
    if (next === -1) break;
    let part = buffer.subarray(start, next - 2); // strip CRLF
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const headers = part.subarray(0, headerEnd).toString("utf8");
      const body = part.subarray(headerEnd + 4);
      const nameMatch = /name="([^"]+)"/.exec(headers);
      const fileMatch = /filename="([^"]+)"/.exec(headers);
      parts.push({
        name: nameMatch?.[1] || "",
        filename: fileMatch?.[1] || "",
        data: body,
      });
    }
    start = next + delim.length;
  }
  return parts;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const { pathname } = url;

    if (req.method === "GET" && pathname === "/api/health") {
      sendJson(res, 200, { ok: true, service: "chamber", host: HOST, port: PORT });
      return;
    }

    if (req.method === "GET" && pathname === "/api/library") {
      sendJson(res, 200, { items: await listMedia() });
      return;
    }

    if (
      (req.method === "GET" || req.method === "HEAD") &&
      pathname.startsWith("/api/stream/")
    ) {
      const name = decodeURIComponent(pathname.slice("/api/stream/".length));
      if (!name || name.includes("\0") || name.includes("/") || name.includes("\\")) {
        res.writeHead(400).end("Bad request");
        return;
      }
      const filePath = safeJoin(MEDIA_DIR, name);
      if (!filePath) {
        res.writeHead(403).end("Forbidden");
        return;
      }
      try {
        await streamFile(req, res, filePath);
      } catch (err) {
        if (err.code === "ENOENT") {
          res.writeHead(404).end("Not found");
          return;
        }
        throw err;
      }
      return;
    }

    if (req.method === "POST" && pathname === "/api/upload") {
      const contentType = req.headers["content-type"] || "";
      if (!contentType.includes("multipart/form-data")) {
        sendJson(res, 400, { error: "Expected multipart/form-data" });
        return;
      }
      const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)?.[1]
        || /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)?.[2];
      if (!boundary) {
        sendJson(res, 400, { error: "Missing boundary" });
        return;
      }
      const raw = await readBody(req);
      const parts = parseMultipart(raw, boundary);
      const filePart = parts.find((p) => p.filename);
      if (!filePart) {
        sendJson(res, 400, { error: "No file provided" });
        return;
      }
      const base = path.basename(filePart.filename).replace(/[^\w.\- ()[\]]+/g, "_");
      const ext = path.extname(base).toLowerCase();
      if (!VIDEO_EXTS.has(ext)) {
        sendJson(res, 400, { error: "Unsupported video type" });
        return;
      }
      const dest = safeJoin(MEDIA_DIR, base);
      if (!dest) {
        sendJson(res, 400, { error: "Invalid filename" });
        return;
      }
      await fsp.writeFile(dest, filePart.data);
      sendJson(res, 201, { ok: true, name: base, items: await listMedia() });
      return;
    }

    if (req.method === "GET") {
      await serveStatic(req, res, pathname);
      return;
    }

    res.writeHead(405).end("Method not allowed");
  } catch (err) {
    const status = err.status || 500;
    if (!res.headersSent) {
      sendJson(res, status, { error: err.message || "Server error" });
    } else {
      res.destroy(err);
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`CHAMBER streaming at http://${HOST}:${PORT}`);
});
