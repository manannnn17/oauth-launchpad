// Live guide generation: a two-phase agent.
//   1. Research - Claude searches and reads provider docs (server-side web
//      tools) and "attempts" the account-free parts of setup with probe_url.
//   2. Structure - a second call turns the research notes into a guide that
//      matches GUIDE_SCHEMA exactly (structured outputs), keeping evidence labels.
// Progress is reported through emit() so the UI can show the agent working.
import Anthropic from "@anthropic-ai/sdk";
import { GUIDE_SCHEMA } from "./schema.js";
import { probeUrl } from "../lib/probe.js";

const MODEL = process.env.AGENT_MODEL || "claude-opus-5-5";
const MAX_RESEARCH_TURNS = 14;
const MAX_PROBES = 8;

// Server-side refusal fallback (beta) - on by default, AGENT_FALLBACKS=off to drop it.
const fallbackParams = () =>
  process.env.AGENT_FALLBACKS === "off"
    ? {}
    : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };

const today = () => new Date().toISOString().slice(0, 10);

const RESEARCH_SYSTEM = `You are an integrations researcher helping developers who build AI agents. Their end users will connect a third-party account to the agent via OAuth, so the developer must create an OAuth app with the provider and get it ready (and, where required, approved) for production.

Your job: investigate ONE provider and produce research notes a guide can be built from. Today is ${today()}.

Find out, preferring the provider's own documentation:
1. Whether the provider supports OAuth for third-party apps at all (if not - e.g. API keys only - say so clearly and stop early).
2. Where and how to register the app (console URL, app types and which to choose for an agent acting on behalf of users).
3. Which scopes/permissions an agent typically needs, and which of them trigger review, verification, partner approval, or are closed.
4. The review/verification/partner process: prerequisites (domain, privacy policy, company page, legal entity, installs, demo video, security assessment), stated timelines, and costs.
5. Development vs production differences (test users, sandbox, user caps, warning screens).
6. Token behaviour: access/refresh lifetimes, rotation, PKCE, redirect URI rules, rate limits or restrictions that hit agents.
7. Recent changes (roughly last 18 months) from changelogs or release notes that make older tutorials wrong.

Attempt what can be attempted without an account using probe_url:
- the OIDC discovery document (https://<issuer>/.well-known/openid-configuration) if one exists,
- the authorize endpoint with client_id=oauth-launchpad-dummy and redirect_uri=https://example.com/callback, to confirm the endpoint and how it reports a bad client,
- the app-registration console URL, to confirm it exists and whether it is behind a login.
Never sign up, submit forms, or send credentials.

Be efficient: a handful of targeted searches, then fetch the most authoritative pages. Stop when you can answer the questions above or have established they are not documented.

Finish with research notes in plain text:
- FACTS: one bullet per fact, tagged [official], [third-party], [tested] (only for probe_url results) or [inferred], each with its URL.
- CONFLICTS: where sources disagree.
- UNKNOWNS: what you could not establish.`;

const STRUCTURE_SYSTEM = `You turn research notes about a provider's OAuth app setup into a developer guide that matches the provided JSON schema.

Rules:
- Only state what the notes support. If something is unknown, say so in open_questions instead of guessing.
- claims[].evidence must be faithful: "tested" only for probe_url results, "official_docs" for the provider's own docs, "third_party" for other sites, "inferred" for anything else. Prefer claims that most affect the developer's decisions.
- Time estimates are ranges, and must separate the developer's hands-on time from calendar waiting (reviews, partner decisions, installs).
- difficulty: 1 = minutes, no review; 2 = self-serve with some config effort; 3 = self-serve but production caveats (limits, admin approvals, install thresholds); 4 = formal review/verification measured in weeks; 5 = partner-gated, approval not guaranteed.
- scope_paths must show how difficulty changes with what the developer asks for (e.g. sign-in only vs read data).
- Steps must be concrete (console paths, fields, values). Mark owner "agent" only for work an AI agent could really do (research, drafting, config generation, code, probing); "you" for anything requiring account access, legal identity, payment, DNS or recordings; "provider" for waiting on the provider.
- Write for a developer who will follow and share this without further explanation. Be direct and specific.
- Use empty strings for unknown URLs.`;

const PROBE_TOOL = {
  name: "probe_url",
  description:
    "Perform a single HTTPS GET (no credentials, redirects followed and reported) against a public URL and return status, redirect chain, page title, any OAuth error strings found, and a short text excerpt. Use it to attempt account-free setup steps: OIDC discovery documents, an authorize endpoint with a dummy client_id, or a developer-console URL. Results count as [tested] evidence.",
  strict: true,
  eager_input_streaming: true,
  input_schema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Absolute https:// URL to probe" },
      purpose: { type: "string", description: "What this probe is meant to establish" },
    },
    required: ["url", "purpose"],
    additionalProperties: false,
  },
};

const RESEARCH_TOOLS = [
  { type: "web_search_20260209", name: "web_search", max_uses: 10 },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 12 },
  PROBE_TOOL,
];

