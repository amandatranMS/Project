# Setting up the Multi-Agent Sales Assistant

This walks you through getting the app running on your machine, from
"nothing installed" to "everything working, including the AI assistant."

It's split into five parts. **Part 1 is the only one that's required** — after
that you've got a fully working app. Parts 2–5 add sign-in, the AI chat, real
email/Teams messages, and the security monitoring. Do as many as you need.

Rough time: Part 1 is about 15 minutes. Parts 2 and 3 are the slow ones, mostly
waiting on Azure.

---

## How this differs from the README

The README explains **what the project is** — the problem, the design, the data
model, the security thinking. It's written for someone evaluating the work.

This guide is for someone who just wants to **run it**. Everything here is
specific to getting it working on your own machine:

| | README | This guide |
|---|---|---|
| **Local database option** | Only documents Azure PostgreSQL | Adds a one-line Docker command so you can run free and offline, without an Azure account |
| **Optional vs. required** | Presents setup as one path | Splits it into 5 parts and tells you which ones you can skip (only Part 1 is required) |
| **Node version** | Says "Node 18+" | Says Node 20 or 22, and warns that 19 and 21 will break the build tool |
| **Connection string gotchas** | Mentions URL-encoding | Spells out `@` → `%40`, and that `?sslmode=require` is Azure-only and will fail on local Postgres |
| **The second settings file** | Not covered | Explains that sign-in needs `apps/web/.env` as well as the root `.env`, and why |
| **Entra app registration** | Lists the variables | Walks through the actual portal clicks: SPA redirect URI, exposing a scope, creating the secret |
| **Why the tunnel exists** | States it's needed | Explains the reason — the agent runs in Azure, your data is on your laptop, and Azure can't reach `localhost` |
| **Agent redeploys** | Not covered | Points out that changing the agent's settings needs another `azd deploy`, and that a dropped tunnel makes the assistant lose your data |
| **What the assistant does** | Described as governance design | Warns that "pending approval" is correct behaviour, not a bug |
| **Troubleshooting** | None | A symptom-to-cause table for the failures people actually hit |
| **What can't be shared** | Not covered | States plainly that the AI endpoint, database, and security tooling live in the original tenant and can't be handed over |

Short version: read the README to understand the project, follow this to install it.

---

## Before you start

You'll need these no matter what:

- **Node.js 20 or 22.** Grab the LTS build from nodejs.org.
  ⚠️ Don't use Node 19 or 21 — the build tool refuses to run on those. Node 24
  is fine too. Check with `node -v`.
- **Git**, to download the code.
- **A PostgreSQL database.** This is the one thing you can't skip. Two options
  below — pick whichever is easier for you.
- About 500 MB of free disk space.

---

## Part 1 — Get it running

### 1.1 Get a database

**Option A — run one locally with Docker (easiest, free):**

```bash
docker run --name sales-db -e POSTGRES_PASSWORD=localdev -p 5432:5432 -d postgres:16
```

That's it. Your connection string will be:

```
postgresql://postgres:localdev@localhost:5432/postgres
```

**Option B — Azure Database for PostgreSQL Flexible Server:**

Create the server and an empty database in the Azure portal, then **add your own
IP to the server's firewall rules** (Networking → Firewall rules → "Add current
client IP"). People forget this constantly and then can't connect.

Your connection string looks like:

```
postgresql://youruser:yourpassword@yourserver.postgres.database.azure.com:5432/yourdb?sslmode=require
```

> **Two things that trip people up:**
> - Azure requires `?sslmode=require` on the end. Local Docker doesn't — leave it off.
> - If your password has special characters, you have to encode them. `@` becomes
>   `%40`, `#` becomes `%23`, `/` becomes `%2F`. Otherwise the connection string
>   gets misread and you'll get a confusing error.

### 1.2 Download the code

```bash
git clone https://github.com/amandatranMS/Project.git
cd Project
```

### 1.3 Make your settings file

