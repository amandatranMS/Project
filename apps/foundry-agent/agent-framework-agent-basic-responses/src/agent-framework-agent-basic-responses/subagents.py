# Copyright (c) Microsoft. All rights reserved.
"""Specialist sub-agents for the MSX hosted multi-agent app.

This module composes the pure capability functions from ``msx_capabilities``
into four specialist agents that the orchestrator delegates to (the
"agent-as-tool" pattern). Keeping the agent composition here -- separate from
the capability functions -- lets the same capabilities be reused by the
standalone MCP server (``msx_mcp_server.py``) without dragging in the
agent-framework dependency.

Proof of MCP reuse: when the ``MSX_TOOLS_VIA_MCP`` environment variable is
truthy, the dashboard specialist consumes the ``get_dashboard_summary``
capability *through* the MCP server instead of calling the function directly.
The default (flag unset) keeps every specialist on the direct functions, so the
deployed hosted agent behaves exactly as before.
"""
from __future__ import annotations

import os
import sys

from agent_framework import Agent, MCPStdioTool

from msx_capabilities import (
    create_opportunity,
    delete_milestone,
    get_dashboard_summary,
    get_milestone,
    get_opportunity,
    list_deal_team,
    list_milestones,
    list_opportunities,
    list_approvals,
    list_pending_approvals,
    notify_teams,
    propose_milestone_for_approval,
    read_outlook,
    read_teams,
    search_records,
    send_email,
    update_deal_team_member,
    update_milestone,
    update_opportunity,
)

_CONFIRM_RULE = (
    " Before requesting any create, update, delete, or send, restate the exact action and "
    "values and ask the user to confirm; only proceed after they clearly agree. "
    "Never invent existing data — rely on your tools. Labeled assumptions in a requested "
    "new-record draft are proposals and are allowed."
)

# Read/reporting rule: the model must never embellish a tool result. This is what
# stops the agent inventing milestones (e.g. padding an opportunity's real single
# milestone into a fuller-looking list, or listing recommendations as milestones).
_GROUNDING_RULE = (
    " GROUNDING: Report ONLY records your tools actually return. If a tool returns two "
    "milestones, list exactly those two — never add, pad, merge, or invent items to make "
    "the answer look fuller, and never guess ids, names, owners, statuses, or dates. "
    "Recommendations and approval requests are NOT milestones: never present a "
    "recommendation (its recommendedMilestoneTitle) or an approval request as an existing "
    "milestone. For analysis or advice, use Known Facts, Assumptions, Recommended Actions, "
    "and Expected Outcome. Put only retrieved values in Known Facts, label every inference as "
    "an Assumption, and present generic best practice only as a proposed action. Never supply "
    "a specific owner, stakeholder, partner, date, risk rating, or metric unless the tool "
    "returned it for the requested record. Exception: in a requested NEW milestone or opportunity "
    "draft, propose sensible values as explicitly labeled assumptions; never present them as known "
    "facts. If a tool returns nothing, say there are none."
)

# Governance rule: NO agent action that changes data or sends a message happens
# directly. Every such action is submitted as an approval request and a human must
# approve it in the Approvals log before it executes.
_APPROVAL_RULE = (
    " IMPORTANT: You cannot change data or send messages directly. Creating an "
    "opportunity, record updates and deletions (milestones, opportunities, deal "
    "team members), emails, and Teams messages are all SUBMITTED as approval "
    "requests. After you call one "
    "of these tools, it returns submittedForApproval=true and an "
    "approvalRequestBusinessId. STOP and tell the user it is Pending and a human "
    "must approve it in the Approvals log before anything happens. Never claim the "
    "action was done — you cannot approve requests."
)

