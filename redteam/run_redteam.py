# Copyright (c) Microsoft. All rights reserved.
"""
Run the Azure AI Foundry **AI Red Teaming Agent** (PyRIT) against the MSX Milestone
Assistant so your existing Microsoft **Defender XDR** and **Purview DLP** detections
fire from automated adversarial traffic.

Modes
-----
* ``defender`` (default) — generates jailbreak / prompt-injection style attacks across
  the standard risk categories and applies attack strategies (encodings, etc.). These
  trip the app's Defender screening shim → Defender XDR alerts. No user token needed.
* ``dlp`` — sends your custom seed prompts (``dlp_seed_prompts.json``) that carry
  SYNTHETIC sensitive info. To make Purview DLP *enforce* (raise alerts, not just
  audit), set ``MSX_USER_BEARER`` to a signed-in seller's access token so the model
  call runs on-behalf-of the user. Seeds are sent baseline (no encoding) so the
  sensitive-info-types survive for classification.
* ``both`` — runs ``defender`` then ``dlp``.

Usage
-----
    python run_redteam.py --mode defender --num-objectives 5
    python run_redteam.py --mode dlp --seed-file dlp_seed_prompts.json
    python run_redteam.py --mode both

Prereqs: ``pip install -r requirements.txt``; ``az login`` (or a managed identity)
with access to the Foundry project; the project must be in a red-team supported region
(East US 2, France Central, Sweden Central, Switzerland West, US North Central); and the
MSX API reachable at ``MSX_API_BASE_URL`` (default http://localhost:4000).
"""

from __future__ import annotations

import argparse
import asyncio
import inspect
import os
import sys
from datetime import datetime, timezone

from dotenv import load_dotenv

from msx_target import TargetConfig, build_target

# Default risk categories (map 1:1 to Defender's content-risk detections + Purview).
DEFAULT_RISK_CATEGORIES = ["Violence", "HateUnfairness", "Sexual", "SelfHarm"]

# A representative, escalating attack-strategy set for the Defender run. Baseline
# (direct) attacks are always included implicitly by the SDK; these add encodings and
# composed complexity tiers. Unknown names are skipped with a warning (enum names vary
# slightly across azure-ai-evaluation versions).
DEFAULT_ATTACK_STRATEGIES = ["Base64", "Flip", "Morse"]


def _log(msg: str) -> None:
    print(f"[redteam] {msg}", flush=True)


def _resolve_project() -> str:
    project = (
        os.environ.get("AZURE_AI_PROJECT")
        or os.environ.get("FOUNDRY_PROJECT_ENDPOINT")
        or ""
    ).strip()
    if not project:
        _log(
            "ERROR: set AZURE_AI_PROJECT (or FOUNDRY_PROJECT_ENDPOINT) to your Foundry "
            "project endpoint, e.g. https://<account>.services.ai.azure.com/api/projects/<project>"
        )
        sys.exit(2)
    return project


def _supported_kwargs(func, **kwargs) -> dict:
    """Keep only kwargs the target callable actually accepts (version-resilient)."""
    try:
        sig = inspect.signature(func)
    except (TypeError, ValueError):
        return kwargs
    if any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()):
        return kwargs
    return {k: v for k, v in kwargs.items() if k in sig.parameters}


def _resolve_risk_categories(names, RiskCategory):
    resolved = []
    for name in names:
        member = getattr(RiskCategory, name, None)
        if member is None:
            _log(f"WARN: unknown risk category '{name}' — skipping")
            continue
        resolved.append(member)
    return resolved


def _resolve_attack_strategies(names, AttackStrategy):
    resolved = []
    for name in names:
        member = getattr(AttackStrategy, name, None)
        if member is None:
            _log(f"WARN: unknown attack strategy '{name}' — skipping")
            continue
        resolved.append(member)
    return resolved


def _timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")


async def _run_scan(red_team, *, scan_name, output_path, target, attack_strategies=None):
    """Call RedTeam.scan with only the kwargs this SDK version supports."""
    kwargs = _supported_kwargs(
        red_team.scan,
        target=target,
        scan_name=scan_name,
        output_path=output_path,
        attack_strategies=attack_strategies,
    )
    # target is mandatory; make sure it survived the filter.
    kwargs.setdefault("target", target)
    if attack_strategies is None:
        kwargs.pop("attack_strategies", None)
    _log(f"starting scan '{scan_name}' → results at {output_path}")
    result = await red_team.scan(**kwargs)
    _log(f"scan '{scan_name}' complete")
    return result