```bash
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead.

Open `.env` in any editor and set **one line** — the connection string from step 1.1:

```
DATABASE_URL="postgresql://postgres:localdev@localhost:5432/postgres"
```

Ignore everything else in that file for now. It's all optional and the app runs
fine with it blank.

### 1.4 Install and set up

```bash
npm run setup
```

This installs everything, creates the 11 database tables, and loads the sample
data from the Excel file that ships with the repo. Takes a couple of minutes.

### 1.5 Run it

```bash
npm run dev
```

Open **http://localhost:5173**.

**You should see the dashboard with data already in it.** Everyone gets the same
sample records, so your app looks like mine.

### What works right now

Pretty much everything:

- Browsing and filtering opportunities and milestones
- Creating, editing, and deleting records
- The whole approval flow — submit a request, then approve or reject it
- The audit log showing every action
- Dashboard charts, search, notes, deal team

**What doesn't work yet:** the chat widget. Click it and you'll get an error
saying the assistant isn't configured. That's Part 3.

There's no login screen either — the app checks whether sign-in is configured
and skips straight to the dashboard when it isn't. That's Part 2.

**If Part 1 is all you need, you're done.** 🎉

---

## Part 2 — Add Microsoft sign-in

*Adds a login screen and ties records to whoever's signed in. Needs a Microsoft
work account and permission to register an app.*

### 2.1 Register an app in Entra ID

In the Azure portal, go to **Microsoft Entra ID → App registrations → New
registration**.

- Name it whatever you like
- Under **Redirect URI**, pick **Single-page application (SPA)** and enter
  `http://localhost:5173`
- Register it

Then, still inside that app registration:

- **Expose an API** → accept the suggested Application ID URI
  (`api://<your-client-id>`) → **Add a scope** → name it `access_as_user`
