// Zero-framework Node server: serves the UI, the guide library, Markdown
// exports, and streams live agent generation as newline-delimited JSON.
import http from "node:http";
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateGuide, describeApiError } from "./agent/research.js";
import { guideToMarkdown } from "./lib/markdown.js";
import { managedAuthStatus } from "./lib/managed.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const CURATED_DIR = join(ROOT, "data", "guides");
const GENERATED_DIR = join(ROOT, "data", "generated");
const PUBLIC_DIR = join(ROOT, "public");
const PORT = Number(process.env.PORT) || 3000;
const CACHE_DAYS = 7;
const MAX_CONCURRENT = 3;

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json" };

const slugify = (s) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/https?:\/\//, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

function loadAll() {
  const guides = [];
  for (const [dir, source] of [[CURATED_DIR, "curated"], [GENERATED_DIR, "agent"]]) {
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      try {
        const g = readJson(join(dir, f));
        guides.push({ ...g, source, managed_auth: managedAuthStatus(g.name) });
      } catch (err) {
        console.error(`Skipping unreadable guide ${f}: ${err.message}`);
      }
    }
  }
  return guides;
}

const findGuide = (slug) => loadAll().find((g) => g.slug === slug);

// Matches a free-text request ("gmail", "https://slack.com") to an existing guide.
function matchExisting(query) {
  const q = slugify(query.replace(/^www\./, "").replace(/\.(com|io|so|dev|app|ai|co)(\/.*)?$/, ""));
  if (!q) return null;
  return loadAll().find((g) => {
    const host = (() => { try { return new URL(g.website).hostname.replace(/^www\./, "").split(".")[0]; } catch { return ""; } })();
    return g.slug === q || slugify(g.name).split("-")[0] === q || host === q;
  });
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 10_000) reject(new Error("Body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

let running = 0;

async function handleGenerate(req, res) {
  let query, force;
  try {
    ({ query, force } = JSON.parse(await readBody(req)));
  } catch {
    return send(res, 400, { error: "Expected JSON {query}" });
  }
  query = String(query ?? "").trim().slice(0, 120);
  if (query.length < 2) return send(res, 400, { error: "Enter an app name or website" });

  res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" });
  const emit = (event) => res.write(JSON.stringify(event) + "\n");

  const existing = matchExisting(query);
  const fresh = existing && (existing.source === "curated" || Date.now() - Date.parse(existing.generated_at) < CACHE_DAYS * 864e5);
  if (existing && fresh && !force) {
    emit({ type: "match", slug: existing.slug, source: existing.source, name: existing.name });
    return res.end();
  }
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    emit({ type: "error", message: "Live generation is disabled: the server has no ANTHROPIC_API_KEY. The curated library still works." });
    return res.end();
  }
  if (running >= MAX_CONCURRENT) {
    emit({ type: "error", message: "The agent is busy with other guides - try again in a minute." });
    return res.end();
  }

  running++;
  const heartbeat = setInterval(() => emit({ type: "heartbeat" }), 15_000);
  try {
    const { guide, meta } = await generateGuide(query, emit);
    let slug = slugify(guide.name || query);
    if (existsSync(join(CURATED_DIR, `${slug}.json`))) slug = `${slug}-live`;
    const record = { slug, source: "agent", ...guide, ...meta };
    writeFileSync(join(GENERATED_DIR, `${slug}.json`), JSON.stringify(record, null, 2));
    emit({ type: "done", slug });
  } catch (err) {
    console.error("Generation failed:", err);
    emit({ type: "error", message: describeApiError(err) });
  } finally {
    clearInterval(heartbeat);
    running--;
    res.end();
  }
}

function serveStatic(res, file) {
  const path = join(PUBLIC_DIR, file);
  if (!path.startsWith(PUBLIC_DIR) || !existsSync(path) || !statSync(path).isFile()) return send(res, 404, { error: "Not found" });
  res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
  res.end(readFileSync(path));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    if (req.method === "POST" && p === "/api/generate") return await handleGenerate(req, res);
    if (req.method !== "GET") return send(res, 405, { error: "Method not allowed" });

    if (p === "/api/status") {
      return send(res, 200, { live_generation: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN), model: process.env.AGENT_MODEL || "claude-opus-5-5" });
    }
    if (p === "/api/guides") {
      const list = loadAll().map((g) => ({
        slug: g.slug, name: g.name, category: g.category, summary: g.summary, access_tier: g.access_tier,
        difficulty: g.difficulty, production: g.effort?.production, source: g.source,
        date: g.generated_at?.slice(0, 10) ?? g.reviewed_on, managed: g.managed_auth.status,
      }));
      list.sort((a, b) => (a.source === b.source ? a.difficulty - b.difficulty : a.source === "curated" ? -1 : 1));
      return send(res, 200, list);
    }
    const md = p.match(/^\/api\/guides\/([a-z0-9-]+)\.md$/);
    if (md) {
      const g = findGuide(md[1]);
      if (!g) return send(res, 404, { error: "Guide not found" });
      res.setHeader("content-disposition", `inline; filename="${g.slug}-oauth-guide.md"`);
      return send(res, 200, guideToMarkdown(g, `${url.origin}/g/${g.slug}`), "text/markdown; charset=utf-8");
    }
    const one = p.match(/^\/api\/guides\/([a-z0-9-]+)$/);
    if (one) {
      const g = findGuide(one[1]);
      return g ? send(res, 200, g) : send(res, 404, { error: "Guide not found" });
    }
    if (p === "/" || p.startsWith("/g/") || p === "/about") return serveStatic(res, "index.html");
    return serveStatic(res, p.slice(1));
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: "Server error" });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`OAuth Launchpad on http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) console.log("No ANTHROPIC_API_KEY - live generation disabled, library still served.");
});
