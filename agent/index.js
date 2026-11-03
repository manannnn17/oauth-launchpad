// Picks the live agent's model provider from the environment.
// AGENT_PROVIDER=gemini|anthropic forces one; otherwise whichever key is set (Gemini first).
import { generateGuide as generateGuideClaude, describeApiError } from "./research.js";
import { generateGuideGemini, GeminiError } from "./gemini.js";

export function activeProvider() {
  const forced = process.env.AGENT_PROVIDER;
  if (forced === "gemini" || forced === "anthropic") return forced;
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return "anthropic";
  return null;
}

export function activeModel() {
  const provider = activeProvider();
  if (provider === "gemini") return process.env.GEMINI_MODEL || "gemini-2.5-flash";
  if (provider === "anthropic") return process.env.AGENT_MODEL || "claude-opus-5-5";
  return null;
}

export function generateGuide(query, emit) {
  return activeProvider() === "gemini" ? generateGuideGemini(query, emit) : generateGuideClaude(query, emit);
}

export function describeError(err) {
  if (err instanceof GeminiError) {
    if (err.status === 400 && /api key/i.test(err.message)) return "Invalid GEMINI_API_KEY on the server.";
    if (err.status === 403) return `Gemini API refused the key: ${err.message}`;
    if (err.status === 429) return "Gemini API quota or rate limit reached - try again shortly.";
    return `Gemini API error ${err.status}: ${err.message}`;
  }
  if (err?.name === "TimeoutError") return "The model took too long to respond - try again.";
  return describeApiError(err);
}
