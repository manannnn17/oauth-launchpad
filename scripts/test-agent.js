// Offline test of the agent loop with a scripted fake Claude client:
// server-tool progress events, pause_turn resumption, a real probe_url call,
// and the structured-output phase producing a schema-valid guide.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateGuide } from "../agent/research.js";

const sample = JSON.parse(readFileSync(new URL("../data/guides/notion.json", import.meta.url), "utf8"));
for (const k of ["slug", "source", "reviewed_on"]) delete sample[k];

const requests = [];
const script = [
  // Turn 1: a web search, then the server pauses the turn.
  {
    blocks: [
      { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "Notion OAuth public integration" } },
      { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: "https://developers.notion.com/docs/authorization", title: "Authorization" }] },
    ],
    stop_reason: "pause_turn",
  },
  // Turn 2: a fetch plus a client-side probe.
  {
    blocks: [
      { type: "server_tool_use", id: "f1", name: "web_fetch", input: { url: "https://developers.notion.com/docs/authorization" } },
      { type: "web_fetch_tool_result", tool_use_id: "f1", content: { type: "web_fetch_result", url: "https://developers.notion.com/docs/authorization" } },
      { type: "tool_use", id: "p1", name: "probe_url", input: { url: "https://accounts.google.com/.well-known/openid-configuration", purpose: "OIDC discovery" } },
    ],
    stop_reason: "tool_use",
  },
  // Turn 3: final research notes.
  { blocks: [{ type: "text", text: "FACTS:\n- [official] No review required ... https://developers.notion.com/docs/authorization" }], stop_reason: "end_turn" },
  // Structure phase: JSON guide.
  { blocks: [{ type: "text", text: JSON.stringify(sample) }], stop_reason: "end_turn" },
];

const fakeClient = {
  beta: {
    messages: {
      stream(params) {
        requests.push(structuredClone(params));
        const step = script.shift();
        assert.ok(step, "unexpected extra API call");
        const handlers = { contentBlock: [], text: [] };
        return {
          on(evt, fn) { handlers[evt]?.push(fn); return this; },
          async finalMessage() {
            for (const b of step.blocks) {
              handlers.contentBlock.forEach((fn) => fn(b));
              if (b.type === "text") handlers.text.forEach((fn) => fn(b.text));
            }
            return { content: step.blocks, stop_reason: step.stop_reason };
          },
        };
      },
    },
  },
};

const events = [];
const { guide, meta } = await generateGuide("Notion", (e) => events.push(e), fakeClient);

assert.equal(requests.length, 4, "3 research turns + 1 structure call");
assert.equal(requests[0].model, "claude-opus-5-5");
assert.deepEqual(requests[0].tools.map((t) => t.name), ["web_search", "web_fetch", "probe_url"]);
// pause_turn: the paused assistant turn is appended and the request re-sent.
assert.equal(requests[1].messages.at(-1).role, "assistant");
// tool_use: the probe result comes back as a tool_result in one user message.
const toolResults = requests[2].messages.at(-1);
assert.equal(toolResults.role, "user");
assert.equal(toolResults.content[0].type, "tool_result");
assert.equal(toolResults.content[0].tool_use_id, "p1");
assert.ok(JSON.parse(toolResults.content[0].content).status === 200, "live probe returned 200");
// Structure call uses structured outputs and no tools.
assert.equal(requests[3].output_config.format.type, "json_schema");
assert.equal(requests[3].tools, undefined);

assert.equal(guide.name, "Notion");
assert.deepEqual(meta.research_log.searches, ["Notion OAuth public integration"]);
assert.equal(meta.research_log.probes.length, 1);
const types = events.map((e) => e.type);
for (const t of ["phase", "search", "fetch", "probe", "result"]) assert.ok(types.includes(t), `emits ${t}`);

console.log(`agent loop ok - ${events.length} progress events: ${[...new Set(types)].join(", ")}`);

// ---- Gemini provider: stub only the Gemini API, let probes hit the network ----
const { generateGuideGemini } = await import("../agent/gemini.js");
process.env.GEMINI_API_KEY = "test-key";
const realFetch = globalThis.fetch;
const geminiBodies = [];
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith("https://generativelanguage.googleapis.com/")) return realFetch(url, init);
  const body = JSON.parse(init.body);
  geminiBodies.push(body);
  const research = geminiBodies.length === 1;
  const candidate = research
    ? {
        content: { parts: [{ text: "FACTS:\n- [official] ... https://developers.notion.com/docs/authorization\nPROBE_URLS:\nhttps://accounts.google.com/.well-known/openid-configuration\n" }] },
        groundingMetadata: { webSearchQueries: ["notion oauth review"], groundingChunks: [{ web: { uri: "https://vertexaisearch.example/x", title: "developers.notion.com" } }] },
        urlContextMetadata: { urlMetadata: [{ retrievedUrl: "https://developers.notion.com/docs/authorization" }] },
        finishReason: "STOP",
      }
    : { content: { parts: [{ text: JSON.stringify(sample) }] }, finishReason: "STOP" };
  return new Response(JSON.stringify({ candidates: [candidate] }), { status: 200, headers: { "content-type": "application/json" } });
};
const gEvents = [];
const gemini = await generateGuideGemini("Notion", (e) => gEvents.push(e));
globalThis.fetch = realFetch;
assert.equal(geminiBodies.length, 2, "research + structure calls");
assert.deepEqual(geminiBodies[0].tools, [{ google_search: {} }, { url_context: {} }]);
assert.ok(geminiBodies[0].systemInstruction.parts[0].text.includes("PROBE_URLS"));
assert.equal(geminiBodies[1].generationConfig.responseMimeType, "application/json");
assert.equal(gemini.meta.research_log.probes[0].result.status, 200, "probe ran against the live URL");
assert.deepEqual(gemini.meta.research_log.searches, ["notion oauth review"]);
assert.equal(gemini.guide.name, "Notion");
console.log(`gemini pipeline ok - ${gEvents.length} progress events`);
