# Migration plan — extract Caleb Jr into its own repo

**Goal:** put the automation orchestrator (Caleb Jr) and the auto-editable
product (the Enactus portal) in **separate repos + deployments**, so a
Cursor-built change to the portal can never break Caleb Jr — and so the portal's
repo never sits next to Caleb Jr's powerful secrets.

**Principle:** the thing that performs automated changes must live *outside* the
blast radius of what it changes.

**Chosen direction:** the **portal stays** in `enactus-agent` (keeps its URL and
becomes the auto-edit target); **Caleb Jr extracts** to a new `caleb-jr` repo +
deploy.

---

## Target architecture

| | `enactus-agent` (Portal) — **stays put** | `caleb-jr` (new repo) |
|---|---|---|
| Role | public portal + the `SLACK_BOT_TOKEN` bot | headless automation agent (API only) |
| Deploy | keeps `enactus-agent.vercel.app` | new `caleb-jr.vercel.app` |
| Cursor registry | **listed** (the auto-update target) | **excluded** (Cursor has no access; never self-edits) |
| Powerful secrets | none | yes (Cursor key, user token, signing secrets) |
| Cron | `…/hours/remind` (daily, self-gated to Fri) | `/api/agent/diagnose` (daily) |

**Bonuses of this direction:** Cursor already has GitHub access to `enactus-agent`
(no new grant needed); the public portal URL is **unchanged**; and PR #4's
hours/reminders feature is *already* in this repo — it just needs its fixes, no move.

**Cost of this direction:** Caleb Jr's external wiring repoints to the new URL —
Slack interactivity, `/rescan`, `/regurgitate`, and the GitHub merge webhook(s).
The Cursor webhook is built from `NEXT_PUBLIC_APP_URL`, so it auto-updates.

---

## File inventory

### Moves to `caleb-jr` (the orchestrator)
```
app/api/agent/control/route.js
app/api/agent/cursor-webhook/route.js
app/api/agent/diagnose/route.js          (cron → moves with it)
app/api/agent/github-webhook/route.js
app/api/slack/interactivity/route.js
app/api/slack/regurgitate/route.js
app/api/slack/rescan/route.js
lib/calebjr/{cards,cursor,diagnose,slack,triage}.js
lib/models/{AgentAction,AgentCursor,AgentLog}.js
Settings keys: agentMode, agentEnabled, agentScanOwner
```

### Stays in `enactus-agent` (the portal — already here)
```
app/page.js  app/layout.js  app/globals.css  app/favicon.ico
app/finance/page.js          app/api/finance/submit/route.js
app/profiles/page.js         app/api/profiles/{ingest,route,upload,url}/route.js
app/submit/page.js           app/api/submit/route.js
app/settings/page.js         app/api/settings/route.js
app/hours/* + …/hours/remind (PR #4 — fix token+cron, then merge HERE)
                             app/api/slack/{channels,members,ping,help,glaze}/route.js
lib/{sheets,calendar,drive,destinations,parseLinkedIn,similarity,upload,slack}.js
lib/models/{Finance,Profile,Submission}.js
Settings key: financeChannel
```

### Duplicated in both (shared infra, copy verbatim)
```
lib/mongodb.js
lib/models/Settings.js   lib/settings.js
```
Both connect to the **same MongoDB cluster** — collections don't overlap
(`agentactions/agentcursors/agentlogs` vs `finances/profiles/submissions`), and
the shared `settings` collection uses disjoint keys. **No data migration.**

---

## Dependency split (`package.json`)

| Package | caleb-jr | enactus-agent (portal) |
|---|:--:|:--:|
| next, react, react-dom, mongoose | ✅ | ✅ |
| @anthropic-ai/sdk | ✅ (triage) | ✅ (glaze) |
| googleapis | ❌ | ✅ |
| @vercel/blob, jszip, papaparse | ❌ | ✅ |
| @vercel/analytics | optional | ✅ |
| tailwindcss, eslint* (dev) | ✅ | ✅ |

`caleb-jr` sheds googleapis, blob, jszip, papaparse — much smaller.

---

## Environment variables

