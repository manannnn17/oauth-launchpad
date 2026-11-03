// Single-page UI: library, live generation, guide view. No framework, no build.
const app = document.getElementById("app");

const TIERS = {
  self_serve: { label: "Self-serve", blurb: "Register and ship. No provider review for typical agent scopes." },
  self_serve_with_caveats: { label: "Self-serve + caveats", blurb: "No review to start, but production limits, install thresholds or customer-admin approvals apply." },
  review_required: { label: "Review required", blurb: "Formal verification or security review before the public can connect. Plan in weeks." },
  partner_gated: { label: "Partner-gated", blurb: "Key permissions need partner approval that isn't guaranteed. Build on what's open." },
};
const EVIDENCE = {
  tested: { label: "Tested", blurb: "The agent probed the live endpoint (no account) and observed it." },
  official_docs: { label: "Official docs", blurb: "Stated in the provider's own documentation, checked on the date shown." },
  third_party: { label: "Third-party", blurb: "From a non-provider source. Treat as likely, confirm before relying on it." },
  inferred: { label: "Inferred", blurb: "Reasoned or prior knowledge, not checked against a source in this pass." },
};
const OWNERS = { you: "You", agent: "Agent", provider: "Provider" };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const linkify = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");
const safeUrl = (u) => (/^https?:\/\//.test(u || "") ? esc(u) : "");
const meter = (d) => `<span class="meter d${d}" title="Difficulty ${d}/5" aria-label="Difficulty ${d} of 5"><i></i><i></i><i></i><i></i><i></i></span>`;
const tierPill = (t) => `<span class="pill tier-${esc(t)}">${esc(TIERS[t]?.label ?? t)}</span>`;
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 1800);
}

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
}

// ---------- Routing ----------
function navigate(path) {
  history.pushState({}, "", path);
  route();
}
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-link]");
  if (!a || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  navigate(a.getAttribute("href"));
});
window.addEventListener("popstate", route);

function route() {
  const p = location.pathname;
  window.scrollTo(0, 0);
  if (p.startsWith("/g/")) return renderGuide(decodeURIComponent(p.slice(3)));
  if (p === "/about") return renderAbout();
  return renderHome();
}

// ---------- Home ----------
let activeFilter = "all";

async function renderHome() {
  document.title = "OAuth Launchpad";
  app.innerHTML = `
    <section class="hero">
      <h1>Know what it takes to get an OAuth app approved - before you start.</h1>
      <p class="lede">Look up an app to see how hard setup is, how long approval takes, what can block you, and which parts an agent can do for you. Not in the library? An agent researches it live.</p>
      <form class="gen-form" id="gen-form">
        <input id="gen-input" name="q" autocomplete="off" placeholder="App name or website - e.g. Zoom, hubspot.com, Xero" aria-label="App name or website" maxlength="120" required />
        <button class="btn" id="gen-btn" type="submit">Get guide</button>
      </form>
      <div class="status-line" id="status-line"><span class="dot off"></span> Checking agent status…</div>
      <div id="run"></div>
    </section>
    <div class="lib-head">
      <div><h2 style="margin:0">Guide library</h2><div class="muted small">Curated guides are hand-checked against sources; agent guides are generated live and labelled.</div></div>
      <div class="chips" id="chips"></div>
    </div>
    <div class="grid" id="grid"><div class="muted">Loading…</div></div>
    <div class="card section">
      <h2>Reading a guide</h2>
      <div class="legend">${Object.entries(TIERS).map(([k, v]) => `<div>${tierPill(k)}<p>${v.blurb}</p></div>`).join("")}</div>
    </div>`;

  document.getElementById("gen-form").addEventListener("submit", (e) => {
    e.preventDefault();
    startGeneration(document.getElementById("gen-input").value.trim());
  });

  getJson("/api/status").then((s) => {
    document.getElementById("status-line").innerHTML = s.live_generation
      ? `<span class="dot"></span> Live agent ready (${esc(s.model)}). Searches docs, reads them, and probes endpoints - about 2-4 minutes.`
      : `<span class="dot off"></span> Live generation is off on this server (no API key). Library lookups still work.`;
  }).catch(() => {});

  const guides = await getJson("/api/guides");
  const chips = document.getElementById("chips");
  const filters = [["all", "All"], ...Object.entries(TIERS).map(([k, v]) => [k, v.label])];
  const draw = () => {
    chips.innerHTML = filters.map(([k, l]) => `<button class="chip" data-f="${k}" aria-pressed="${activeFilter === k}">${esc(l)}</button>`).join("");
    const list = guides.filter((g) => activeFilter === "all" || g.access_tier === activeFilter);
    document.getElementById("grid").innerHTML = list.length ? list.map(card).join("") : `<div class="muted">No guides in this tier yet.</div>`;
  };
  chips.addEventListener("click", (e) => {
    const f = e.target.closest("[data-f]")?.dataset.f;
    if (f) { activeFilter = f; draw(); }
  });
  draw();
}

