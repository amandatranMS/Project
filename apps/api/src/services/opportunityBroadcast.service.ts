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
 * Microsoft Teams, split into two governance-preserving paths:
 *
 *  - **Human create (Path A):** the web app shows an inline consent modal right
 *    after the opportunity is saved. On agree it calls `announce()` below, which
 *    posts the Teams DM (confirmed) and is audited by graphService.notifyTeams.
 *
 *  - **Agent create (Path B):** the agent never sends directly. `onOpportunityCreated`
 *    queues a Pending ApprovalRequest carrying a deferred `NotifyTeams` action, so
 *    the message only goes out when a human approves it in the Approvals tab
 *    (approvalRequestsService.decide executes + audits it).
 *
 * Teams delivery is 1:1 (there is no channel-post capability), so the recipient is
 * a single teammate address configured via TEAMS_BROADCAST_TO. Nothing is delivered
 * unless GRAPH_SEND_MODE=live (otherwise notifyTeams records a simulated, audited,
 * undelivered send). No new tables/columns — the deferred action is stored on the
 * existing ApprovalRequest.errorMessage column.
 */

/**
 * Mirror of the tag used by approvalRequests.service. Deferred actions are stored
 * on ApprovalRequest.errorMessage as `${ACTION_TAG}${json}`; that service's
 * decodeAction() reads the same prefix and executes the action on approval.
 */
const ACTION_TAG = 'MSX_ACTION::';

/** Recipient for the Teams visibility DM (a teammate — 1:1 chat only). */
function broadcastRecipient(): string | undefined {
  const v = process.env.TEAMS_BROADCAST_TO?.trim();
  return v || undefined;
}

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

  const to = broadcastRecipient();
  if (!to) {
    throw new HttpError(
      400,
      'No Teams broadcast recipient is configured. Set TEAMS_BROADCAST_TO to a teammate\u2019s email address.',
    );
  }

  return graphService.notifyTeams(actor ?? { kind: 'service' }, {
    message: formatOpportunityMessage(opp),
    to,
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
 * Path B — queue a human-gated approval so the agent's message shows up in the
 * Approvals tab and is only delivered once a human approves it. Returns null (and
 * sends nothing) when no recipient is configured.
 */
async function queueTeamsBroadcastApproval(opp: Opportunity) {
  const to = broadcastRecipient();
  if (!to) return null;

  const action: PendingAction = {
    kind: 'NotifyTeams',
    message: formatOpportunityMessage(opp),
    to,
  };

  return prisma.approvalRequest.create({
    data: {
      approvalRequestBusinessId: genId('APR'),
      requestName: `Notify team of new opportunity ${opp.opportunityBusinessId} via Teams (${to})`,
      approvalStatus: 'Pending',
      requestStatus: 'Submitted',
      requestedBy: 'OpportunityBroadcast (agent)',
      errorMessage: ACTION_TAG + JSON.stringify(action),
      opportunity: connectOpportunity(opp.opportunityName),
    },
  });
}

/**
 * Called (best-effort) right after an opportunity is created.
 *
 * 1. ALWAYS record the in-app "all users" notification (both human and agent
 *    creates) — this is the always-on, mock-only visibility feed.
 * 2. Teams delivery stays consent-gated: human form creates are handled inline by
 *    the web modal (Path A → announce), so here we only queue the approval-gated
 *    Teams broadcast when an agent initiated the create (viaAgent → Path B). This
 *    covers both the in-app assistant and the Foundry hosted agent, regardless of
 *    whether the agent authenticates as a user (on-behalf-of) or a service.
 *
 * Each step is isolated so one failing never blocks the other or the create.
 */
async function onOpportunityCreated(opp: Opportunity, actor?: AuthUser, viaAgent = false) {
  if (!notifyEnabled()) return;

  try {
    await recordInAppBroadcast(opp, actor);
  } catch (err) {
    console.error('[opportunityBroadcast] in-app notification failed:', err);
  }

  if (viaAgent) {
    try {
      await queueTeamsBroadcastApproval(opp);
    } catch (err) {
      console.error('[opportunityBroadcast] queue Teams approval failed:', err);
    }
  }
}

export const opportunityBroadcastService = {
  formatOpportunityMessage,
  announce,
  onOpportunityCreated,
};
