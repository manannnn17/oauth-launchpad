// One schema for every guide - curated or agent-generated - so the UI, the
// Markdown export and the structured-output call all agree on the shape.
// Written as plain JSON Schema because it is sent as-is to Claude's structured
// outputs (every object: all properties required, additionalProperties false).

const str = (description) => ({ type: "string", description });
const strArr = (description) => ({ type: "array", items: { type: "string" }, description });
const obj = (properties, description) => ({
  type: "object",
  description,
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const arr = (items, description) => ({ type: "array", items, description });
const enumOf = (values, description) => ({ type: "string", enum: values, description });

export const ACCESS_TIERS = ["self_serve", "self_serve_with_caveats", "review_required", "partner_gated"];
export const EVIDENCE = ["tested", "official_docs", "third_party", "inferred"];
export const OWNERS = ["you", "agent", "provider"];

export const TIER_LABELS = {
  self_serve: "Self-serve",
  self_serve_with_caveats: "Self-serve, with production caveats",
  review_required: "Provider review required",
  partner_gated: "Partner-gated",
};

export const EVIDENCE_LABELS = {
  tested: "Tested by probe",
  official_docs: "Official docs",
  third_party: "Third-party source",
  inferred: "Inferred / unverified",
};

const scopePath = obj(
  {
    name: str("Short name of what the developer wants to do, e.g. 'Sign-in only' or 'Read Gmail'"),
    scopes: strArr("Exact scope / permission strings"),
    tier: enumOf(ACCESS_TIERS, "Access tier this path lands in"),
    review: str("What review/approval this path triggers, or 'None'"),
    time_to_production: str("Calendar time until any user can connect, e.g. 'Same day' or '4-8 weeks'"),
  },
  "One way to use the app. Difficulty depends on which path the developer needs."
);

const step = obj(
  {
    title: str("Imperative step title"),
    owner: enumOf(OWNERS, "Who does it: you (human with account access), agent (can be automated or drafted), provider (waiting on them)"),
    duration: str("Hands-on or waiting time, e.g. '10 min' or '3-5 business days'"),
    detail: str("Concrete instructions: exact console path, fields, values"),
    url: str("Direct link to the console page or doc, or empty string"),
  },
  "A single action in the setup"
);

const stage = obj(
  {
    name: str("Stage name, e.g. 'Register the app' or 'Get verified'"),
    goal: str("What is true when this stage is done"),
    steps: arr(step, "Ordered steps"),
  },
  "A stage of the setup"
);

const claim = obj(
  {
    claim: str("A specific factual statement the guide relies on"),
    evidence: enumOf(EVIDENCE, "How it is supported"),
    source_url: str("URL supporting the claim, or empty string if inferred"),
    note: str("What exactly was checked or why it is uncertain"),
  },
  "An evidence-labelled claim"
);

export const GUIDE_SCHEMA = obj({
  name: str("Provider / app name, e.g. 'Gmail (Google)'"),
  website: str("Provider homepage"),
  category: str("Category, e.g. 'Email', 'CRM', 'Dev tools'"),
  summary: str("Two sentences: what setting up an OAuth app with this provider is like and the single biggest thing to know"),
  access_tier: enumOf(ACCESS_TIERS, "Overall tier for the most common agent use case"),
  difficulty: { type: "integer", description: "1 (minutes, no review) to 5 (gated partnership, approval not guaranteed)" },
  difficulty_reason: str("One sentence justifying the difficulty score"),
  effort: obj(
    {
      hands_on: str("Developer's own working time to reach a working dev connection, e.g. '20-40 min'"),
      first_connection: str("Calendar time until the developer can connect their OWN account, e.g. 'Same day'"),
      production: str("Calendar time until ANY customer can connect without warnings/limits, e.g. '4-8 weeks incl. review'"),
      waiting_on: str("What the waiting time is made of, or 'Nothing - no review'"),
    },
    "Time and effort"
  ),
  bottom_line: str("One-paragraph recommendation: which app type to create, which path to take, what to start first because it has the longest lead time"),
  app_type: str("Which kind of app/registration to create in the provider's console and why (e.g. GitHub App vs OAuth App)"),
  console_url: str("Where to register the app"),
  scope_paths: arr(scopePath, "Different ways to use the app and how each changes difficulty"),
  prerequisites: arr(
    obj(
      {
        item: str("Requirement, e.g. 'Verified domain' or 'Company LinkedIn Page'"),
        needed_for: enumOf(["development", "production"], "When it becomes required"),
        detail: str("Why and how to satisfy it"),
      },
      "Prerequisite"
    ),
    "Everything to have ready"
  ),
  stages: arr(stage, "Ordered stages from zero to production"),
  token_facts: arr(
    obj(
      {
        fact: str("e.g. 'Access token lifetime'"),
        value: str("e.g. '8 hours; refresh token 6 months'"),
      },
      "Token / runtime behaviour"
    ),
    "Runtime facts that affect an agent holding user connections: token lifetimes, refresh, rate limits, PKCE, redirect rules"
  ),
  gotchas: arr(
    obj(
      {
        title: str("Short title"),
        detail: str("What goes wrong and how to avoid it"),
        severity: enumOf(["high", "medium", "low"], "Impact"),
      },
      "Nuance that could affect setup"
    ),
    "Nuances and traps"
  ),
  blockers: arr(
    obj(
      {
        symptom: str("What the developer sees, e.g. an error string or a rejection email"),
        cause: str("Why it happens"),
        next_step: str("How to proceed"),
      },
      "Blocker playbook entry"
    ),
    "When you hit a blocker"
  ),
  agent_can: strArr("Concrete tasks an agent can do for the developer (research, drafting, config generation, probing, code)"),
  you_must: strArr("Tasks only the human can do (account login, legal/identity, payments, DNS, video recording, reviewer correspondence)"),
  claims: arr(claim, "The 5-12 most decision-relevant claims, each with evidence"),
  open_questions: strArr("What remains uncertain and how to resolve it"),
  confidence: enumOf(["high", "medium", "low"], "Overall confidence in this guide"),
});
