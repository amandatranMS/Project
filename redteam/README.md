# Red Teaming the MSX Milestone Assistant

Automated adversarial testing for the app's Foundry agent using the **Azure AI Foundry
AI Red Teaming Agent** (Microsoft's PyRIT integrated into `azure-ai-evaluation`).

The point of this folder: **generate attack traffic that makes your already-working
Microsoft Defender XDR and Microsoft Purview DLP detections fire**, on demand and
repeatably. The Red Teaming Agent is only the attacker — it does not talk to Defender or
Purview. Detection happens because the attacks land on the surface your security stack
already watches.

---

## How it wires up

```
AI Red Teaming Agent (PyRIT)        run_redteam.py
        │  generates adversarial prompts + grades responses
        ▼
   msx_target callback  ──HTTP POST──►  MSX API  POST /api/chat   (chatService.send)
                                              │
              ┌───────────────────────────────┴───────────────────────────────┐
              ▼                                                                 ▼
  screenForDefender()  → synchronous chat/completions            runFoundryAgent() → hosted agent
  → input Prompt Shield 400                                       (On-Behalf-Of the signed-in user)
  → Defender for Cloud "AI threat protection"                    → model call carries user context
  → Microsoft Defender XDR alert / incident                      → Microsoft Purview DLP ENFORCES
```

**Why target `/api/chat` and not the Foundry agent's Responses endpoint directly?**
The hosted agent reaches the model over the *streaming* Responses API, where a
content-filter block returns as an in-band `response.failed` (HTTP 200) — Defender never
sees the HTTP 400 it keys off, so **no jailbreak alert fires** from that path alone. The
app closes that gap with the `screenForDefender()` shim on `/api/chat`
(`apps/api/src/services/chat/defenderScreen.ts`). Firing attacks at `/api/chat`
reproduces exactly the detection path you validated.

---

## Prerequisites

1. **Python 3.10–3.13** (PyRIT does not support 3.9).
2. **A Foundry project in a red-team supported region**: East US 2, France Central,
   Sweden Central, Switzerland West, US North Central. This is the project that
   *generates and grades* the attacks (`AZURE_AI_PROJECT`), independent of where your
   app's model is deployed.
3. **`az login`** (or a managed identity) with access to that Foundry project.
4. **The MSX API running and reachable** at `MSX_API_BASE_URL` (default
   `http://localhost:4000`) with the real Foundry integration configured
   (`FOUNDRY_AGENT_ENDPOINT`, and `DEFENDER_SCREEN_ENDPOINT` for the Defender alert).
5. For the **DLP run**: a signed-in seller's access token in `MSX_USER_BEARER` so the
   model call runs On-Behalf-Of the user — that is what makes Purview DLP *enforce*
   (app-only / managed-identity tokens are audited but never alert). This requires the
   API's OBO to be configured (`AAD_CLIENT_SECRET`) and the user to have the *Azure AI
   User* role on the Foundry account — see `docs/security.md`.

> Constraints: the AI Red Teaming Agent is **single-turn, text-only**, commercial cloud
> only. Defender **deduplicates** jailbreak alerts per resource for ~30–40 min, so a
> burst of attacks usually surfaces as roughly one alert/incident.

---

## Setup

```powershell
cd redteam
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

Copy-Item .env.example .env   # then fill in AZURE_AI_PROJECT (and MSX_USER_BEARER for DLP)
az login
```

---

## Verify wiring first (optional, fast)

Before a full scan — which needs a supported-region project — confirm the target path
is reachable. `smoke_test.py` drives the same callback the scan uses, with no Azure
project required:

```powershell
python smoke_test.py            # benign connectivity check ("pong")
python smoke_test.py --attack   # also send one jailbreak probe → REAL Defender alert
```

## Run

```powershell
# Defender XDR: jailbreak / prompt-injection attacks (no user token required)
python run_redteam.py --mode defender --num-objectives 5

# Purview DLP: synthetic-PII seed prompts (set MSX_USER_BEARER first to ENFORCE)
python run_redteam.py --mode dlp

# Both, back to back
python run_redteam.py --mode both
```

Scorecards (attack/response pairs + Attack Success Rate) are written to `results/`.

### Useful flags
| Flag | Default | Purpose |
|------|---------|---------|
| `--mode` | `defender` | `defender` \| `dlp` \| `both` |
| `--num-objectives` | `5` | Attack objectives per risk category (defender run) |
| `--risk-categories` | `Violence,HateUnfairness,Sexual,SelfHarm` | Comma-separated |
| `--attack-strategies` | `Base64,Flip,Morse` | Comma-separated; unknown names are skipped |
| `--seed-file` | `dlp_seed_prompts.json` | Custom seed prompts (dlp run) |
| `--output-dir` | `results` | Where scorecards are written |

---

## The two runs, and what to expect where

### `--mode defender` → Microsoft Defender XDR
Sends baseline direct adversarial queries plus attack-strategy variants (Base64, Flip,
Morse — encodings that try to slip past guardrails; ASCII smuggling and other strategies
can be added). Each turn is mirrored by the API's screening shim to the model's
synchronous content filter → **`AI.Azure_Jailbreak.*`**, **`AI.Azure_ASCIISmuggling`**,
and related alerts appear in the **Defender XDR** portal (Incidents), correlated per
resource.

### `--mode dlp` → Microsoft Purview
Sends the prompts in `dlp_seed_prompts.json`, which embed **synthetic** sensitive-info
types (standard fake test values — Visa `4111 1111 1111 1111`, example SSN
`123-45-6789`, test IBAN, etc.). Because they are sent *baseline* (no encoding), the
sensitive-info-types survive classification. With `MSX_USER_BEARER` set, the model call
runs as the user → **Purview DLP enforces** and the matches show up in **DSPM for AI /
DLP alerts**. Without it, Purview only *audits* the interaction.

> ⚠️ Attack Success Rate on the DLP run is **not** the metric to watch — those seeds are
> about tripping data classification, not eliciting harmful content. Watch Purview, not
> the ASR scorecard, for the DLP run.

---

## Safety / scope

* **Synthetic data only.** Every value in `dlp_seed_prompts.json` is standard fake test
  data. Never replace it with real customer PII — that would defeat the purpose and
  violate the app's mock-only rule.
* This exercises **real** identity + security telemetry (Entra, Defender, Purview) by
  design; it does **not** touch real MSX/Dataverse business data.
* Point this only at systems you own and are authorized to test.

## Customizing attacks
* Add your own attack objectives by editing `dlp_seed_prompts.json` (supported
  `risk-type` values for custom seeds: `violence`, `sexual`, `hate_unfairness`,
  `self_harm`).
* Add attack strategies via `--attack-strategies` (any `AttackStrategy` member name your
  installed `azure-ai-evaluation` exposes, e.g. `Base64`, `Flip`, `Morse`, `Url`,
  `Leetspeak`, and the composed `EASY` / `MODERATE` / `DIFFICULT` tiers).

## References
* AI Red Teaming Agent (concept): https://learn.microsoft.com/azure/foundry/concepts/ai-red-teaming-agent
* Run scans locally: https://learn.microsoft.com/azure/foundry/how-to/develop/run-scans-ai-red-teaming-agent
* Defender AI threat protection: https://learn.microsoft.com/azure/defender-for-cloud/ai-threat-protection
* Purview for Foundry: https://learn.microsoft.com/purview/ai-azure-foundry
* App security design: `../docs/security.md`