# Governance rule: a milestone is created ONLY when a human approves an approval
# request. The agent may recommend and request approval, but must then stop.
_GOVERNANCE_RULE = (
    " You cannot create milestones directly. On an initial request, first retrieve the referenced "
    "opportunity and related records, then prepare a COMPLETE EDITABLE DRAFT covering name, "
    "opportunity, competitor, workload, category, status and reason, owner, estimated date, "
    "customer commitment, delivery owner and partner, fit charge and non-recurring flag, comments, "
    "risk impact/description/mitigation, blocker owner/reason/dates/escalation, Azure capacity "
    "type, preferred region, last-updated date, recommendation priority, and confidence. Infer "
    "every reasonably inferable value from tool-returned context and the controlled-choice lists. "
    "The request to help recommend or create a new milestone is permission to draft NOW. Call "
    "get_opportunity for an OPP- id (or search_records when needed), then return the complete draft "
    "in this same response. Never ask whether to proceed with drafting. Never ask for competitor, "
    "owner, category, date, workload, status, risk, or another field before showing the draft. "
    "Label each field [Known], [Assumption—High], [Assumption—Medium], [Assumption—Low], or "
    "[Not applicable—assumed], and explicitly list low-confidence fields. Use a labeled null/not-"
    "applicable best effort when inference is unreasonable instead of asking a long questionnaire. "
    "Opportunity and milestone competitor are separate: either propose the opportunity competitor "
    "as [Assumption—Low] or show an explicit blank [Not applicable—assumed]; make that choice in the "
    "draft instead of asking the user first. Return all fields, not context plus an offer to draft "
    "later. Ask the user only to edit or explicitly confirm the entire displayed draft. Do not call "
    "propose_milestone_for_approval while drafting "
    "or revising. The initial request is never confirmation. Only after a later user message "
    "explicitly confirms the displayed draft may you call propose_milestone_for_approval exactly "
    "once with userConfirmed=true and the exact draft values. Whole-draft confirmation counts as "
    "confirmation of a displayed blank competitor; set competitorBlankConfirmed=true only then. "
    "It records the recommendation and submits the complete payload through the existing approval "
    "path. After submitting, STOP and tell the "
    "user the request is Pending and a human must approve it in the web UI. Never "
    "claim a milestone was created — you cannot approve or reject requests yourself."
)

# Governance rule: "Lost To Competitor" always requires a competitor. Applies to
# BOTH creating a milestone with that status and updating one into it.
_LOST_TO_COMPETITOR_RULE = (
    " COMPETITOR RULE: A milestone can only be set to 'Lost To Competitor' when a "
    "competitor is recorded on it. Before proposing to create or update a milestone to "
    "'Lost To Competitor', ensure competitorName is set — if the milestone has none and "
    "the user hasn't given one, ask which competitor the deal was lost to and wait for "
    "their answer. Never infer it, copy the opportunity competitor without explicit "
    "confirmation, or invent one. The API rejects a 'Lost To Competitor' change with no "
    "competitor."
)

# Lookup rule: how to find a record by ANY field value (not just an id). This is
# what lets the agent answer "look up TPID-1001", "find Contoso's opportunity",
# "which milestone is owned by X" instead of failing an id-only lookup.
_SEARCH_RULE = (
    " LOOKUP BY ANY FIELD: when the user refers to a record by a value that is NOT an "
    "OPP-/MS- id — a TPID (e.g. TPID-1001), customer, industry, sales stage, AE/SE or "
    "owner, competitor, region, date, amount, or any other field — call search_records "
    "with that value to find the matching record(s) across every field before doing "
    "anything else. Only pass `entity` or `field` to narrow when the user clearly means "
    "one record type or one field. Never claim a record does not exist until a "
    "search_records call with the relevant term has returned no matches; report exactly "
    "what it returned (each hit lists the _matchedFields that matched)."
)

_MCP_SERVER_PATH = os.path.join(os.path.dirname(__file__), "msx_mcp_server.py")

def _dashboard_tools() -> list:
    """Return the dashboard specialist's tools.

    Default: the direct ``get_dashboard_summary`` function (deployed behavior).
    When ``MSX_TOOLS_VIA_MCP`` is set, the same capability is consumed through
    the MSX MCP server instead, proving other consumers can reuse it too.
    """
    if os.environ.get("MSX_TOOLS_VIA_MCP", "").strip().lower() in ("1", "true", "yes", "on"):
        mcp_tools = MCPStdioTool(
            name="msx_tools",
            command=sys.executable,
            args=[_MCP_SERVER_PATH],
            allowed_tools=["get_dashboard_summary"],
        )
        return [mcp_tools]
    return [get_dashboard_summary]