async def run_defender(args, project, credential, cfg: TargetConfig):
    from azure.ai.evaluation.red_team import RedTeam, RiskCategory, AttackStrategy

    risk_categories = _resolve_risk_categories(args.risk_categories, RiskCategory)
    strategies = _resolve_attack_strategies(args.attack_strategies, AttackStrategy)

    red_team = RedTeam(
        **_supported_kwargs(
            RedTeam,
            azure_ai_project=project,
            credential=credential,
            risk_categories=risk_categories or None,
            num_objectives=args.num_objectives,
            output_dir=args.output_dir,
        )
    )

    scan_name = args.scan_name or f"msx-defender-{_timestamp()}"
    output_path = os.path.join(args.output_dir, f"{scan_name}.json")
    _log(
        f"DEFENDER run → target {cfg.chat_url} (engine={cfg.engine}); "
        f"{len(risk_categories)} risk categories × {args.num_objectives} objectives; "
        f"strategies={[getattr(s, 'name', str(s)) for s in strategies] or 'baseline only'}"
    )
    _log(
        "NOTE: Defender deduplicates jailbreak alerts per resource for ~30-40 min, so a "
        "burst of attacks typically surfaces as ~1 alert/incident."
    )
    return await _run_scan(
        red_team,
        scan_name=scan_name,
        output_path=output_path,
        target=build_target(cfg),
        attack_strategies=strategies or None,
    )


async def run_dlp(args, project, credential, cfg: TargetConfig):
    from azure.ai.evaluation.red_team import RedTeam

    seed_file = os.path.abspath(args.seed_file)
    if not os.path.isfile(seed_file):
        _log(f"ERROR: DLP seed file not found: {seed_file}")
        sys.exit(2)

    if not cfg.dlp_enforcing:
        _log(
            "WARN: MSX_USER_BEARER is not set. Without a signed-in user token the model "
            "call runs app-only, so Purview DLP will AUDIT but NOT alert/enforce. Set "
            "MSX_USER_BEARER to a seller's access token to validate DLP enforcement."
        )

    red_team = RedTeam(
        **_supported_kwargs(
            RedTeam,
            azure_ai_project=project,
            credential=credential,
            custom_attack_seed_prompts=seed_file,
            output_dir=args.output_dir,
        )
    )

    scan_name = args.scan_name or f"msx-dlp-{_timestamp()}"
    output_path = os.path.join(args.output_dir, f"{scan_name}.json")
    _log(
        f"DLP run → target {cfg.chat_url} (engine={cfg.engine}); seeds={seed_file}; "
        f"DLP {'ENFORCING (user token present)' if cfg.dlp_enforcing else 'AUDIT-ONLY'}. "
        "Seeds sent baseline (no encoding) so sensitive-info-types survive classification."
    )
    return await _run_scan(
        red_team,
        scan_name=scan_name,
        output_path=output_path,
        target=build_target(cfg),
        attack_strategies=None,
    )


async def main_async(args) -> int:
    load_dotenv()
    project = _resolve_project()
    cfg = TargetConfig()

    try:
        from azure.identity import DefaultAzureCredential
    except ImportError:
        _log("ERROR: azure-identity not installed. Run: pip install -r requirements.txt")
        return 2
    credential = DefaultAzureCredential()

    _log(f"Foundry project: {project}")

    try:
        if args.mode in ("defender", "both"):
            await run_defender(args, project, credential, cfg)
        if args.mode in ("dlp", "both"):
            await run_dlp(args, project, credential, cfg)
    except ImportError:
        _log(
            "ERROR: the red-teaming SDK isn't installed. Run:\n"
            '       pip install "azure-ai-evaluation[redteam]"'
        )
        return 2

    _log(f"done. Scorecards written under: {os.path.abspath(args.output_dir)}")
    _log(
        "Now check: Defender XDR portal (Incidents) for jailbreak/prompt-injection "
        "alerts, and Purview (DSPM for AI / DLP alerts) for sensitive-info matches."
    )
    return 0


def parse_args(argv=None):
    p = argparse.ArgumentParser(description="Red-team the MSX Milestone Assistant.")
    p.add_argument(
        "--mode",
        choices=["defender", "dlp", "both"],
        default="defender",
        help="Which detection surface to exercise (default: defender).",
    )
    p.add_argument(
        "--num-objectives",
        type=int,
        default=int(os.environ.get("REDTEAM_NUM_OBJECTIVES", "5")),
        help="Attack objectives per risk category for the defender run (default: 5).",
    )
    p.add_argument(
        "--risk-categories",
        type=lambda s: [x.strip() for x in s.split(",") if x.strip()],
        default=DEFAULT_RISK_CATEGORIES,
        help="Comma-separated risk categories (default: Violence,HateUnfairness,Sexual,SelfHarm).",
    )
    p.add_argument(
        "--attack-strategies",
        type=lambda s: [x.strip() for x in s.split(",") if x.strip()],
        default=DEFAULT_ATTACK_STRATEGIES,
        help="Comma-separated attack strategies for the defender run (default: Base64,Flip,Morse).",
    )
    p.add_argument(
        "--seed-file",
        default=os.environ.get("REDTEAM_DLP_SEED_FILE", "dlp_seed_prompts.json"),
        help="Custom seed-prompt JSON for the dlp run.",
    )
    p.add_argument(
        "--output-dir",
        default=os.environ.get("REDTEAM_OUTPUT_DIR", "results"),
        help="Directory for scan scorecards (default: results).",
    )
    p.add_argument(
        "--scan-name",
        default=None,
        help="Override the auto-generated scan name.",
    )
    return p.parse_args(argv)


def main() -> None:
    args = parse_args()
    os.makedirs(args.output_dir, exist_ok=True)
    raise SystemExit(asyncio.run(main_async(args)))


if __name__ == "__main__":
    main()