function card(g) {
  return `<a class="card gcard" href="/g/${esc(g.slug)}" data-link>
    <div class="top"><h3>${esc(g.name)}</h3>${meter(g.difficulty)}</div>
    <div>${tierPill(g.access_tier)}</div>
    <p>${esc(g.summary)}</p>
    <div class="meta">
      <span class="tag" title="Time until any user can connect">Production: ${esc(g.production)}</span>
      ${g.source === "agent" ? `<span class="tag agent">Agent-generated ${esc(g.date)}</span>` : `<span class="tag">Curated ${esc(g.date)}</span>`}
      ${g.managed === "managed" ? `<span class="tag managed" title="A managed OAuth app exists on Composio">Managed app available</span>` : ""}
    </div>
  </a>`;
}

// ---------- Live generation ----------
const ICON = { search: "🔎", fetch: "📄", probe: "🧪", result: "", phase: "▸", writing: "✍️", error: "⚠️" };

async function startGeneration(query, force = false) {
  if (!query) return;
  const btn = document.getElementById("gen-btn");
  const run = document.getElementById("run");
  btn.disabled = true;
  const started = Date.now();
  run.innerHTML = `<div class="card run">
      <div class="run-head"><strong><span class="spinner"></span> Agent working on "${esc(query)}"</strong><span class="muted small" id="elapsed">0s</span></div>
      <ul class="run-log" id="log"></ul>
    </div>`;
  const log = document.getElementById("log");
  const timer = setInterval(() => { const el = document.getElementById("elapsed"); if (el) el.textContent = `${Math.round((Date.now() - started) / 1000)}s`; }, 1000);
  let writingLi = null;

  const add = (icon, html, cls = "") => {
    const li = document.createElement("li");
    li.className = cls;
    li.innerHTML = cls === "res" ? html : `<span class="ico">${icon}</span><span class="detail">${html}</span>`;
    log.append(li);
    log.scrollTop = log.scrollHeight;
    return li;
  };
  const finish = () => { clearInterval(timer); btn.disabled = false; run.querySelector(".spinner")?.remove(); };

  const handle = (ev) => {
    switch (ev.type) {
      case "match":
        finish();
        run.innerHTML = `<div class="card run">There's already a ${ev.source === "curated" ? "curated" : "recent agent"} guide for <strong>${esc(ev.name)}</strong>.
          <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><a class="btn" href="/g/${esc(ev.slug)}" data-link>Open guide</a>
          <button class="btn secondary" id="regen">Research it again live</button></div></div>`;
        document.getElementById("regen").onclick = () => startGeneration(query, true);
        return;
      case "phase": add(ICON.phase, `<span class="phase">${esc(ev.message)}</span>`); break;
      case "search": add(ICON.search, `Searching <em>${esc(ev.query)}</em>`); break;
      case "fetch": add(ICON.fetch, `Reading <a href="${safeUrl(ev.url)}" target="_blank" rel="noopener">${esc(ev.url)}</a>`); break;
      case "probe": add(ICON.probe, `Probing <code>${esc(ev.url)}</code> <span class="muted">- ${esc(ev.purpose)}</span>`); break;
      case "result": add("", `↳ ${esc(ev.message)}`, "res"); break;
      case "writing":
        if (!writingLi) writingLi = add(ICON.writing, "");
        writingLi.querySelector(".detail").textContent = `Writing guide… ${Math.round(ev.chars / 100) / 10}k characters`;
        break;
      case "done":
        finish();
        add("✅", `Guide ready - opening…`);
        setTimeout(() => navigate(`/g/${ev.slug}`), 600);
        break;
      case "error":
        finish();
        run.querySelector(".run-head strong")?.replaceChildren(`Couldn't finish "${query}"`);
        run.querySelector(".run")?.insertAdjacentHTML("beforeend", `<div class="error-box">${esc(ev.message)}</div>`);
        break;
    }
  };

  try {
    const res = await fetch("/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, force }) });
    if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) handle(JSON.parse(line));
      }
    }
  } catch (err) {
    handle({ type: "error", message: `Connection problem: ${err.message}` });
  } finally {
    clearInterval(timer);
    btn.disabled = false;
  }
}

