// Markdown export so a guide can be pasted into a ticket, PR, Notion or Slack.
import { TIER_LABELS, EVIDENCE_LABELS } from "../agent/schema.js";

const OWNER = { you: "You", agent: "Agent", provider: "Waiting on provider" };

export function guideToMarkdown(g, url) {
  const out = [];
  const line = (s = "") => out.push(s);

  line(`# ${g.name} - OAuth app setup guide`);
  line();
  line(`> ${g.summary}`);
  line();
  line(`| | |`);
  line(`|---|---|`);
  line(`| Access | **${TIER_LABELS[g.access_tier] ?? g.access_tier}** (difficulty ${g.difficulty}/5) |`);
  line(`| Hands-on effort | ${g.effort.hands_on} |`);
  line(`| First connection | ${g.effort.first_connection} |`);
  line(`| Production-ready | ${g.effort.production} |`);
  line(`| Waiting on | ${g.effort.waiting_on} |`);
  if (g.managed_auth?.status === "managed") line(`| Managed OAuth app | Available on Composio (${g.managed_auth.toolkit}) - you can launch on it while your own app is in review |`);
  line(`| Confidence | ${g.confidence} |`);
  line(`| ${g.source === "agent" ? "Generated" : "Reviewed"} | ${g.generated_at?.slice(0, 10) ?? g.reviewed_on} (${g.source === "agent" ? "agent-generated" : "curated"}) |`);
  line();
  line(`## Bottom line`);
  line(g.bottom_line);
  line();
  line(`**App type:** ${g.app_type}  `);
  line(`**Register at:** ${g.console_url}`);
  line();
  line(`## Difficulty depends on what you need`);
  line(`| Path | Scopes | Access | Review | Time to production |`);
  line(`|---|---|---|---|---|`);
  for (const p of g.scope_paths) line(`| ${p.name} | ${p.scopes.map((s) => "`" + s + "`").join(", ")} | ${TIER_LABELS[p.tier] ?? p.tier} | ${p.review} | ${p.time_to_production} |`);
  line();
  line(`## Prerequisites`);
  for (const p of g.prerequisites) line(`- [ ] **${p.item}** _(for ${p.needed_for})_ - ${p.detail}`);
  line();
  line(`## Steps`);
  g.stages.forEach((s, i) => {
    line(`### ${i + 1}. ${s.name}`);
    line(`_Done when:_ ${s.goal}`);
    line();
    for (const st of s.steps) {
      line(`- [ ] **${st.title}** - ${OWNER[st.owner] ?? st.owner}, ${st.duration}  `);
      line(`  ${st.detail}${st.url ? ` ([link](${st.url}))` : ""}`);
    }
    line();
  });
  line(`## Token & runtime facts`);
  for (const t of g.token_facts) line(`- **${t.fact}:** ${t.value}`);
  line();
  line(`## Gotchas`);
  for (const x of g.gotchas) line(`- **${x.title}** (${x.severity}) - ${x.detail}`);
  line();
  line(`## If you get blocked`);
  line(`| You see | Why | Do this |`);
  line(`|---|---|---|`);
  for (const b of g.blockers) line(`| ${b.symptom} | ${b.cause} | ${b.next_step} |`);
  line();
  line(`## Who does what`);
  line(`**An agent can:**`);
  for (const a of g.agent_can) line(`- ${a}`);
  line();
  line(`**You must:**`);
  for (const a of g.you_must) line(`- ${a}`);
  line();
  line(`## Evidence`);
  line(`| Claim | Evidence | Source | Note |`);
  line(`|---|---|---|---|`);
  for (const c of g.claims) line(`| ${c.claim} | ${EVIDENCE_LABELS[c.evidence] ?? c.evidence} | ${c.source_url || "-"} | ${c.note} |`);
  line();
  if (g.open_questions.length) {
    line(`## Still uncertain`);
    for (const q of g.open_questions) line(`- ${q}`);
    line();
  }
  if (url) line(`_Live version: ${url}_`);
  return out.join("\n");
}
