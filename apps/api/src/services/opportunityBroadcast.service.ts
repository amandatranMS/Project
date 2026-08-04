import type { Opportunity } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { genId } from '../lib/ids.js';
import { connectOpportunity } from '../lib/connect.js';
import { HttpError } from '../lib/httpError.js';
import { recordAgentAction } from '../lib/audit.js';
import type { AuthUser } from '../lib/entraAuth.js';
import type { PendingAction } from '../validators/schemas.js';
import { graphService } from './graph.service.js';

/**
 * "Notify the team when a new opportunity is created" — a visibility broadcast to
 * Microsoft Teams. How the Teams message is gated depends on HOW the opportunity was
 * created (the `mode` passed to `onOpportunityCreated`):
 *
 *  - **Human create ('none'):** the web app shows an inline consent modal right
 *    after the opportunity is saved. On agree it calls `announce()` below, which
 *    posts the Teams DM (confirmed) and is audited by graphService.notifyTeams.
 *
 *  - **Direct agent create ('queue'):** the in-app assistant and REST service creates
 *    persist the opportunity immediately with no prior approval, so the agent must
 *    never send directly. We queue a Pending ApprovalRequest carrying a deferred
 *    `NotifyTeams` action; the message only goes out when a human approves it in the
 *    Approvals tab (approvalRequestsService.decide executes + audits it).
 *
 *  - **Approved create ('send'):** the opportunity was created by a human APPROVING a
 *    CreateOpportunity request. That approval already carries the human's consent (the
 *    Approve dialog warns that Teams messages will be posted), so we send the tenant broadcast
 *    directly (confirmed, audited) as part of that same approval — there is no second
 *    approval entry to act on.
 *
 * Teams delivery uses one 1:1 chat per enabled tenant member because there is no
 * tenant-wide channel-post capability. Nothing is delivered unless
 * GRAPH_SEND_MODE=live (otherwise the send is simulated and audited). No new
 * tables/columns — the deferred action is stored on ApprovalRequest.errorMessage.
 */

/**
 * How the "notify the team" Teams message is handled for a newly created opportunity:
 *  - `none`  — in-app broadcast only (human form create; the web modal drives Teams).
 *  - `queue` — in-app broadcast + queue an approval-gated NotifyTeams request (direct
 *              agent create, which had no prior human approval to piggy-back on).
 *  - `send`  — in-app broadcast + post the Teams DM directly (an already-approved
 *              CreateOpportunity request; the human consented at approval time).
 */
export type BroadcastMode = 'none' | 'queue' | 'send';

/**
 * Mirror of the tag used by approvalRequests.service. Deferred actions are stored
 * on ApprovalRequest.errorMessage as `${ACTION_TAG}${json}`; that service's
 * decodeAction() reads the same prefix and executes the action on approval.
 */
const ACTION_TAG = 'MSX_ACTION::';

/** Master switch for the auto notify-on-create behaviour (default ON). */
function notifyEnabled(): boolean {
  return process.env.NOTIFY_ON_OPPORTUNITY_CREATE !== 'false';
}

function field(label: string, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return `• ${label}: ${value}`;
}

/** Full-field, human-readable Teams message describing a newly created opportunity. */
export function formatOpportunityMessage(o: Opportunity): string {
  const money = (n: number | null) =>
    n == null
      ? null
      : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const day = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : null);

  const lines: (string | null)[] = [
    `📣 New opportunity created: ${o.opportunityName} (${o.opportunityBusinessId})`,
    '',
    field('Account', o.customerName),
    field('TPID', o.tpid),
    field('Industry', o.industry),
    field('Solution area', o.solutionArea),
    field('Sales stage', o.salesStage),
    field('Status', o.status),
    field('Estimated revenue', money(o.estimatedRevenue)),
    field('Estimated close date', day(o.closeDate)),
    field('AE owner', o.aeOwner),
    field('Assigned SE', o.assignedSE),
    field('Competitor', o.competitorName),
    field('Consumption phase', o.consumptionPhase),
    field('Business problem', o.businessProblem),
    field('Next step', o.nextStep),
    '',
    'Shared for team visibility to help Solution Engineers collaborate. (Synthetic mock data.)',
  ];
  return lines.filter((l): l is string => l !== null).join('\n');
}

/**
 * Path A — post the visibility DM for an already-created opportunity. Accepts the
 * internal id or the business id. `confirm` must be true to actually send (the web
 * passes it after the user agrees in the consent modal); without it, notifyTeams
 * returns a preview so nothing goes out.
 */
async function announce(id: string, actor: AuthUser | undefined, confirm: boolean) {
  const opp = await prisma.opportunity.findFirst({
    where: { OR: [{ id }, { opportunityBusinessId: id }] },
  });
  if (!opp) throw new HttpError(404, 'Opportunity not found.');

  return graphService.notifyTenantTeams(actor ?? { kind: 'service' }, {
    message: formatOpportunityMessage(opp),
    confirm,
  });
}

/** Role label shown on the in-app broadcast (mock "all users" feed). */
const NOTIFY_ROLE = 'Solution Engineer';

/**
 * Always-on, in-app half of the broadcast: record a mock AgentNotification on the
 * "all users" feed so every teammate sees the new opportunity regardless of whether
 * a real Teams message is sent. Purely mock (one of the 11 tables), and audited.
 */