// ---------- Guide view ----------
async function renderGuide(slug) {
  app.innerHTML = `<div class="muted">Loading guide…</div>`;
  let g;
  try {
    g = await getJson(`/api/guides/${encodeURIComponent(slug)}`);
  } catch {
    app.innerHTML = `<div class="card"><h2>Guide not found</h2><p><a href="/" data-link>Back to the library</a> or generate it with the agent.</p></div>`;
    return;
  }
  document.title = `${g.name} OAuth setup - OAuth Launchpad`;
  const progressKey = `progress:${g.slug}`;
  const progress = store.get(progressKey) || {};
  const isAgent = g.source === "agent";
  const date = isAgent ? g.generated_at?.slice(0, 10) : g.reviewed_on;
  const evCounts = g.claims.reduce((m, c) => ((m[c.evidence] = (m[c.evidence] || 0) + 1), m), {});
  const totalSteps = g.stages.reduce((n, s) => n + s.steps.length, 0) + g.prerequisites.length;

  const managed = g.managed_auth?.status === "managed"
    ? `<div class="managed-note"><strong>Can't wait for approval?</strong> A managed OAuth app for <em>${esc(g.managed_auth.toolkit)}</em> is listed in the <a href="${safeUrl(g.managed_auth.source)}" target="_blank" rel="noopener">Composio managed-auth catalog</a> (snapshot ${esc(g.managed_auth.snapshot_date)}). You can let users connect through it today and switch to your own branded app once it's approved.</div>`
    : g.managed_auth?.status === "bring_your_own"
    ? `<div class="managed-note" style="background:var(--t2-bg)">The Composio catalog lists this app as <strong>bring your own OAuth app</strong> (snapshot ${esc(g.managed_auth.snapshot_date)}) - there's no managed app to fall back on, so this guide is on your critical path.</div>`
    : "";

  app.innerHTML = `
    <div class="crumbs"><a href="/" data-link>← Library</a></div>
    <div class="g-head">
      <div>
        <h1>${esc(g.name)}</h1>
        <div class="g-sub">
          ${tierPill(g.access_tier)} ${meter(g.difficulty)} <span class="muted small">Difficulty ${g.difficulty}/5 · ${esc(g.category)}</span>
          ${isAgent ? `<span class="tag agent">Agent-generated ${esc(date)}</span>` : `<span class="tag">Curated · reviewed ${esc(date)}</span>`}
          <span class="tag">Confidence: ${esc(g.confidence)}</span>
        </div>
      </div>
      <div class="actions">
        <button class="btn secondary" id="copy-link">Copy link</button>
        <a class="btn secondary" href="/api/guides/${esc(g.slug)}.md" target="_blank" rel="noopener">Markdown</a>
        <button class="btn secondary" onclick="window.print()">Print / PDF</button>
      </div>
    </div>
    <p class="summary">${linkify(g.summary)}</p>
    <p class="muted small" style="margin-top:6px">${esc(g.difficulty_reason)}</p>

    <div class="stats">
      <div class="stat"><div class="k">Your hands-on time</div><div class="v">${esc(g.effort.hands_on)}</div></div>
      <div class="stat"><div class="k">First test connection</div><div class="v">${esc(g.effort.first_connection)}</div></div>
      <div class="stat"><div class="k">Any user can connect</div><div class="v">${esc(g.effort.production)}</div></div>
      <div class="stat"><div class="k">Your progress</div><div class="v" id="prog-label">0 / ${totalSteps}</div><div class="progress"><div id="prog-bar"></div></div></div>
    </div>
    <div class="waiting"><strong>Waiting on:</strong> ${esc(g.effort.waiting_on)}</div>

    <div class="callout section">
      <strong>Bottom line</strong>
      <p>${linkify(g.bottom_line)}</p>
      <p class="small"><strong>Create:</strong> ${linkify(g.app_type)} ${safeUrl(g.console_url) ? `· <a href="${safeUrl(g.console_url)}" target="_blank" rel="noopener">Open console ↗</a>` : ""}</p>
    </div>
    ${managed}

    <div class="two section">
      <div class="card who"><h3><span class="owner owner-agent">Agent</span> can do for you</h3><ul>${g.agent_can.map((x) => `<li>${linkify(x)}</li>`).join("")}</ul></div>
      <div class="card who"><h3><span class="owner owner-you">You</span> must take over</h3><ul>${g.you_must.map((x) => `<li>${linkify(x)}</li>`).join("")}</ul></div>
    </div>

    <div class="card section">
      <h2>Difficulty depends on what you need</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>If you need…</th><th>Scopes</th><th>Access</th><th>Review</th><th>Time to production</th></tr></thead>
        <tbody>${g.scope_paths.map((p) => `<tr><td><strong>${esc(p.name)}</strong></td><td>${p.scopes.map((s) => `<code>${esc(s)}</code>`).join(" ")}</td><td>${tierPill(p.tier)}</td><td>${esc(p.review)}</td><td>${esc(p.time_to_production)}</td></tr>`).join("")}</tbody>
      </table></div>
    </div>

    <div class="card section">
      <h2>Have these ready</h2>
      <ul class="checklist">${g.prerequisites.map((p, i) => {
        const id = `pre-${i}`;
        return `<li class="${progress[id] ? "done" : ""}"><input type="checkbox" data-id="${id}" ${progress[id] ? "checked" : ""} aria-label="Done: ${esc(p.item)}" />
          <div><span class="t"><strong>${esc(p.item)}</strong></span> <span class="tag">${esc(p.needed_for)}</span><div class="muted small">${linkify(p.detail)}</div></div></li>`;
      }).join("")}</ul>
    </div>

    <div class="card section">
      <h2>Step by step</h2>
      <div class="muted small">Owner shows who does each step: <span class="owner owner-you">You</span> <span class="owner owner-agent">Agent</span> <span class="owner owner-provider">Provider</span> (waiting). Tick steps off - progress is saved in this browser.</div>
      ${g.stages.map((s, si) => `
        <div class="stage">
          <div class="stage-head"><span class="stage-num">${si + 1}</span><h3>${esc(s.name)}</h3></div>
          <div class="muted small" style="margin:2px 0 6px 18px">Done when: ${esc(s.goal)}</div>
          ${s.steps.map((st, i) => {
            const id = `s${si}-${i}`;
            return `<div class="step ${progress[id] ? "done" : ""}"><input type="checkbox" data-id="${id}" ${progress[id] ? "checked" : ""} aria-label="Done: ${esc(st.title)}" />
              <div><div class="step-title"><span>${esc(st.title)}</span><span class="owner owner-${esc(st.owner)}">${esc(OWNERS[st.owner] ?? st.owner)}</span><span class="dur">${esc(st.duration)}</span></div>
              <p>${linkify(st.detail)} ${safeUrl(st.url) ? `<a href="${safeUrl(st.url)}" target="_blank" rel="noopener">Link ↗</a>` : ""}</p></div></div>`;
          }).join("")}
        </div>`).join("")}
    </div>

    <div class="two section">
      <div class="card">
        <h2>Gotchas</h2>
        ${g.gotchas.map((x) => `<div class="gotcha"><span class="sev sev-${esc(x.severity)}">${esc(x.severity)}</span> <strong>${esc(x.title)}</strong><p>${linkify(x.detail)}</p></div>`).join("")}
      </div>
      <div class="card">
        <h2>Tokens & runtime</h2>
        <div class="table-wrap"><table><tbody>${g.token_facts.map((t) => `<tr><td class="muted">${esc(t.fact)}</td><td><strong>${linkify(t.value)}</strong></td></tr>`).join("")}</tbody></table></div>
      </div>
    </div>

    <div class="card section">
      <h2>If you get blocked</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>You see</th><th>Why</th><th>Do this</th></tr></thead>
        <tbody>${g.blockers.map((b) => `<tr><td><strong>${linkify(b.symptom)}</strong></td><td>${linkify(b.cause)}</td><td>${linkify(b.next_step)}</td></tr>`).join("")}</tbody>
      </table></div>
    </div>

    <div class="card section">
      <h2>Evidence</h2>
      <div class="ev-summary">${Object.keys(EVIDENCE).filter((k) => evCounts[k]).map((k) => `<span class="ev ev-${k}" title="${esc(EVIDENCE[k].blurb)}">${evCounts[k]} ${esc(EVIDENCE[k].label)}</span>`).join("")}</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Claim</th><th>Evidence</th><th>What was checked</th></tr></thead>
        <tbody>${g.claims.map((c) => `<tr><td>${linkify(c.claim)} ${safeUrl(c.source_url) ? `<a href="${safeUrl(c.source_url)}" target="_blank" rel="noopener" class="small">source ↗</a>` : ""}</td><td><span class="ev ev-${esc(c.evidence)}" title="${esc(EVIDENCE[c.evidence]?.blurb)}">${esc(EVIDENCE[c.evidence]?.label ?? c.evidence)}</span></td><td class="muted small">${linkify(c.note)}</td></tr>`).join("")}</tbody>
      </table></div>
      ${g.open_questions.length ? `<h3 style="margin-top:16px">Still uncertain</h3><ul>${g.open_questions.map((q) => `<li>${linkify(q)}</li>`).join("")}</ul>` : ""}
    </div>

    ${isAgent ? researchLog(g) : ""}
  `;

  const updateProgress = () => {
    const done = Object.values(progress).filter(Boolean).length;
    document.getElementById("prog-label").textContent = `${done} / ${totalSteps}`;
    document.getElementById("prog-bar").style.width = `${(done / totalSteps) * 100}%`;
  };
  app.querySelectorAll("input[type=checkbox][data-id]").forEach((cb) =>
    cb.addEventListener("change", () => {
      progress[cb.dataset.id] = cb.checked;
      cb.closest("li, .step").classList.toggle("done", cb.checked);
      store.set(progressKey, progress);
      updateProgress();
    })
  );
  updateProgress();
  document.getElementById("copy-link").onclick = async () => {
    try { await navigator.clipboard.writeText(location.href); toast("Link copied"); } catch { toast(location.href); }
  };
}