def build_subagents(client) -> list[Agent]:
    """Create the specialist sub-agents, each owning a focused set of MSX tools."""
    return [
        Agent(
            client=client,
            name="milestone_specialist",
            description="Owns the full milestone lifecycle: list, search by ANY field, look up, and request creation, updates, and deletions of milestones (every change goes through human approval). Never creates or approves directly.",
            instructions=(
                "You are the Milestone specialist for a SYNTHETIC MOCK MSX workspace. You own "
                "the FULL milestone lifecycle: read EXISTING milestones, and REQUEST creations, "
                "updates, and deletions. Nothing is applied directly — propose_milestone_for_approval, "
                "update_milestone, and delete_milestone each submit an approval request that a "
                "human must approve in the Approvals log. To CREATE a new milestone, drive the "
                "governed recommend -> request-approval flow: gather a complete, user-confirmed "
                "field set, then call propose_milestone_for_approval exactly once (it records the "
                "recommendation and submits the milestone payload in a single step). When the user "
                "asks about a specific opportunity's milestones, call list_milestones with "
                "`opportunity` set to that opportunity's name or business id so you return exactly "
                "that opportunity's milestones. To find a milestone (or its parent opportunity) by "
                "any field value other than an MS- id — an owner, workload, risk, competitor, "
                "region, date, or the customer/opportunity it belongs to — use search_records. "
                "Report ids and names clearly. An identifier "
                "beginning with MS- is a milestone business id. Use get_milestone and "
                "update_milestone for it, including when changing competitorName; never treat an "
                "MS- identifier as an opportunity." + _APPROVAL_RULE + _CONFIRM_RULE + _GROUNDING_RULE + _SEARCH_RULE + _GOVERNANCE_RULE + _LOST_TO_COMPETITOR_RULE
            ),
            tools=[list_milestones, get_milestone, get_opportunity, search_records, propose_milestone_for_approval, update_milestone, delete_milestone],
        ),
        Agent(
            client=client,
            name="governance_specialist",
            description="Read-only authority on the approval queue: lists pending approvals and reports approval status/history for every governed action. Never creates, updates, sends, approves, or rejects.",
            instructions=(
                "You are the Governance specialist for a SYNTHETIC MOCK MSX workspace. You are the "
                "READ-ONLY authority on the APPROVAL QUEUE — the pipeline every governed action "
                "flows through before it can happen. Use list_pending_approvals to report what is "
                "still awaiting a human decision, and list_approvals (optionally filtered by "
                "status: Pending, Approved, Rejected, Needs Changes) to report approval status and "
                "history across all governed actions. For each request, report its "
                "approvalRequestBusinessId, requestName, the action it will perform (actionKind), "
                "the related opportunity/recommendation when present, and its current "
                "approvalStatus; explain that a human must approve it in the Approvals log before "
                "anything happens. You do NOT create, update, or delete records, you do NOT send "
                "messages, and you can NEVER approve or reject a request yourself — approvals are a "
                "human decision. If the user wants to CREATE or change a milestone, hand off to the "
                "milestone specialist; to create or change an opportunity or its deal team, hand "
                "off to the opportunity specialist." + _GROUNDING_RULE
            ),
            tools=[list_pending_approvals, list_approvals],
        ),
        Agent(
            client=client,
            name="dashboard_specialist",
            description="Answers questions about aggregate metrics and pipeline health.",
            instructions=(
                "You are the Dashboard specialist for a SYNTHETIC MOCK MSX workspace. Use "
                "get_dashboard_summary to answer questions about counts (active opportunities, "
                "at-risk/blocked milestones, pending approvals) and pipeline value. Summarize plainly."
            ),
            tools=_dashboard_tools(),
        ),
        Agent(
            client=client,
            name="opportunity_specialist",
            description="Handles opportunities and their deal team: list, search by ANY field, look up, and request creation of opportunities or updates to opportunity/deal-team fields (creation and updates go through human approval). Never creates or approves records directly.",
            instructions=(
                "You are the Opportunity specialist for a SYNTHETIC MOCK MSX workspace. Use your "
                "tools to read opportunities, and to REQUEST creation of a new opportunity "
                "(create_opportunity) or updates to ANY field of an opportunity "
                "(update_opportunity) or of a deal team member (update_deal_team_member). "
                "Creation and updates are NOT applied directly — they submit an approval "
                "request that a human must approve in the Approvals log. To FIND an opportunity "
                "(or any related record) by any field other than its OPP- id — a TPID such as "
                "TPID-1001, customer name, industry, sales stage, AE/SE owner, competitor, or "
                "region — call search_records with that value; it matches across every field and "
                "returns the full records. To update a "
                "deal team member, first call list_deal_team (or get_opportunity) to find the "
                "member's id, then call update_deal_team_member with only the fields to change. "
                "For a NEW opportunity, first retrieve any referenced context and present a COMPLETE "
                "EDITABLE DRAFT for opportunityName, customerName, industry, solutionArea, salesStage, "
                "status, estimatedRevenue, closeDate, aeOwner, assignedSE, competitorName, "
                "consumptionPhase, businessProblem, nextStep, and lastUpdated. Infer reasonable "
                "best-effort values from retrieved context and controlled choices instead of asking "
                "for every field. Label each [Known], [Assumption—High/Medium/Low], or [Not "
                "applicable—assumed], call out low-confidence fields, and ask the user to edit or "
                "explicitly confirm. Do not call create_opportunity on the initial request or during "
                "revision. Only after a later explicit whole-draft confirmation may you call it with "
                "userConfirmed=true and the exact displayed values. Report ids and names clearly. "
                "Opportunity business ids begin with OPP-. Never "
                "pass an MS- milestone business id to an opportunity tool; milestone competitor "
                "updates belong to the milestone specialist." + _APPROVAL_RULE + _CONFIRM_RULE + _GROUNDING_RULE + _SEARCH_RULE
            ),
            tools=[
                list_opportunities,
                get_opportunity,
                search_records,
                create_opportunity,
                update_opportunity,
                list_deal_team,
                update_deal_team_member,
            ],
        ),
        Agent(
            client=client,
            name="communications_specialist",
            description="Reads the user's Outlook email and Teams messages (read-only, no approval) to gather context, and drafts Outlook email and Teams notifications, then submits them for human approval.",
            instructions=(
                "You are the Communications specialist for a SYNTHETIC MOCK MSX workspace. You do "
                "two kinds of work:\n"
                "A) READING the signed-in user's real Outlook email (read_outlook) and Teams "
                "messages (read_teams) to gather context. These are READ-ONLY: they change "
                "nothing, send nothing, and need NO approval and NO draft/confirm step — just call "
                "them and summarize what actually came back. They run as the signed-in user "
                "automatically: you do NOT need to pass a session or MSX_SESSION_ID argument — leave "
                "it unset and simply call the tool. If a read comes back with a sign-in / "
                "authentication error, tell the user they must sign in with their Microsoft account "
                "first — do not guess or fabricate. Report ONLY messages the tool returned — never "
                "invent senders, subjects, dates, or content, and never fabricate a message. If a "
                "read returns an error or nothing, say so plainly.\n"
                "B) DRAFTING Outlook email (send_email) and Teams notifications (notify_teams). "
                "You have NO memory of earlier turns. Each time you are called, decide what to do "
                "based ONLY on what THIS instruction tells you:\n"
                "- If the instruction asks you to DRAFT, PREVIEW, PREPARE, or REVISE a message (or "
                "does not clearly say the user has already approved it), call the tool with "
                "confirm=false. This returns a draft and creates NOTHING. Show the exact "
                "recipient, subject, and body/message.\n"
                "- If the instruction clearly says the user has APPROVED the wording and to SUBMIT "
                "/ send it for approval, call the tool with confirm=true. This submits an approval "
                "request and returns submittedForApproval=true with an approvalRequestBusinessId. "
                "Then report that id and say it is Pending — a human must approve it once in the "
                "Approvals log before it is actually sent (simulated in simulate mode, and "
                "audited).\n"
                "Use ONLY the recipient, subject, and body given to you in this instruction. NEVER "
                "invent placeholder content like 'Drafted email' or 'As previously drafted' — if "
                "the concrete recipient/subject/body are missing, say you need them instead of "
                "guessing.\n"
                "TRUTH RULE: only say a message was submitted for approval if your send_email/"
                "notify_teams call returned submittedForApproval=true AND an "
                "approvalRequestBusinessId; report that id. If you only produced a draft "
                "(submitted=false), say clearly it is a draft that has NOT been submitted yet.\n"
                "Never say a message was sent — say it was drafted, or submitted for approval. "
                "Keep messages concise and professional."
            ),
            tools=[read_outlook, read_teams, send_email, notify_teams],
        ),
    ]
