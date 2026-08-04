import { LOST_TO_COMPETITOR } from '@msx/shared';
import type { AuthUser } from '../lib/entraAuth.js';
import { prisma } from '../lib/prisma.js';
import { recordAgentAction } from '../lib/audit.js';
import { graphService } from './graph.service.js';

/**
 * Executive-summary email to the seller's manager when a milestone is marked
 * "Lost To Competitor".
 *
 * Governance: this is NOT an autonomous send. It runs only after an explicit
 * human acknowledgement (the pop-up in the web app sets `acknowledged`). The
 * manager is resolved from real Microsoft Entra data via Graph `/me/manager`
 * (Option B), but the email body is built purely from the mock milestone /
 * opportunity records — no real business data is introduced or persisted.
 *
 * Best-effort by design: any failure (no signed-in user, no manager, Graph
 * error) is recorded and swallowed so it can NEVER roll back the status change
 * that triggered it.
 */

interface NotifyParams {
  /** The signed-in user whose manager should be notified (acts as sender). */
  user?: AuthUser;
  /** Internal id of the milestone that just moved to Lost To Competitor. */
  milestoneId: string;
  /** Display name of whoever made the change (for the email + audit actor). */
  changedBy?: string;
  /** The human acknowledgement that authorises the send. */
  acknowledged?: boolean;
}

export interface ManagerEmailOutcome {
  /** True once we tried to resolve a manager / send (i.e. acknowledged + a user). */
  attempted: boolean;
  sent?: boolean;
  simulated?: boolean;
  managerEmail?: string;
  /** Why nothing was sent, when attempted is false or sent is false. */
  skippedReason?: string;
}

const money = (v?: number | null) =>
  typeof v === 'number'
    ? v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
    : 'Not specified';

const orDash = (v?: string | null) => (v && v.trim() ? v.trim() : 'Not specified');

const firstName = (displayName?: string) => (displayName?.trim().split(/\s+/)[0] ?? 'there');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildEmail(milestone: any, managerDisplayName?: string, changedBy?: string) {
  const opp = milestone.opportunity ?? {};
  const competitor = milestone.competitorName ?? opp.competitorName ?? null;
  const customer = opp.customerName ?? 'the customer';
  const oppName = opp.opportunityName ?? 'an opportunity';

  const subject = `Opportunity lost to competitor: ${oppName}${competitor ? ` (to ${competitor})` : ''}`;

  const lines: string[] = [
    `Hi ${firstName(managerDisplayName)},`,
    '',
    `Flagging for your awareness: the milestone "${milestone.milestoneName}" on ${oppName} for ${customer} has been marked "${LOST_TO_COMPETITOR}".`,
    '',
    'EXECUTIVE SUMMARY',
    `- Customer: ${orDash(opp.customerName)}${opp.industry ? ` (${opp.industry})` : ''}`,
    `- Opportunity: ${oppName} [${orDash(opp.opportunityBusinessId)}]`,
    `- Milestone: ${milestone.milestoneName} [${orDash(milestone.milestoneBusinessId)}]`,
    `- Sales stage: ${orDash(opp.salesStage)}`,
    `- Estimated revenue at risk: ${money(opp.estimatedRevenue)}`,
    `- Competitor: ${orDash(competitor)}`,
    `- Workload: ${orDash(milestone.workload)}`,
    `- Milestone owner: ${orDash(milestone.owner)}`,
    `- Status reason: ${orDash(milestone.statusReason)}`,
    '',
    'CONTEXT',
    `- Business problem: ${orDash(opp.businessProblem)}`,
    `- Known risk: ${orDash(milestone.riskDescription)}`,
    `- Mitigation attempted: ${orDash(milestone.mitigationPlan)}`,
  ];
  if (milestone.comments) lines.push(`- Notes: ${milestone.comments}`);
  lines.push(
    '',
    'RECOMMENDED NEXT STEPS',
    '- Confirm the loss with the account team and update the opportunity status.',
    '- Capture the competitive displacement reason for win/loss reporting.',
    '- Assess whether any adjacent workloads remain in play to protect pipeline.',
    '',
    `Marked by ${orDash(changedBy)} on ${new Date().toLocaleString('en-US')}.`,
    '',
    '— Sent automatically by the Multi-Agent Sales Assistant. This is a synthetic mock application; the opportunity and milestone details above are sample data, not real customer records.',
  );

  return { subject, body: lines.join('\n') };
}

