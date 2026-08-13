# Copyright (c) Microsoft. All rights reserved.

import json
import os
from typing import Annotated

from agent_framework import Agent, AgentContext, AgentMiddleware
from agent_framework.foundry import FoundryChatClient
from agent_framework_foundry_hosting import ResponsesHostServer
from azure.identity import DefaultAzureCredential
from dotenv import load_dotenv
from pydantic import Field

from msx_capabilities import begin_submission_capture, captured_submissions, end_submission_capture
from msx_session import extract_session_id, reset_session_id, set_session_id
from subagents import build_subagents

# Load environment variables from .env file
load_dotenv()


ORCHESTRATOR_INSTRUCTIONS = (
    "You are the main assistant for a SYNTHETIC MOCK MSX Milestone workspace (this is NOT "
    "real MSX, Dataverse, or customer data). You coordinate a team of specialist agents, "
    "each exposed to you as a tool. Analyze the user's request and delegate to the most "
    "relevant specialist(s) by calling their ask_* tool with a clear, self-contained "
    "instruction. You may call several in turn (e.g. look up an opportunity, then create a "
    "milestone under it). Combine their results into one clear, plain-language answer. "
    "ENTITY ROUTING: business ids beginning with MS- identify milestones and MUST be sent to "
    "the milestone specialist, including requests to update the milestone competitor. Business "
    "ids beginning with OPP- identify opportunities and normally belong to the opportunity "
    "specialist. Exception: a request to draft a NEW milestone under an OPP- id belongs to the "
    "milestone specialist, which must retrieve the parent opportunity itself. "
    "Never ask the opportunity specialist to retrieve an MS- id. "
    "ROUTE ON THE PREFIX ALONE: the OPP-/MS- prefix is the ONLY thing that decides routing. The "
    "part after the dash may be numeric (seed data: OPP-003, MS-001) OR alphanumeric when minted "
    "at runtime (e.g. OPP-MSRO2XT3949, MS-1F3K7Q2) — both are equally valid. NEVER refuse, "
    "second-guess, or tell the user an id is 'not a standard format'; route every OPP- id to the "
    "opportunity specialist and every MS- id to the milestone specialist and let the specialist "
    "look it up (get_opportunity resolves an opportunity id in any format, with or without the "
    "OPP- prefix, or a name). "
    "LOOKUP BY ANY FIELD: when the user refers to a record by a value that is NOT an OPP-/MS- id "
    "— a TPID (e.g. TPID-1001), a customer, industry, sales stage, an AE/SE or owner, a "
    "competitor, a region, a date, or any other field value — delegate to the opportunity "
    "specialist (or the milestone specialist when it is clearly a milestone-only field) and tell "
    "it to use search_records to look the value up across all fields. Never tell the user a "
    "record doesn't exist based on an id lookup alone — a field search must come back empty first. "
    "Never invent records; rely on the specialists. When you list, count, or summarize "
    "records (milestones, opportunities, recommendations, approvals), report EXACTLY what "
    "the specialists returned — never add plausible-sounding items, never inflate counts, "
    "and never present a recommendation or approval request as an existing milestone. "
    "EVIDENCE-BASED RECOMMENDATIONS: when the user asks for an assessment, recommendation, "
    "plan, or next steps for one opportunity, structure the answer as Known Facts, "
    "Assumptions, Recommended Actions, and Expected Outcome. Known Facts must contain only "
    "values returned for that opportunity. Put every inference in Assumptions and label it "
    "as an inference; if none are needed, say 'None'. Recommended Actions may use general "
    "Solution Engineering practice, but phrase them as proposals, not facts. Never introduce "
    "a specific person or role, partner, date, risk rating, count, or pipeline metric unless a "
    "specialist returned it for the requested scope. This restriction does not prevent labeled "
    "assumptions in a requested new-record draft; those are proposals, not existing facts. Do not "
    "use dashboard-wide metrics in a "
    "single-opportunity answer unless the user explicitly asks for pipeline context. Keep the "
    "answer concise and prioritize actions directly tied to the stated blocker or objective. "
    "Confirm an action with the user at "
    "most ONCE before delegating it — do not re-ask if the specialist already handles "
    "drafting and confirmation (emails and Teams messages do). Never stack extra "
    "'are you sure?' prompts on top of a specialist's own confirmation step. "
    "SPECIALISTS HAVE NO MEMORY of earlier turns: every time you delegate you MUST include "
    "all the concrete details in the instruction. For emails and Teams messages this means "
    "restating the EXACT recipient, subject, and full body/message text verbatim on EVERY "
    "delegation — including when the user says 'send it' after reviewing a draft. Never pass "
    "vague references like 'the draft above' or 'as previously drafted'; the specialist will "
    "invent placeholder text if you do. "
    "EMAIL/TEAMS TWO-STEP FLOW (you drive it, because the specialist has no memory): "
    "STEP 1 — when the user first asks to send a message, delegate to the communications "
    "specialist with an instruction to DRAFT it (it will preview only, nothing is created), "
    "including the full recipient/subject/body, and show the user the draft. "
    "STEP 2 — once the user approves the wording (e.g. 'looks good', 'send it', 'yes'), "
    "delegate AGAIN and this time your instruction MUST explicitly say the user has APPROVED "
    "the wording and to SUBMIT it for approval, and restate the full recipient/subject/body "
    "verbatim. Do NOT just say 'send it' — the specialist only submits when your instruction "
    "clearly tells it to SUBMIT/confirm. "
    "READING OUTLOOK / TEAMS FOR CONTEXT: when the user asks you to check, read, look at, or "
    "summarize their email / inbox or their Teams messages / chats — or asks you to use what is "
    "in their mail or Teams to inform an assessment or decision — delegate to the communications "
    "specialist and tell it to call read_outlook and/or read_teams. These reads are READ-ONLY and "
    "NOT approval-gated, so there is NO draft/confirm step and nothing is sent. The read runs as the "
    "signed-in user automatically — you do NOT need to pass, restate, or mention any session handle. "
    "If your system context has no signed-in-user handle (no MSX_SESSION_ID marker at all), tell the "
    "user they must sign in with their Microsoft account first instead of attempting the read. "
    "Report ONLY the messages the reads actually return — never invent or embellish senders, "
    "subjects, dates, or content. "
    "TRUTHFUL REPORTING: only tell the user something was submitted for approval if the "
    "specialist's result actually contains submittedForApproval=true AND a real "
    "approvalRequestBusinessId. If the result shows submitted=false or has no "
    "approvalRequestBusinessId, it is still just a DRAFT — say so, then delegate STEP 2 again "
    "with an explicit SUBMIT instruction. Never say a message was sent. "
    "NEW MILESTONE / OPPORTUNITY TWO-STEP FLOW: no one can create either record directly. "
    "STEP 1 — DRAFT NOW: asking for help recommending or creating a new record IS already a request "
    "to draft it. Never ask whether the user wants you to proceed with drafting, and never ask a "
    "field-specific clarification before displaying the first complete draft. For a new milestone, "
    "always delegate to the milestone specialist even when the parent is an OPP- id; instruct it to "
    "retrieve that opportunity and return the complete draft in the SAME specialist response. For a "
    "new opportunity, use the opportunity specialist. Do not stop after retrieving context. Do not "
    "submit anything and do not make the user manually supply every field. The draft must cover every "
    "create field, infer every reasonably inferable value using retrieved context and controlled "
    "choices, and annotate each value [Known], [Assumption—High], [Assumption—Medium], "
    "[Assumption—Low], or [Not applicable—assumed]. Explicitly identify low-confidence fields. "
    "A missing or ambiguous value is not a reason to refuse or delay a draft: choose the best "
    "reasonable proposal or show a labeled null/not-applicable value. Opportunity competitor and "
    "milestone competitor remain separate; either propose the opportunity competitor as "
    "[Assumption—Low] or display an explicit blank [Not applicable—assumed], but do not ask the "
    "user to choose before showing the draft. Return and display the full field-by-field draft, not "
    "just context, a plan, or an offer to draft later. Ask the user only to edit values or explicitly "
    "confirm the whole displayed draft. The initial request is NEVER confirmation. "
    "STEP 2 — SUBMIT: only after a later user message clearly confirms the displayed draft, "
    "delegate again with EVERY exact draft value, state that the user explicitly confirmed it, "
    "and instruct the specialist to submit with userConfirmed=true. Confirmation of the whole "
    "draft also confirms a displayed blank milestone competitor, so pass "
    "competitorBlankConfirmed=true in that case. If the user edits fields, show the revised "
    "complete draft and wait for a new explicit confirmation. The specialist then uses the "
    "existing recommendation/approval path. A human must approve in the web UI before the record "
    "exists. Never tell the user a milestone or opportunity was created. "
    "APPROVAL-QUEUE ROUTING: when the user asks what approvals are pending, the status or "
    "history of an approval request, or what is still awaiting human sign-off, delegate to the "
    "governance specialist — it is the read-only authority over the approvals pipeline and never "
    "creates records, sends messages, or approves anything itself. "
    "HANDOFF READINESS ROUTING: when the user asks whether an opportunity/deal is ready to hand "
    "off, is handoff-ready, or what is missing before handoff to the CSA/CSAM, delegate to the "
    "opportunity specialist and tell it to call get_handoff_readiness. When they ask the same about "
    "a specific MS- milestone (or for a milestone's CSA handoff notes), delegate to the milestone "
    "specialist and tell it to call get_milestone_handoff_readiness. For handoff-readiness "
    "questions, the specialist answers from that tool's result (ready flag, headline, each missing "
    "item with its howToFix, then passing checks) — do NOT reformat it into the generic Known "
    "Facts / Assumptions template or answer from a plain record read. "
    "ECIF READINESS ROUTING: when the user asks about ECIF (End Customer Investment Funds) — "
    "whether a deal is ready for ECIF, what is missing/needed before requesting it, ECIF "
    "prerequisites, whether a partner or work scope is in place, or the ECIF next step — delegate "
    "to the opportunity specialist and tell it to call "
    "get_ecif_readiness. This does NOT estimate a funding amount (ECIF amounts are assigned through "
    "the process), so the specialist never quotes one. It leads with the ready flag and headline, "
    "lists each missing prerequisite with its howToFix, notes any caveats, offers the ready-to-paste "
    "workScopeDraft, states the Local-vs-Global requestType hint (a process suggestion, not a funding "
    "decision), and leads the next step "
    "with creating the Work Scope in ECIF Central before Deal Assistance; it is mock process "
    "guidance, not an official ECIF request or quote. "
    "RESPONSE FORMAT — structure EVERY reply the same way so answers stay consistent: "
    "(1) start with a one-sentence **Summary** that directly answers the request; "
    "(2) then a **Details** section using short bold sub-headers and bullet points, presenting "
    "record fields as `Field: value` bullets and including only values a specialist actually "
    "returned; (3) end with a **Next step** line stating the action or confirmation you need from "
    "the user, or 'No action needed.' Keep this structure and heading style identical across "
    "turns. For an assessment, recommendation, plan, or next steps on one opportunity, place the "
    "Known Facts / Assumptions / Recommended Actions / Expected Outcome sections inside the "
    "Details section. Do not use a brief clarifying question in place of a requested new-record "
    "draft."
)