function researchLog(g) {
  const log = g.research_log || { searches: [], fetches: [], probes: [] };
  return `<div class="card section">
    <h2>How the agent built this guide</h2>
    <p class="muted small">Model ${esc(g.model)} · ${esc(g.duration_s)}s · ${log.searches.length} searches · ${log.fetches.length} pages read · ${log.probes.length} live probes · request "${esc(g.query)}"</p>
    <details class="log"><summary>Searches</summary><ul>${log.searches.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></details>
    <details class="log"><summary>Pages read</summary><ul>${log.fetches.map((u) => `<li><a href="${safeUrl(u)}" target="_blank" rel="noopener">${esc(u)}</a></li>`).join("")}</ul></details>
    <details class="log"><summary>Live probes (setup attempts without an account)</summary><ul>${log.probes.map((p) => `<li><code>${esc(p.url)}</code> - ${esc(p.purpose)}<br/><span class="muted">${p.result ? `HTTP ${esc(p.result.status)}${p.result.title ? ` · "${esc(p.result.title)}"` : ""}${p.result.oauth_signals?.length ? ` · ${esc(p.result.oauth_signals.join("; "))}` : ""}${p.result.looks_like_login_wall ? " · behind login" : ""}` : `failed: ${esc(p.error)}`}</span></li>`).join("")}</ul></details>
    <details class="log"><summary>Raw research notes</summary><pre class="notes">${esc(g.research_notes)}</pre></details>
  </div>`;
}

