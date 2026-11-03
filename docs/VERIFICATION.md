# Verification report

How the guidance in this repo was checked, what changed as a result, and what is still unverified.

Dates: research 2026-11-03, corrections 2026-11-04.

## Method

1. **Draft from knowledge, then check against sources.** Each curated guide began as a draft. The 5-12 claims that most affect a developer's plan were then checked against the provider's own documentation, fetched live.
2. **Probe what can be probed without an account.** The authorise endpoints were called with dummy client IDs, and the OIDC discovery documents were fetched. These results are labelled **Tested**. The live agent does the same thing with its `probe_url` tool.
3. **Label everything.** Every claim in a guide carries one evidence label: `tested`, `official_docs`, `third_party` or `inferred`, plus a note on what exactly was checked. Claims that weren't checked keep the `inferred` label. They are not upgraded to look more certain.

## What the sources changed (corrections)

The first three rows were fixed in written guides after a verification pass. The last two were prior assumptions that research overturned before the guide was written.

| Guide | Before checking | Source says | Fix |
|---|---|---|---|
| Gmail | Suggested `gmail.metadata` as a lighter alternative to reading mail. | `gmail.metadata` and `gmail.compose` are **restricted**, like `readonly` and `modify`. Only `gmail.send` (sensitive) and `gmail.labels` (non-sensitive) avoid CASA. ([scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)) | Rewrote the bottom line and scope paths. Claim upgraded from `inferred` to `official_docs`. |
| GitHub | "Customer orgs can restrict third-party access", applied to apps in general. | OAuth app access restrictions are **on by default for new orgs** and are described for **OAuth Apps**. GitHub Apps go through owner installation instead. ([docs](https://docs.github.com/en/organizations/managing-oauth-access-to-your-organizations-data/about-oauth-app-access-restrictions)) | Retitled the gotcha. This strengthens the "use a GitHub App" recommendation. |
| Slack | "Bot tokens don't expire unless rotation is on" (unverified). | Confirmed, plus: rotation **cannot be turned off** once enabled, access tokens last 12h, and refresh tokens are single-use. ([docs](https://docs.slack.dev/authentication/using-token-rotation)) | Added a "one-way switch" gotcha. Claim upgraded. |
| Slack | Assumed Slack was simply self-serve, with an optional Marketplace listing. | Preliminary review takes up to 10 business days. Functional review takes up to **10 weeks**. Submission needs **10+ active workspaces**. Unlisted apps also face the history rate limit described below. ([review guide](https://docs.slack.dev/slack-marketplace/slack-marketplace-review-guide)) | Rated difficulty 3 ("self-serve with caveats"), not 1-2. The install threshold is a prerequisite. |
| Salesforce | Assumed the standard path was "Create a Connected App". | Since Spring '26, new Connected App creation is **disabled by default**. Use External Client Apps. | The guide is now built around ECAs, with a blocker entry for the missing button. |

The most valuable finding is the Slack one. Since 29 May 2025, unlisted distributed apps get **1 request/min and 15 objects** on `conversations.history` and `conversations.replies`. This barely matters for most integrations, but it is critical for AI agents that read conversation history. It does not show up when you test with a long-standing dev install, because existing installs are exempt.

## Live probes (Tested)

| Probe | Observation | Used in |
|---|---|---|
| `github.com/login/oauth/authorize` with dummy client_id | 302 to `/login`. A bad client_id only surfaces after sign-in. | GitHub |
| `slack.com/oauth/v2/authorize` with dummy client_id | HTTP 200 HTML page. The error is rendered in the page, not as an OAuth redirect. | Slack |
| `api.notion.com/v1/oauth/authorize` with all-zero client_id | 302 to `app.notion.com/install-integration`. | Notion |
| `accounts.google.com/o/oauth2/v2/auth` with dummy client_id | Redirect to the error page. The `authError` decodes to `invalid_client: The OAuth client was not found.` | Gmail |
| `linkedin.com/oauth/v2/authorization` with dummy client_id | "Authorize \| LinkedIn" page with `client_id is invalid`. | LinkedIn |
| Google / Salesforce / LinkedIn OIDC discovery | Google: PKCE S256+plain, device grant. Salesforce: PKCE S256. LinkedIn: only openid/profile/email, and no PKCE advertised. | Gmail, Salesforce, LinkedIn |

## Could not verify

- **End-to-end app registration.** No provider accounts were created. Creating accounts and accepting provider terms is a human step, so no app was actually registered or submitted for review. Steps such as "create the app" are marked **You** for that reason.
- **Salesforce primary source.** Salesforce's release-note page failed to render for the fetcher, and developer.salesforce.com returned 403. The Spring '26 Connected App change is sourced from a vendor's documentation that quotes Salesforce, plus search summaries of Salesforce's developer docs. It is labelled `third_party` and the guide's confidence is set to **medium**.
- **Real review durations.** Slack and Google publish maximums or "can take several months", not distributions. The guides present these as stated ranges, not observed ones.
- **CASA cost.** It is not published and varies by assessor. It is listed as an open question.
- **LinkedIn Page verification.** The details (super admin, 30-day window) come from LinkedIn Help, as surfaced by search. The page was not fetched directly.
- **Live agent against the real API.** The agent loop is covered by an offline test (`npm test`) that uses a scripted Claude client and a real network probe. This build environment had no Anthropic API key, so a live end-to-end generation was not run here. Run `npm run generate -- "Zoom"` with a key to confirm.