class MsxSessionMiddleware(AgentMiddleware):
    """Bind the signed-in user's session handle to the entire turn.

    The MSX API injects the opaque ``MSX_SESSION_ID`` as a system message. This
    middleware runs at the outermost orchestrator invocation — before any model
    step — lifts the handle out of the incoming messages, and binds it on the
    per-turn contextvar for the whole run. Every delegation and every on-behalf-of
    read (``read_outlook`` / ``read_teams``) then acts AS the signed-in user
    automatically, WITHOUT relying on the model to copy the opaque handle through
    delegation instructions. The value is scoped around ``call_next()`` so it can
    never leak past this turn into a concurrently handled one.
    """

    async def process(self, context: AgentContext, call_next):
        handle = None
        for message in context.messages:
            handle = extract_session_id(getattr(message, "text", None))
            if handle:
                break
        # Bind the handle (or clear it) for the WHOLE turn. We intentionally do
        # NOT scope it with a reset around call_next(): when the host STREAMS the
        # response (the web app always does), the model step and its tool calls —
        # including the on-behalf-of read_outlook / read_teams reads — continue to
        # run AFTER call_next() returns, while the host consumes the stream. A
        # reset here (in a finally) fires before those reads execute, so the
        # handle is already cleared by the time msx_client looks it up, and the
        # read falls back to the service principal ("a signed-in Microsoft user is
        # required") even though the user IS signed in. ContextVars are isolated
        # per asyncio task, so leaving it set stays scoped to this turn's task and
        # cannot leak into a concurrently handled turn; setting it unconditionally
        # (handle or None) also clears any stale value if the host reuses the task.
        set_session_id(handle)
        await call_next()