// ---------- About ----------
function renderAbout() {
  document.title = "How it works - OAuth Launchpad";
  app.innerHTML = `<div class="prose">
    <h1>How it works</h1>
    <div class="card section">
      <h2>The problem</h2>
      <p>When an AI agent acts in a user's Gmail, Slack or Salesforce, the user grants access to an <strong>OAuth app</strong> - a registration the developer creates with the provider (client ID, secret, redirect URLs, scopes, brand). One OAuth app serves all of the developer's users; each user's grant is a separate <em>connection</em>.</p>
      <p>Platforms like Composio offer <em>managed</em> OAuth apps so developers can start fast, but many apps require bringing your own, and teams usually want their own app in production (their brand on the consent screen, their own quotas, enterprise trust). Getting there can take an hour or several months, and the difference is rarely obvious up front.</p>
    </div>
    <div class="card section">
      <h2>What every guide answers</h2>
      <ul>
        <li><strong>How hard is it?</strong> An access tier and a 1-5 difficulty, and - because difficulty depends on what you ask for - a table of scope paths (e.g. Google sign-in is instant; reading Gmail needs a security assessment).</li>
        <li><strong>How long?</strong> Your hands-on time is separated from calendar waiting, and from the time to your first test connection vs. any user connecting.</li>
        <li><strong>What can bite me?</strong> Prerequisites, gotchas, token behaviour and a blocker playbook mapping what you'll see to what to do.</li>
        <li><strong>Who does what?</strong> Every step is owned by <span class="owner owner-you">You</span>, an <span class="owner owner-agent">Agent</span>, or the <span class="owner owner-provider">Provider</span>.</li>
        <li><strong>Can I trust it?</strong> Each key claim carries its evidence and what exactly was checked; open questions are listed rather than guessed.</li>
      </ul>
    </div>
    <div class="card section">
      <h2>Evidence labels</h2>
      <div class="legend">${Object.entries(EVIDENCE).map(([k, v]) => `<div><span class="ev ev-${k}">${v.label}</span><p>${v.blurb}</p></div>`).join("")}</div>
    </div>
    <div class="card section">
      <h2>The live agent</h2>
      <p>Submit any app name or website. The agent (Claude, with web search and web fetch) researches the provider's docs and changelogs, then <em>attempts</em> the account-free parts of setup with a guarded HTTP probe: the OIDC discovery document, the authorize endpoint with a dummy client ID, and the developer console. A second pass converts the findings into the same structured guide format as the curated library, keeping the evidence labels. The full research log and raw notes are attached to every generated guide.</p>
      <p>The agent never signs up, submits forms or uses credentials - those steps are marked as yours.</p>
    </div>
  </div>`;
}

route();
