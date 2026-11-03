# OAuth Launchpad

**Know what it takes to get a provider OAuth app approved before you start.**

A developer building an AI agent looks up an app such as Slack, Gmail or Salesforce. They get a shareable guide that answers four questions:

1. **How hard is it?** An access tier (self-serve, self-serve with caveats, review required, partner-gated) and a 1-5 difficulty. Difficulty depends on the scopes, so each guide also shows a *scope paths* table. For example, Google sign-in works the same day, while reading Gmail needs a security assessment.
2. **How long will it take?** Hands-on time, time to the first test connection, and time until *any* user can connect, plus what the waiting time is made of.
3. **What could block me?** Prerequisites, gotchas, token and runtime facts, and a blocker playbook that maps what you'll see to what to do next.
4. **What does an agent do, and what do I do?** Every step is owned by **You**, an **Agent** or the **Provider** (waiting). Guides also include checklist progress, a Markdown export and a print view.

If an app isn't in the library, a **live agent** researches it in about 2-4 minutes, shows its work as it goes, and saves a guide in the same format.

## Run it

Requires Node 22.9+. Live generation needs **one** model key: a Google AI Studio key (`GEMINI_API_KEY`) or a Claude key (`ANTHROPIC_API_KEY`). Copy `.env.example` to `.env` and paste the key after the `=` (`.env` is gitignored), or set it in your host's environment.

```bash
npm install
```

```bash
npm start
```

Open http://localhost:3000. The library works without any key.


Other commands:

```bash
npm test                          # schema-validate all guides + offline tests of both agent providers
```

```bash
npm run generate -- "Zoom"        # run the agent from the CLI (smoke test / pre-generate)
```

**Deploy:** any Node host works (Render, Railway, Fly). Set the build command to `npm install`, the start command to `npm start`, and set `GEMINI_API_KEY` (or `ANTHROPIC_API_KEY`) as a secret. Generated guides are written to `data/generated/`. Use a persistent disk if you want them to survive redeploys.

| Env var | Default | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | - | Enables live generation with Gemini (Google AI Studio) |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Gemini model |
| `ANTHROPIC_API_KEY` | - | Enables live generation with Claude |
| `AGENT_MODEL` | `claude-opus-5-5` | Claude model |
| `AGENT_PROVIDER` | auto | `gemini` or `anthropic`; by default Gemini is used if its key is set |
| `AGENT_FALLBACKS` | `default` | Claude only: server-side refusal fallback (beta). Set to `off` if your account rejects it |
| `PORT` | `3000` | |

## What's in the library

Six curated apps were chosen to cover each kind of setup challenge, not just the easy ones:

| App | Tier | Why it's here |
|---|---|---|
| GitHub | Self-serve (1/5) | Baseline. The real decision is GitHub App vs OAuth App. |
| Notion | Self-serve (1/5) | No review needed, but page-level sharing affects agent UX. |
| Slack | Self-serve + caveats (3/5) | Unlisted apps get **1 req/min** on history reads. The Marketplace needs 10 active workspaces and up to ~10 weeks of review. |
| Salesforce | Self-serve + caveats (3/5) | **Spring '26 disabled new Connected Apps.** Most tutorials are now wrong. |
| Gmail | Review required (4/5) | Restricted scopes, annual CASA assessment, 100-user cap, 7-day tokens while testing. |
| LinkedIn | Partner-gated (5/5) | Only sign-in and posting are open. Everything else needs discretionary approval. |

Plus two **agent-generated** guides from live runs, reviewed and annotated: **Xero** (pricing-tier connection caps, AI/ML data-use ban) and **Zoom** (mandatory Marketplace review).

## Key decisions