function describeBlock(block, log, emit) {
  if (block.type === "server_tool_use") {
    if (block.name === "web_search") {
      log.searches.push(block.input?.query ?? "");
      emit({ type: "search", query: block.input?.query ?? "" });
    } else if (block.name === "web_fetch") {
      log.fetches.push(block.input?.url ?? "");
      emit({ type: "fetch", url: block.input?.url ?? "" });
    }
  } else if (block.type === "web_search_tool_result") {
    const n = Array.isArray(block.content) ? block.content.length : 0;
    emit({ type: "result", message: Array.isArray(block.content) ? `${n} results` : `search error: ${block.content?.error_code}` });
  } else if (block.type === "web_fetch_tool_result") {
    const err = block.content?.type === "web_fetch_tool_error" ? block.content.error_code : null;
    emit({ type: "result", message: err ? `fetch failed: ${err}` : "page read" });
  }
}

async function runProbe(toolUse, log, emit) {
  const input = toolUse.input;
  if (!input || typeof input.url !== "string") {
    return { type: "tool_result", tool_use_id: toolUse.id, is_error: true, content: "INVALID_INPUT: expected {url, purpose}" };
  }
  if (log.probes.length >= MAX_PROBES) {
    return { type: "tool_result", tool_use_id: toolUse.id, is_error: true, content: "Probe budget exhausted; finish with what you have." };
  }
  emit({ type: "probe", url: input.url, purpose: input.purpose });
  try {
    const result = await probeUrl(input.url);
    log.probes.push({ url: input.url, purpose: input.purpose, at: new Date().toISOString(), result });
    emit({ type: "result", message: `HTTP ${result.status}${result.oauth_signals?.length ? " - " + result.oauth_signals[0] : result.title ? " - " + result.title : ""}` });
    return { type: "tool_result", tool_use_id: toolUse.id, content: JSON.stringify(result) };
  } catch (err) {
    log.probes.push({ url: input.url, purpose: input.purpose, at: new Date().toISOString(), error: String(err.message || err) });
    emit({ type: "result", message: `probe failed: ${err.message || err}` });
    return { type: "tool_result", tool_use_id: toolUse.id, is_error: true, content: String(err.message || err) };
  }
}

async function research(client, query, log, emit) {
  const messages = [
    { role: "user", content: `Provider to investigate: ${query}\n\nResearch how a developer sets up and gets approval for an OAuth app with this provider so an AI agent can act on behalf of the developer's users.` },
  ];

  for (let turn = 0; turn < MAX_RESEARCH_TURNS; turn++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      system: RESEARCH_SYSTEM,
      tools: RESEARCH_TOOLS,
      output_config: { effort: "medium" },
      messages,
      ...fallbackParams(),
    });
    stream.on("contentBlock", (block) => describeBlock(block, log, emit));
    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") throw new Error("The model declined this request.");
    messages.push({ role: "assistant", content: message.content });

    if (message.stop_reason === "pause_turn") continue;
    if (message.stop_reason === "tool_use") {
      const toolUses = message.content.filter((b) => b.type === "tool_use");
      // All results go back in one user message so Claude keeps calling tools in parallel.
      const results = await Promise.all(toolUses.map((t) => runProbe(t, log, emit)));
      messages.push({ role: "user", content: results });
      continue;
    }
    if (message.stop_reason === "max_tokens") throw new Error("Research ran out of output tokens.");

    const notes = message.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (!notes) throw new Error("Research finished without notes.");
    return notes;
  }
  throw new Error("Research did not finish within the turn budget.");
}

async function structure(client, query, notes, log, emit) {
  const probeSummary = log.probes.map((p) => ({ url: p.url, purpose: p.purpose, result: p.result ?? { error: p.error } }));
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    system: STRUCTURE_SYSTEM,
    output_config: { effort: "medium", format: { type: "json_schema", schema: GUIDE_SCHEMA } },
    messages: [
      {
        role: "user",
        content: `Provider requested by the developer: ${query}\nDate of research: ${today()}\n\n<research_notes>\n${notes}\n</research_notes>\n\n<probe_results>\n${JSON.stringify(probeSummary, null, 1).slice(0, 30000)}\n</probe_results>\n\nWrite the guide.`,
      },
    ],
    ...fallbackParams(),
  });
  let chars = 0;
  let lastEmit = 0;
  stream.on("text", (delta) => {
    chars += delta.length;
    if (chars - lastEmit > 1500) {
      lastEmit = chars;
      emit({ type: "writing", chars });
    }
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new Error("The model declined to write this guide.");
  if (message.stop_reason === "max_tokens") throw new Error("Guide output was truncated.");
  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text);
}

// `client` is injectable so the loop can be tested without network access.
export async function generateGuide(query, emit, client = new Anthropic()) {
  const log = { searches: [], fetches: [], probes: [] };
  const started = Date.now();

  emit({ type: "phase", phase: "research", message: `Researching ${query}` });
  const notes = await research(client, query, log, emit);

  emit({ type: "phase", phase: "structure", message: "Turning findings into a guide" });
  const guide = await structure(client, query, notes, log, emit);

  return {
    guide,
    meta: {
      query,
      model: MODEL,
      generated_at: new Date().toISOString(),
      duration_s: Math.round((Date.now() - started) / 1000),
      research_log: log,
      research_notes: notes,
    },
  };
}

export function describeApiError(err) {
  if (err instanceof Anthropic.AuthenticationError) return "Invalid or missing ANTHROPIC_API_KEY on the server.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the Claude API - try again in a minute.";
  if (err instanceof Anthropic.BadRequestError) return `Claude API rejected the request: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status}: ${err.message}`;
  if (err instanceof SyntaxError) return "The agent returned a guide that wasn't valid JSON.";
  return String(err?.message || err);
}