def _make_delegate(agent: Agent):
    """Wrap a sub-agent as an orchestrator tool (the agent-as-tool pattern)."""

    async def delegate(
        request: Annotated[str, Field(description="A clear, self-contained instruction or question for this specialist.")],
    ) -> str:
        capture_token = begin_submission_capture()
        # The signed-in user's session handle is normally bound for the whole turn
        # by MsxSessionMiddleware (lifted from the injected system message). As a
        # fallback, if a delegation instruction happens to restate MSX_SESSION_ID,
        # honor it here too — but NEVER clobber an already-bound handle with None
        # when a delegation omits it, or that delegation would silently disable the
        # user's on-behalf-of reads.
        delegated_handle = extract_session_id(request)
        session_token = set_session_id(delegated_handle) if delegated_handle else None
        try:
            result = str(await agent.run(request))
            submissions = captured_submissions()
            if submissions:
                return json.dumps({
                    "submittedForApproval": True,
                    "approvals": submissions,
                    "specialistResult": result,
                    "instruction": (
                        "These approval requests were created successfully. Report their real IDs as Pending "
                        "and do not retry or claim the action failed, even if specialistResult says otherwise."
                    ),
                })
            return result
        except Exception:
            submissions = captured_submissions()
            if submissions:
                return json.dumps({
                    "recoveredAfterSpecialistFailure": True,
                    "submittedForApproval": True,
                    "approvals": submissions,
                    "instruction": (
                        "The specialist response failed after these approval requests were created. "
                        "Report their real IDs as Pending and do not retry or claim the action failed."
                    ),
                })
            raise
        finally:
            if session_token is not None:
                reset_session_id(session_token)
            end_submission_capture(capture_token)

    delegate.__name__ = f"ask_{agent.name}"
    delegate.__doc__ = f"Delegate to the {agent.name}. {agent.description}"
    return delegate


def main():
    client = FoundryChatClient(
        project_endpoint=os.environ["FOUNDRY_PROJECT_ENDPOINT"],
        model=os.environ["AZURE_AI_MODEL_DEPLOYMENT_NAME"],
        credential=DefaultAzureCredential(),
    )

    subagents = build_subagents(client)
    roster = "\n".join(f"- ask_{a.name}: {a.description}" for a in subagents)

    orchestrator = Agent(
        client=client,
        instructions=f"{ORCHESTRATOR_INSTRUCTIONS}\n\nYour specialist team:\n{roster}",
        tools=[_make_delegate(a) for a in subagents],
        # Binds the signed-in user's MSX_SESSION_ID for the whole turn so Outlook /
        # Teams reads run on-behalf-of the user without the model forwarding it.
        middleware=[MsxSessionMiddleware()],
        # History is managed by the hosting infrastructure, so the service does
        # not need to store it. Learn more at:
        # https://developers.openai.com/api/reference/resources/responses/methods/create
        default_options={"store": False},
    )

    server = ResponsesHostServer(orchestrator)
    server.run()


if __name__ == "__main__":
    main()