- **Certificates & secrets** → **New client secret** → copy the value right away
  (you can't see it again after you leave the page)
- **API permissions** → make sure Microsoft Graph `User.Read` is there
  (it usually is by default)

Copy down three things: the **tenant ID**, the **client ID**, and the **secret**.

### 2.2 Put them in your settings

In the root `.env`:

```
AAD_TENANT_ID="your-tenant-id"
AAD_CLIENT_ID="your-client-id"
AAD_CLIENT_SECRET="your-secret"
```

Then create a **second** settings file at `apps/web/.env`:

```
VITE_AAD_TENANT_ID="your-tenant-id"
VITE_AAD_CLIENT_ID="your-client-id"
VITE_API_SCOPE="api://your-client-id/access_as_user"
```

> Yes, two files. The backend and the browser app read their settings from
> different places, and browser settings have to start with `VITE_`.

### 2.3 Restart

Stop `npm run dev` (Ctrl+C) and start it again. You'll get a "Sign in with
Microsoft" screen now.

---

## Part 3 — Turn on the AI assistant

*This is the big one. Heads up: it needs your own Azure subscription and it
costs money to run. There's no way around that — you can't borrow someone
else's, because the permissions are tied to their tenant.*

### 3.1 Install the tools

- **Azure CLI** — then run `az login`
- **Azure Developer CLI** (`azd`)
- **The AI agents extension**, which the deployment config requires:
```bash
  azd extension install azure.ai.agents
```
- **Python 3.10–3.13**, only if you want to change the agent's code

### 3.2 Deploy the agent

```bash
cd apps/foundry-agent
azd up
```

It'll ask which subscription and region to use, then go build things. Give it
10–15 minutes.

When it finishes it prints an **endpoint URL**. Copy it into the root `.env`:

```
FOUNDRY_AGENT_ENDPOINT="https://...the URL it printed..."
```

### 3.3 Open a tunnel (the annoying bit)

Here's the catch: the agent runs **in Azure**, but your app and its data are on
**your laptop**. Azure can't see `localhost`, so the agent can't reach your data.

The fix is a tunnel that gives your local app a temporary public web address:

```bash
devtunnel host -p 4000 --allow-anonymous
```

Leave that running in its own terminal. It prints a URL like
`https://something-4000.usw2.devtunnels.ms`.

**Because your app is now reachable from the internet, put a password on it.**
In the root `.env`, set `API_KEY` to any random string:

```
API_KEY="pick-any-random-string-here"
```

The web app picks this up automatically, so nothing breaks on your end.

### 3.4 Point the agent at your tunnel

In `apps/foundry-agent/.../.env` (copy `.env.example` first), set:

```
API_BASE_URL="https://your-tunnel-url-from-above"
API_KEY="the same random string you just used"
```

Then redeploy so the agent picks it up:

```bash
azd deploy
```

### 3.5 Check your permissions

In the Azure portal, on the AI resource that `azd` created, make sure your
account has the **Azure AI User** (or **Cognitive Services User**) role. Without
it you'll get a "not authorized" error in the chat.

### 3.6 Try it

Restart `npm run dev`, open the app, click the chat widget, and ask it something
like *"what milestones are at risk?"*

The assistant can read your data, suggest new milestones, and submit approval
requests — but **it can't change anything on its own**. Everything it proposes
lands in the Approvals page for a human to approve or reject first. That's the
whole point of the design, so don't be surprised when it says "pending approval"
instead of just doing the thing.

---

## Part 4 — Real emails and Teams messages

*Only do this if you actually want messages delivered to real people.*

Out of the box, `GRAPH_SEND_MODE="simulate"` means sends get recorded and logged
but nothing is delivered. **That's usually what you want for demos** — you get
the full flow without spamming anyone.

To make sends real, in the root `.env`:

```
GRAPH_SEND_MODE="live"
```

Then go back to your app registration → **API permissions** → add these
Microsoft Graph **delegated** permissions, and **have an admin grant consent**:

| Permission | What it's for |
| --- | --- |
| `Mail.Send` | Sending email from Outlook |
| `Chat.ReadWrite` | Teams messages |
| `ChatMessage.Send` | Teams messages |
| `User.Read.All` | The "notify the whole team" broadcast |

A couple of warnings:

- **You need an actual admin to approve these.** If you're not one, you'll need
  to ask. This is the single most common place people get stuck.
- The "notify the team" feature messages **every enabled account in your
  organisation**. Please don't test that on a live company tenant.
- The "lost to competitor" email goes to your manager, looked up from your real
  Entra profile. If nobody's listed as your manager, it just logs a skip and
  moves on — nothing breaks.

---

## Part 5 — The security monitoring

*Optional, and honestly the most involved part. This is what shows AI misuse
attempts in Microsoft's security tools.*

Two separate things:

**Defender for Cloud** watches the AI model for jailbreak attempts and raises
alerts. Turn it on by setting `ENABLE_DEFENDER_FOR_AI=true` before you run
`azd up`, then set `DEFENDER_SCREEN_ENDPOINT` in `.env` so blocked prompts
actually show up as alerts.

**Purview DLP** checks whether sensitive info is going into prompts. This one
needs Purview set up in your organisation with policies configured, plus the
client secret from Part 2 (that's what lets the app call the model *as you*,
which is what makes the policies actually apply).

Full walkthrough with screenshots is in **`docs/security.md`** — follow that
rather than winging it.

> Worth knowing: this part lives in **your** Microsoft tenant, not in the code.
> Cloning the repo doesn't bring it with you. If you skip Part 5, the app still
> has its own approval gate and audit log — you just won't see anything in
> Defender or Purview.

---

## Other bits you might want

**Run the tests** (no database needed):
```bash
npm test
```
These check the important rule — that nothing gets created, changed, or sent
without a human approving it first.

**Reload the sample data** if you've made a mess:
```bash
npm run db:reset
```

**Use the tools from another app.** There's an MCP server that exposes the same
capabilities to other AI tools — set `MSX_TOOLS_VIA_MCP="true"` in the agent's
settings, or run `python msx_mcp_server.py` directly.

**Security testing.** There's an automated red-teaming suite in `redteam/` that
throws attack prompts at the assistant. Needs Python 3.10–3.13 (3.9 won't work).

---

## When something goes wrong

| What you see | What's actually wrong |
| --- | --- |
| Vite crashes on startup | You're on Node 19 or 21. Switch to 20 or 22. |
| Can't connect to the database | On Azure? Add your IP to the firewall. Password has a `@` or `#`? Encode it (`%40`, `%23`). |
| `sslmode` error on local Postgres | Drop `?sslmode=require` — that's Azure-only. |
| App loads but it's completely empty | The data import didn't run. `npm run db:reset`. |
| Chat says "not configured" | `FOUNDRY_AGENT_ENDPOINT` is blank. That's Part 3. |
| Chat says "not authorized" | Missing the Azure AI User role. See step 3.5. |
| Assistant says it can't find your records | Your tunnel dropped or the agent's `API_BASE_URL` is stale. Restart the tunnel, then `azd deploy`. |
| Emails/Teams messages don't actually arrive | Either still on `simulate`, or an admin hasn't consented to the permissions. |

---

## What I can't hand over

Just so expectations are clear:

- **My AI endpoint.** It's locked to my organisation's permissions. You have to
  deploy your own in Part 3.
- **My database.** You'll have your own copy, seeded with the same sample data.
  Your changes are yours; they won't touch mine.
- **My Defender and Purview setup.** Those are configured in my tenant, not in
  the code.

Everything else — the app, the sample data, the approval flow, the audit log,
the agent's logic — is all in the repo and works identically for you.

---

## The short version

| Part | Time | What you need |
| --- | --- | --- |
| 1. Get it running | ~15 min | Node, Git, a database |
| 2. Sign-in | ~20 min | A Microsoft work account |
| 3. AI assistant | ~45 min | An Azure subscription (costs money) |
| 4. Real sends | ~10 min | An admin to approve permissions |
| 5. Security monitoring | ~1 hr | Purview + Defender in your tenant |

Stop wherever it stops being worth it. Part 1 on its own is a complete, working
app — the AI is a bonus, not the foundation.