- **Optimise for the planning question, not the click-path.** Developers mostly get stuck on "is this an hour or a quarter, and what's on the critical path?", not on which button to press. Every guide therefore leads with the tier, the three time figures and a *bottom line* that names the longest-lead item to start first. Step-by-step instructions come after.
- **Difficulty is a function of scopes.** "How hard is Google?" has no single answer. The scope-paths table makes the trade-off explicit, so a developer can choose a narrower scope to avoid a review.
- **Separate the developer's effort from calendar time.** "1-2 hours of work, 2-4 months of waiting" calls for a very different plan than "3 days of work".
- **One schema for curated and generated guides.** `agent/schema.js` is used for three things: Claude's structured output, the validator in `npm test`, and the UI and Markdown renderers. Curated and generated guides therefore can't drift apart, and the library can grow towards 100 apps by generating guides and then promoting reviewed ones.
- **Evidence over confidence.** Every key claim is labelled `tested`, `official_docs`, `third_party` or `inferred`, with a note on what was checked. Open questions are listed rather than guessed. Agent-generated guides also include the full research log: searches, pages read, probes and raw notes.
- **Agents attempt the setup, as far as they safely can.** The agent's `probe_url` tool hits the authorise endpoint with a dummy client ID, reads OIDC discovery and checks the developer console. It is HTTPS-only, refuses private and loopback addresses, sends no credentials and never submits forms. Signing up, accepting terms, DNS, demo videos and paying for assessments are marked as human steps.
- **Managed apps as an escape hatch.** Each guide checks a snapshot of the [Composio managed-auth catalog](https://docs.composio.dev/toolkits/managed-auth). If a managed app exists, the guide says you can launch on it while your own app is in review. If the app is bring-your-own, the guide flags that this setup is on your critical path.
- **Zero-build stack.** Plain Node `http` and vanilla JS, with one dependency (`@anthropic-ai/sdk`). It's easy to review and runs anywhere.

## How the live agent works

Two interchangeable providers produce the same guide format (`agent/index.js` picks one from the environment).

**Gemini** (`agent/gemini.js`): (1) one research call with Google Search grounding and URL context, which ends its notes with URLs worth probing; (2) our guarded `probe_url` requests those URLs; (3) a structured-output call (JSON schema) turns notes and probe results into the guide. Search queries and sources read come from the grounding metadata and are shown live.

**Claude** (`agent/research.js`):

1. **Research loop.** Claude Opus 5.5 runs with server-side `web_search` and `web_fetch` plus the client-side `probe_url` tool. It handles `pause_turn` and tool-use turns, and streams progress to the UI as NDJSON. The prompt asks for provider docs first, changelogs for recent changes, and notes tagged by evidence type.
2. **Structuring pass.** A second call turns the notes and probe results into the guide using JSON-schema structured outputs. Evidence labels must stay faithful: only probes count as `tested`.
3. **Persist and share.** The guide is saved to `data/generated/<slug>.json` and is available at `/g/<slug>`. Requests that match an existing guide (by name or domain) open it instead of regenerating, with a "research again" option.

## Verification

See [docs/VERIFICATION.md](docs/VERIFICATION.md). In summary, the sample's key claims were checked against provider docs and five guides were corrected. Live agent runs on Xero and Zoom were also reviewed: the agent got token and policy facts right, but tied a connection cap to the wrong cause, and its probes caught a hallucinated console URL. Examples: `gmail.metadata` is a *restricted* scope, and GitHub's default org restriction applies to OAuth Apps but not GitHub Apps. The report also lists what couldn't be verified.

## Limitations

- **Six curated guides, not 100.** The schema, generator and CLI are the path to scaling. A real library would add a review queue before generated guides are promoted.
- **No real app registrations or approvals.** Steps that need a provider account were researched, not performed.
- **Generated guides need review.** Live runs on Xero and Zoom worked end to end but contained errors that human review caught (see VERIFICATION.md). Generated guides are labelled as agent-generated and should be reviewed before being promoted to the library.
- **Gemini free-tier capacity.** Gemini can return transient 503 "high demand" errors. The client retries with backoff, but a run can still fail during a capacity spike - simply retry.
- **Guides go stale.** Every guide shows its review or generation date. Generated guides are cached for 7 days. A production version would re-verify on a schedule and diff against the previous version.
- **Single-node demo server.** There is no auth or per-user rate limiting beyond a concurrency cap of 3, and storage is the filesystem.

## Layout

```
server.js            HTTP server: UI, /api/guides, /api/guides/:slug(.md), /api/generate (NDJSON stream)
agent/schema.js      Guide JSON schema (structured outputs + validation + labels)
agent/research.js    Two-phase agent (research loop → structured guide)
lib/probe.js         Guarded HTTP probe used by the agent
lib/managed.js       Managed-auth catalog lookup
lib/markdown.js      Markdown export
data/guides/         Curated guides
data/generated/      Agent-generated guides (gitignored)
public/              UI (vanilla JS)
scripts/             check-guides, test-agent, generate CLI
docs/VERIFICATION.md What was checked, corrected and left uncertain
```
