// Gemini variant of the live agent (Google AI Studio key). Same output as the
// Claude agent, in three steps because Gemini runs its search tools in one call:
//   1. Research - Google Search grounding + URL context read the provider's docs;
//      the model ends its notes with candidate URLs to probe.
//   2. Probe   - our guarded probe_url hits those URLs (account-free setup attempts).
//   3. Structure - JSON-schema structured output turns notes + probe results into a guide.
import { GUIDE_SCHEMA } from "./schema.js";
import { RESEARCH_SYSTEM, STRUCTURE_SYSTEM, today } from "./research.js";
import { probeUrl } from "../lib/probe.js";

const MODEL = () => process.env.GEMINI_MODEL || "gemini-2.5-flash";
const API = "https://generativelanguage.googleapis.com/v1beta";
const MAX_PROBES = 6;

const PROBE_PARAGRAPH = /Attempt what can be attempted without an account using probe_url:[\s\S]*?Never sign up, submit forms, or send credentials\./;
const GEMINI_RESEARCH_SYSTEM = RESEARCH_SYSTEM
  .replace(
    PROBE_PARAGRAPH,
    `After your notes, add a section PROBE_URLS listing up to ${MAX_PROBES} public https URLs (one per line) that a separate tool will request without credentials, to attempt the account-free parts of setup:
- the OIDC discovery document (https://<issuer>/.well-known/openid-configuration) if one exists,
- the authorize endpoint with client_id=oauth-launchpad-dummy and redirect_uri=https://example.com/callback,
- the app-registration console URL.
Never sign up, submit forms, or send credentials.`
  )
  .replace("[tested] (only for probe_url results) or [inferred]", "or [inferred] (probe results are added separately)")
  .replace("- UNKNOWNS: what you could not establish.", "- UNKNOWNS: what you could not establish.\n- PROBE_URLS: as described above.");

export class GeminiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function generate(body, timeoutMs = 240_000) {
  const res = await fetch(`${API}/models/${encodeURIComponent(MODEL())}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new GeminiError(res.status, data.error?.message || res.statusText);
  const candidate = data.candidates?.[0];
  if (!candidate) throw new GeminiError(200, `No response (${data.promptFeedback?.blockReason || "empty"})`);
  const text = (candidate.content?.parts ?? []).filter((p) => p.text && !p.thought).map((p) => p.text).join("");
  return { text, candidate };
}

async function research(query, log, emit) {
  emit({ type: "search", query: `${query} OAuth app setup, scopes, review and verification` });
  const { text, candidate } = await generate({
    systemInstruction: { parts: [{ text: GEMINI_RESEARCH_SYSTEM }] },
    contents: [
      {
        role: "user",
        parts: [{ text: `Provider to investigate: ${query}\n\nResearch how a developer sets up and gets approval for an OAuth app with this provider so an AI agent can act on behalf of the developer's users. Cite the URL for every fact.` }],
      },
    ],
    tools: [{ google_search: {} }, { url_context: {} }],
  });

  // Surface what the model actually searched and read.
  const grounding = candidate.groundingMetadata ?? {};
  for (const q of grounding.webSearchQueries ?? []) {
    log.searches.push(q);
    emit({ type: "search", query: q });
  }
  const read = [
    ...(candidate.urlContextMetadata?.urlMetadata ?? []).map((m) => m.retrievedUrl),
    ...(grounding.groundingChunks ?? []).map((c) => c.web?.title && c.web?.uri ? `${c.web.title} (${c.web.uri})` : c.web?.uri),
  ].filter(Boolean);
  for (const u of [...new Set(read)]) {
    log.fetches.push(u);
    emit({ type: "fetch", url: u });
  }
  emit({ type: "result", message: `${log.searches.length} searches, ${log.fetches.length} sources` });
  if (!text.trim()) throw new GeminiError(200, `Research returned no notes (finish reason ${candidate.finishReason})`);
  return text;
}

function probeTargets(notes) {
  const section = notes.split(/PROBE_URLS:?/i)[1] ?? "";
  const urls = section.match(/https:\/\/[^\s)<>"'`\]]+/g) ?? [];
  return [...new Set(urls.map((u) => u.replace(/[.,;]+$/, "")))].slice(0, MAX_PROBES);
}

async function probeAll(notes, log, emit) {
  for (const url of probeTargets(notes)) {
    const purpose = /well-known/.test(url) ? "OIDC discovery" : /client_id=/.test(url) ? "authorize endpoint with dummy client" : "developer console / registration page";
    emit({ type: "probe", url, purpose });
    try {
      const result = await probeUrl(url);
      log.probes.push({ url, purpose, at: new Date().toISOString(), result });
      emit({ type: "result", message: `HTTP ${result.status}${result.oauth_signals?.length ? " - " + result.oauth_signals[0] : result.title ? " - " + result.title : ""}` });
    } catch (err) {
      log.probes.push({ url, purpose, at: new Date().toISOString(), error: String(err.message || err) });
      emit({ type: "result", message: `probe failed: ${err.message || err}` });
    }
  }
}

async function structure(query, notes, log) {
  const probeSummary = log.probes.map((p) => ({ url: p.url, purpose: p.purpose, result: p.result ?? { error: p.error } }));
  const { text, candidate } = await generate({
    systemInstruction: { parts: [{ text: STRUCTURE_SYSTEM }] },
    contents: [
      {
        role: "user",
        parts: [{ text: `Provider requested by the developer: ${query}\nDate of research: ${today()}\n\n<research_notes>\n${notes}\n</research_notes>\n\n<probe_results>\n${JSON.stringify(probeSummary, null, 1).slice(0, 30000)}\n</probe_results>\n\nWrite the guide.` }],
      },
    ],
    generationConfig: { responseMimeType: "application/json", responseJsonSchema: GUIDE_SCHEMA, maxOutputTokens: 32000 },
  });
  if (candidate.finishReason === "MAX_TOKENS") throw new GeminiError(200, "Guide output was truncated.");
  return JSON.parse(text);
}

export async function generateGuideGemini(query, emit) {
  const log = { searches: [], fetches: [], probes: [] };
  const started = Date.now();

  emit({ type: "phase", phase: "research", message: `Researching ${query}` });
  const notes = await research(query, log, emit);

  emit({ type: "phase", phase: "probe", message: "Attempting account-free setup steps" });
  await probeAll(notes, log, emit);

  emit({ type: "phase", phase: "structure", message: "Turning findings into a guide" });
  emit({ type: "writing", chars: 0 });
  const guide = await structure(query, notes, log);

  return {
    guide,
    meta: {
      query,
      model: MODEL(),
      generated_at: new Date().toISOString(),
      duration_s: Math.round((Date.now() - started) / 1000),
      research_log: log,
      research_notes: notes,
    },
  };
}