async function recordInAppBroadcast(opp: Opportunity, actor?: AuthUser) {
  const notification = await prisma.agentNotification.create({
    data: {
      notificationBusinessId: genId('NT'),
      severity: 'Info',
      notifyRole: NOTIFY_ROLE,
      reasonCode: 'OpportunityCreated',
      status: 'Open',
      createdDate: new Date(),
      message: formatOpportunityMessage(opp),
      opportunity: connectOpportunity(opp.opportunityName),
    },
  });

  await recordAgentAction({
    agentName: 'OpportunityBroadcast',
    actionType: 'Notify',
    actionName: 'BroadcastOpportunityCreated',
    actor: actor?.kind === 'service' ? 'agent' : actor?.email ?? 'system',
    opportunityId: opp.id,
    inputSummary: `New opportunity ${opp.opportunityBusinessId} created`,
    outputSummary: `In-app notification ${notification.notificationBusinessId} posted to ${NOTIFY_ROLE} feed`,
    result: 'Success',
  });

  return notification;
}

/**
 * Path B ('queue') — queue a human-gated approval so the agent's message shows up in
 * the Approvals tab and is only delivered once a human approves it.
 */
async function queueTeamsBroadcastApproval(opp: Opportunity) {
  const action: PendingAction = {
    kind: 'NotifyTeams',
    message: formatOpportunityMessage(opp),
    audience: 'tenant',
  };

  const approval = await prisma.approvalRequest.create({
    data: {
      approvalRequestBusinessId: genId('APR'),
      requestName: `Notify all tenant users of new opportunity ${opp.opportunityBusinessId} via Teams`,
      approvalStatus: 'Pending',
      requestStatus: 'Submitted',
      requestedBy: 'OpportunityBroadcast (agent)',
      errorMessage: ACTION_TAG + JSON.stringify(action),
      opportunity: connectOpportunity(opp.opportunityName),
    },
  });

  // This bypasses approvalRequestsService.create, so log the submission here to
  // match how in-app agent approvals are audited — the agent queuing a send is
  // itself a governed action, even though nothing is delivered until approval.
  await recordAgentAction({
    agentName: 'OpportunityBroadcast',
    actionType: 'NotifyTeams',
    actionName: 'Approval submitted',
    actor: 'agent',
    opportunityId: opp.id,
    inputSummary: `Queue tenant-wide Teams broadcast for ${opp.opportunityBusinessId}`,
    outputSummary: `Submitted ${approval.approvalRequestBusinessId} for human approval`,
  });

  return {
    queued: true,
    approvalRequestBusinessId: approval.approvalRequestBusinessId,
    approvalStatus: approval.approvalStatus,
  };
}

/**
 * 'send' — post the visibility DM directly (confirmed, audited) for an opportunity that
 * a human has just created by APPROVING a CreateOpportunity request. No second approval
 * is queued: the human already consented to this send in the Approve dialog.
 */
async function sendTeamsBroadcast(opp: Opportunity, actor?: AuthUser) {
  return graphService.notifyTenantTeams(actor ?? { kind: 'service' }, {
    message: formatOpportunityMessage(opp),
    confirm: true,
  });
}

/**
 * Called right after an opportunity is created.
 *
 * 1. ALWAYS record the in-app "all users" notification (every create path) — this is
 *    the always-on, mock-only visibility feed.
 * 2. Teams delivery depends on `mode` (see BroadcastMode):
 *      - 'none'  → nothing here; the human web form drives Teams via the consent modal.
 *      - 'queue' → queue an approval-gated Teams broadcast (direct agent create, no
 *                  prior human approval to piggy-back on).
 *      - 'send'  → post the Teams DM directly (the create came from an already-approved
 *                  CreateOpportunity request, so the human consent is folded into that
 *                  single approval — no second approval entry).
 *
 * The in-app notification remains best-effort. A Graph delivery failure is returned
 * to the approver so the UI cannot claim that tenant delivery succeeded.
 */
async function onOpportunityCreated(opp: Opportunity, actor?: AuthUser, mode: BroadcastMode = 'none') {
  if (!notifyEnabled()) return { inAppNotification: null, teamsBroadcast: null };

  let inAppNotification = null;
  try {
    inAppNotification = await recordInAppBroadcast(opp, actor);
  } catch (err) {
    console.error('[opportunityBroadcast] in-app notification failed:', err);
  }

  let teamsBroadcast = null;
  if (mode === 'queue') {
    try {
      teamsBroadcast = await queueTeamsBroadcastApproval(opp);
    } catch (err) {
      console.error('[opportunityBroadcast] queue Teams approval failed:', err);
    }
  } else if (mode === 'send') {
    try {
      teamsBroadcast = await sendTeamsBroadcast(opp, actor);
    } catch (err) {
      console.error('[opportunityBroadcast] Teams broadcast failed:', err);
      teamsBroadcast = {
        sent: false,
        simulated: false,
        recipientCount: 0,
        deliveredCount: 0,
        failedCount: 0,
        error: err instanceof Error ? err.message : String(err),
        note: 'The opportunity was created, but the tenant-wide Teams broadcast failed.',
      };
    }
  }
  return { inAppNotification, teamsBroadcast };
}

export const opportunityBroadcastService = {
  formatOpportunityMessage,
  announce,
  onOpportunityCreated,
};