async function recordSkip(
  actor: string | undefined,
  milestone: { opportunityId?: string | null; id: string } | null,
  reason: string,
) {
  await recordAgentAction({
    agentName: 'ManagerNotifier',
    actionType: 'SendOutlookMail',
    actionName: 'Lost-to-competitor manager email skipped',
    actor,
    opportunityId: milestone?.opportunityId ?? undefined,
    relatedMilestoneId: milestone?.id ?? undefined,
    securityEvent: true,
    result: 'Blocked',
    outputSummary: `Not sent — ${reason}`,
  });
}

export const managerNotificationsService = {
  /**
   * Sends the manager email for a milestone that just became Lost To Competitor.
   * Returns an outcome describing what happened; never throws.
   */
  async notifyManagerLostToCompetitor(params: NotifyParams): Promise<ManagerEmailOutcome> {
    const { user, milestoneId, changedBy, acknowledged } = params;
    const actor = user?.email ?? changedBy;

    if (!acknowledged) {
      return { attempted: false, skippedReason: 'manager email not acknowledged' };
    }
    if (!user || user.kind !== 'user' || !user.bearer) {
      // No delegated identity → cannot resolve a manager or send as the user.
      return { attempted: false, skippedReason: 'no signed-in Microsoft user' };
    }

    try {
      const milestone = await prisma.opportunityMilestone.findUnique({
        where: { id: milestoneId },
        include: { opportunity: true },
      });
      if (!milestone) {
        return { attempted: false, skippedReason: 'milestone not found' };
      }

      const manager = await graphService.manager(user);
      const managerEmail = manager?.mail ?? manager?.userPrincipalName ?? undefined;
      if (!manager || !managerEmail) {
        await recordSkip(actor, milestone, 'no manager on record for the signed-in user');
        return { attempted: true, sent: false, skippedReason: 'no manager on record' };
      }

      const { subject, body } = buildEmail(milestone, manager.displayName, changedBy);

      const result = (await graphService.sendMail(user, {
        to: managerEmail,
        subject,
        body,
        confirm: true,
      })) as { sent?: boolean; simulated?: boolean };

      await recordAgentAction({
        agentName: 'ManagerNotifier',
        actionType: 'SendOutlookMail',
        actionName: 'Lost-to-competitor manager email',
        actor,
        opportunityId: milestone.opportunityId,
        relatedMilestoneId: milestone.id,
        securityEvent: true,
        result: 'Success',
        inputSummary: `Milestone ${milestone.milestoneBusinessId} → ${LOST_TO_COMPETITOR}`,
        outputSummary: `${result?.simulated ? 'Simulated' : 'Sent'} manager email to ${managerEmail} — "${subject}"`,
      });

      return {
        attempted: true,
        sent: Boolean(result?.sent),
        simulated: Boolean(result?.simulated),
        managerEmail,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        const m = await prisma.opportunityMilestone.findUnique({
          where: { id: milestoneId },
          select: { id: true, opportunityId: true },
        });
        await recordSkip(actor, m, message);
      } catch {
        /* audit best-effort */
      }
      return { attempted: true, sent: false, skippedReason: message };
    }
  },
};

/**
 * Fires the manager email only on a real transition INTO Lost To Competitor
 * (old status was something else). Shared by every write path that can change a
 * milestone's status. Returns the send outcome, or null when it wasn't a
 * qualifying transition.
 */
export async function maybeNotifyManager(
  oldStatus: string | null | undefined,
  milestone: { id: string; milestoneStatus?: string | null },
  ctx?: MilestoneNotifyContext,
): Promise<ManagerEmailOutcome | null> {
  const movedToLost =
    milestone.milestoneStatus === LOST_TO_COMPETITOR && oldStatus !== LOST_TO_COMPETITOR;
  if (!movedToLost) return null;
  return managerNotificationsService.notifyManagerLostToCompetitor({
    user: ctx?.user,
    milestoneId: milestone.id,
    changedBy: ctx?.changedBy,
    acknowledged: ctx?.acknowledgeManagerEmail,
  });
}

/** Context threaded from a controller/service into a status-changing write. */
export interface MilestoneNotifyContext {
  user?: AuthUser;
  changedBy?: string;
  acknowledgeManagerEmail?: boolean;
}
