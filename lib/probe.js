// The agent's "hands": a guarded HTTP GET it can use to attempt the parts of a
// setup that need no account - hit an authorize endpoint with a dummy
// client_id, read an OIDC discovery document, see whether a developer console
// sits behind a login wall. Results become "tested" evidence in the guide.
import { lookup } from "node:dns/promises";
import net from "node:net";

const MAX_BYTES = 200_000;
const MAX_HOPS = 4;
const TIMEOUT_MS = 10_000;

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 || a === 127 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

async function assertPublicHttps(raw) {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("Only https:// URLs can be probed");
  const addrs = await lookup(url.hostname, { all: true });
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new Error("Refusing to probe a private or loopback address");
  return url;
}

const strip = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

// Surfaces the OAuth-ish error strings providers bury in pages and redirects.
function oauthSignals(text) {
  const found = new Set();
  const re = /(invalid_client|invalid_request|invalid_scope|unauthorized_client|redirect_uri[^.]{0,60}|client[_ ]id[^.]{0,60}(invalid|not found|does not exist)|OAuth client was not found)/gi;
  for (const m of text.matchAll(re)) found.add(m[0].slice(0, 120));
  for (const m of text.matchAll(/[?&]error=([a-z_]+)/g)) found.add(`error=${m[1]}`);
  // Google encodes the reason in a base64 authError query parameter.
  for (const m of text.matchAll(/authError=([A-Za-z0-9_-]+)/g)) {
    const decoded = Buffer.from(m[1], "base64url").toString("latin1").replace(/[^\x20-\x7e]+/g, " ").trim();
    if (decoded) found.add(`authError: ${decoded}`);
  }
  return [...found].slice(0, 8);
}

async function readCapped(res) {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  reader.cancel().catch(() => {});
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

export async function probeUrl(rawUrl) {
  const hops = [];
  let current = rawUrl;
  for (let i = 0; i < MAX_HOPS; i++) {
    const url = await assertPublicHttps(current);
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": "oauth-launchpad-probe/1.0 (+setup research; no credentials)" },
    });
    const location = res.headers.get("location");
    hops.push({ url: url.toString(), status: res.status, location: location ?? undefined });
    if (res.status >= 300 && res.status < 400 && location) {
      // Redirect targets often carry the provider's error code (e.g. Google's authError).
      current = new URL(location, url).toString();
      continue;
    }
    const contentType = res.headers.get("content-type") ?? "";
    const body = await readCapped(res);
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(body)?.[1]?.trim() ?? "";
    let json;
    if (contentType.includes("json")) {
      try { json = JSON.parse(body); } catch { /* not JSON after all */ }
    }
    const text = json ? JSON.stringify(json).slice(0, 2500) : strip(body).slice(0, 1500);
    return {
      final_url: url.toString(),
      status: res.status,
      content_type: contentType,
      title,
      redirects: hops.slice(0, -1),
      looks_like_login_wall: /sign in|log in|login/i.test(title) || /\/login|signin/i.test(url.pathname),
      oauth_signals: oauthSignals(hops.map((h) => h.location ?? "").join(" ") + " " + body),
      excerpt: text,
    };
  }
  return { final_url: current, status: "too_many_redirects", redirects: hops, oauth_signals: oauthSignals(hops.map((h) => h.location ?? "").join(" ")) };
}