### `caleb-jr` (new project) gets
```
ANTHROPIC_API_KEY
CALEB_JR_BOT_TOKEN, CALEB_JR_USER_TOKEN, CALEB_JR_SIGNING_SECRET
CURSOR_API_KEY, CURSOR_MODEL
GITHUB_WEBHOOK_SECRET
MONGODB_URI            (same value — shared cluster)
NEXT_PUBLIC_APP_URL    (new — the caleb-jr.vercel.app URL; also drives the Cursor webhook)
CRON_SECRET            (its own)
```

### `enactus-agent` (portal) keeps; we **remove** the agent ones
```
KEEP:   SLACK_BOT_TOKEN, GOOGLE_* (all), GOOGLE_HOURS_SPREADSHEET_ID (new, for reminders),
        ANTHROPIC_API_KEY, MONGODB_URI, NEXT_PUBLIC_APP_URL (unchanged), CRON_SECRET
REMOVE: CALEB_JR_BOT_TOKEN, CALEB_JR_USER_TOKEN, CALEB_JR_SIGNING_SECRET,
        CURSOR_API_KEY, CURSOR_MODEL, CURSOR_REPO, CURSOR_BASE_REF, GITHUB_WEBHOOK_SECRET
```

---

## External reconfiguration

| What | Where | Who |
|---|---|---|
| Create `caleb05w/caleb-jr` repo | GitHub | **me** (`gh repo create`) |
| New Vercel project + env vars | Vercel | **me** if `vercel` CLI is authed, else exact list for you |
| Caleb Jr Slack app (`A0BBT99TL2Z`): interactivity URL + `/rescan` + `/regurgitate` → new URL | Slack | **you** (or me w/ a config token) |
| GitHub merge webhook(s) (SKYES, + marketing later) → new URL | GitHub | **me** for SKYES (`gh`) |
| Cursor webhook | from `NEXT_PUBLIC_APP_URL` | **auto** ✅ |
| Portal bot slash commands, public URL, Cursor GitHub access | — | **unchanged** ✅ |

---

## Execution order (zero-downtime)

1. **Stand up `caleb-jr`** — create repo; copy the agent files + shared infra; prune `package.json`; carry over the agent cron in its own `vercel.json`.
2. **New Vercel project** — set env vars, deploy, capture the URL, set `NEXT_PUBLIC_APP_URL` to it.
3. **Repoint Caleb Jr wiring** — Slack interactivity + `/rescan` + `/regurgitate` URLs; GitHub SKYES webhook URL. (Cursor webhook auto-updates.)
4. **Verify Caleb Jr** on the new deploy — request → 👀 → card in your DM → approve → Cursor PR → merge → requester notified.
5. **Un-block the portal** — remove the temporary `enactus-agent` denylist so the portal becomes the live edit target again (Cursor access already exists).
6. **Gut `enactus-agent`** — delete `lib/calebjr/*`, the agent routes, the agent models; remove the `CALEB_JR_*` / `CURSOR_*` / `GITHUB_WEBHOOK_SECRET` env; swap `vercel.json`'s agent cron for the `hours/remind` cron.
7. **Land reminders** — fix PR #4 here (token → `SLACK_BOT_TOKEN`, wire the cron) and merge.

---

## Verification checklist
- [ ] Caleb Jr full loop works on `caleb-jr.vercel.app` (cards → approve → PR → merge-notify)
- [ ] Slack interactivity + both slash commands hit the new URL; merge webhook fires
- [ ] Cursor routes "enactus-web bot" requests to **enactus-agent** (portal), never `caleb-jr`
- [ ] Portal: every page + API route still works (URL unchanged)
- [ ] Reminders fire to **#marketing-execs only**, via `SLACK_BOT_TOKEN`, on Fridays
- [ ] `enactus-agent` env no longer holds any `CALEB_JR_*` / `CURSOR_*` / signing secrets
- [ ] `caleb-jr` env has no `GOOGLE_*` / `SLACK_BOT_TOKEN`

## Rollback
Both deploys are independent. Keep the agent code live in `enactus-agent` until
`caleb-jr` is verified (step 4); don't gut `enactus-agent` (step 6) before then.
