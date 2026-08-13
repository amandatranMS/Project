import { useEffect, useMemo, useState } from 'react';
import { useMsal } from '@azure/msal-react';
import { Link } from 'react-router-dom';
import { choiceLabel, LOST_TO_COMPETITOR } from '@msx/shared';
import {
  api,
  type ApprovalRequest,
  type GraphManager,
  type ManagerEmailOutcome,
  type MilestoneApprovalFields,
  type OpportunityApprovalFields,
} from '../api/client';
import { statusBadgeClass } from '../ui';
import LostToCompetitorDialog from '../components/LostToCompetitorDialog';
import ApproveTeamsBroadcastDialog from '../components/ApproveTeamsBroadcastDialog';

const milestoneFieldLabels: Array<[keyof MilestoneApprovalFields, string]> = [
  ['milestoneName', 'Milestone Name'],
  ['milestoneCategory', 'Category'],
  ['owner', 'Owner'],
  ['estDate', 'Estimated Date'],
  ['fitCharge', 'Fit Charge'],
  ['competitorName', 'Competitor'],
  ['riskImpact', 'Risk Impact'],
  ['comments', 'Description'],
  ['milestoneStatus', 'Status'],
  ['statusReason', 'Status Reason'],
  ['workload', 'Workload'],
  ['customerCommitment', 'Customer Commitment'],
  ['deliveredBy', 'Delivered By'],
  ['partnerName', 'Partner'],
  ['nonRecurring', 'Non-Recurring'],
  ['riskDescription', 'Risk Description'],
  ['mitigationPlan', 'Mitigation Plan'],
  ['blockedReason', 'Blocked Reason'],
  ['blockedOwner', 'Blocked Owner'],
  ['blockedSince', 'Blocked Since'],
  ['expectedResolutionDate', 'Expected Resolution'],
  ['escalated', 'Escalated'],
  ['azureCapacityType', 'Azure Capacity Type'],
  ['preferredAzureRegion', 'Preferred Azure Region'],
  ['lastUpdated', 'Last Updated'],
];

function displayFieldValue(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return value.toLocaleString();
  return value;
}

const opportunityFieldLabels: Array<[keyof OpportunityApprovalFields, string]> = [
  ['opportunityName', 'Opportunity Name'],
  ['customerName', 'Account'],
  ['tpid', 'TPID'],
  ['industry', 'Industry'],
  ['solutionArea', 'Solution Area'],
  ['salesStage', 'Sales Stage'],
  ['status', 'Status'],
  ['estimatedRevenue', 'Estimated Revenue'],
  ['closeDate', 'Close Date'],
  ['aeOwner', 'AE Owner'],
  ['assignedSE', 'Assigned SE'],
  ['competitorName', 'Competitor'],
  ['consumptionPhase', 'Consumption Phase'],
  ['businessProblem', 'Business Problem'],
  ['nextStep', 'Next Step'],
  ['lastUpdated', 'Last Updated'],
];

export default function Approvals() {
  const { accounts } = useMsal();
  const reviewedBy = accounts[0]?.name ?? accounts[0]?.username ?? 'Demo Approver';
  const [items, setItems] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmingLostId, setConfirmingLostId] = useState<string | null>(null);
  const [managerName, setManagerName] = useState<string | null>(null);
  const [confirmingTeamsId, setConfirmingTeamsId] = useState<string | null>(null);
  // Requests come back ordered by business ID; default to newest-first by
  // creation time and let the user flip it to review oldest requests first.
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  function load() {
    api
      .get<ApprovalRequest[]>('/approval-requests')
      .then(setItems)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const sortedItems = useMemo(() => {
    const withTime = items.map((item) => ({ item, time: new Date(item.createdAt ?? 0).getTime() }));
    withTime.sort((a, b) => (sortOrder === 'desc' ? b.time - a.time : a.time - b.time));
    return withTime.map((w) => w.item);
  }, [items, sortOrder]);

  /** True when approving this request will move a milestone to Lost To Competitor. */
  function movesToLost(a: ApprovalRequest): boolean {
    return a.pendingAction?.kind === 'UpdateMilestone' && a.pendingAction.milestoneStatus === LOST_TO_COMPETITOR;
  }

  /**
   * True when approving this request CREATES a new opportunity. Approving it also posts
   * the "notify the team" Teams message directly (folded into this single approval), so
   * we warn about that send in the same confirm dialog.
   */
  function createsOpportunity(a: ApprovalRequest): boolean {
    return a.pendingAction?.kind === 'CreateOpportunity';
  }

  function onApproveClick(a: ApprovalRequest) {
    setMessage(null);
    setError(null);
    if (movesToLost(a)) {
      setManagerName(null);
      api
        .get<{ manager: GraphManager | null }>('/graph/manager')
        .then((r) => setManagerName(r.manager?.displayName ?? r.manager?.mail ?? null))
        .catch(() => setManagerName(null));
      setConfirmingLostId(a.id);
      return;
    }
    if (createsOpportunity(a)) {
      setConfirmingTeamsId(a.id);
      return;
    }
    void decide(a.id, 'approve');
  }

  async function decide(
    id: string,
    action: 'approve' | 'reject' | 'needs-changes',
    acknowledgeManagerEmail = false,
    skipBroadcast = false,
  ) {
    setBusyId(id);
    setMessage(null);
    try {
      const result = await api.patch<{
        milestone?: { milestoneBusinessId: string; milestoneName: string };
        action?: string;
        result?: {
          milestoneBusinessId?: string;
          milestoneName?: string;
          managerEmail?: ManagerEmailOutcome;
          sent?: boolean;
          simulated?: boolean;
          recipientCount?: number;
          deliveredCount?: number;
          failedCount?: number;
          error?: string;
          note?: string;
          teamsBroadcast?: {
            sent: boolean;
            simulated: boolean;
            recipientCount: number;
            deliveredCount: number;
            failedCount: number;
            error?: string;
            note?: string;
          } | null;
        };
      }>(`/approval-requests/${id}/${action}`, { reviewedBy, acknowledgeManagerEmail, skipBroadcast });
      setConfirmingLostId(null);
      setConfirmingTeamsId(null);
      if (action === 'approve') {
        const milestone = result?.milestone ?? (
          result?.action === 'CreateMilestone' && result.result?.milestoneBusinessId && result.result.milestoneName
            ? result.result as { milestoneBusinessId: string; milestoneName: string }
            : undefined
        );
        if (milestone) {
          setMessage(`Approved — milestone created: ${milestone.milestoneBusinessId} — ${milestone.milestoneName}`);
        } else if (result?.action) {
          const email = result.result?.managerEmail;
          const emailNote =
            email?.attempted && email.sent
              ? ` Manager email ${email.simulated ? 'simulated' : 'sent'}${email.managerEmail ? ` to ${email.managerEmail}` : ''}.`
              : email?.attempted && !email.sent
                ? ` Manager email not sent — ${email.skippedReason ?? 'unknown reason'}.`
                : '';
          const teams =
            result.result?.teamsBroadcast ??
            (result.action === 'NotifyTeams' &&
            typeof result.result?.recipientCount === 'number' &&
            typeof result.result.deliveredCount === 'number' &&
            typeof result.result.failedCount === 'number'
              ? {
                  sent: result.result.sent ?? false,
                  simulated: result.result.simulated ?? false,
                  recipientCount: result.result.recipientCount,
                  deliveredCount: result.result.deliveredCount,
                  failedCount: result.result.failedCount,
                  error: result.result.error,
                  note: result.result.note,
                }
              : null);
          const teamsNote = teams
            ? teams.simulated
              ? ' Tenant-wide Teams broadcast was simulated, not delivered.'
              : teams.error
                ? ` Tenant-wide Teams broadcast failed: ${teams.error}`
                : teams.failedCount > 0
                  ? teams.deliveredCount > 0
                    ? ` Teams delivery was partial: ${teams.deliveredCount}/${teams.recipientCount} recipients; ${teams.failedCount} failed.${teams.note ? ` ${teams.note}` : ''}`
                    : ` Teams delivery failed: 0/${teams.recipientCount} recipients; ${teams.failedCount} failed.${teams.note ? ` ${teams.note}` : ''}`
                  : ` Teams message delivered to all ${teams.deliveredCount} eligible tenant members.`
            : '';
          setMessage(`Approved — action executed: ${result.action} (simulated where applicable, recorded in the audit log).${emailNote}${teamsNote}`);
        } else {
          setMessage('Approved.');
        }
      }
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Approval Requests</h1>
      </div>
      <p className="muted">
        Human-in-the-loop gate. The agent only submits requests — approving one here executes the
        action (create milestone, update/delete milestone, send email, or post Teams) and records it
        in the audit log. Nothing the agent proposes happens until a human approves.
      </p>
      {error && <p className="error">{error}</p>}
      {message && <p style={{ color: 'var(--success)' }}>{message}</p>}
      <div className="row" style={{ marginBottom: 'var(--sp-3)' }}>
        <label className="muted" htmlFor="approvals-sort" style={{ fontSize: 13 }}>Sort by time</label>
        <select id="approvals-sort" value={sortOrder} onChange={(e) => setSortOrder(e.target.value as 'desc' | 'asc')}>
          <option value="desc">Latest first</option>
          <option value="asc">Earliest first</option>
        </select>
      </div>
      <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Request</th>
            <th>Opportunity</th>
            <th>Requested By</th>
            <th>Approval</th>
            <th>Writeback</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading &&
            Array.from({ length: 6 }).map((_, i) => (
              <tr key={`sk-${i}`} className="skeleton-row">
                <td colSpan={7}>
                  <span className="skeleton-line" />
                </td>
              </tr>
            ))}
          {!loading && sortedItems.map((a) => (
            <tr key={a.id}>
              <td>{a.approvalRequestBusinessId}</td>
              <td>
                <div>{a.requestName ?? '—'}</div>
                {a.pendingAction?.milestoneFields && (
                  <details className="approval-fields">
                    <summary>Review fields</summary>
                    <dl>
                      {milestoneFieldLabels.map(([key, label]) => {
                        const value = a.pendingAction?.milestoneFields?.[key];
                        if (value === null || value === undefined || value === '') return null;
                        return (
                          <div key={key}>
                            <dt>{label}</dt>
                            <dd>{displayFieldValue(value)}</dd>
                          </div>
                        );
                      })}
                    </dl>
                  </details>
                )}
                {a.pendingAction?.opportunityFields && (
                  <details className="approval-fields">
                    <summary>Review fields</summary>
                    <dl>
                      {opportunityFieldLabels.map(([key, label]) => {
                        const value = a.pendingAction?.opportunityFields?.[key];
                        if (value === null || value === undefined || value === '') return null;
                        return (
                          <div key={key}>
                            <dt>{label}</dt>
                            <dd>{displayFieldValue(value)}</dd>
                          </div>
                        );
                      })}
                    </dl>
                  </details>
                )}
              </td>
              <td>{a.opportunity?.opportunityName ?? '—'}</td>
              <td>{a.requestedBy ?? '—'}</td>
              <td><span className={`badge ${statusBadgeClass(a.approvalStatus)}`}>{choiceLabel(a.approvalStatus)}</span></td>
              <td>{a.mockWritebackStatus ?? '—'}</td>
              <td>
                <div className="btn-row">
                  {(a.approvalStatus === 'Pending' || a.approvalStatus === 'Needs Changes') && (
                    <>
                      <button disabled={busyId === a.id} onClick={() => onApproveClick(a)}>Approve</button>
                      <button className="danger" disabled={busyId === a.id} onClick={() => decide(a.id, 'reject')}>Reject</button>
                      <button className="secondary" disabled={busyId === a.id} onClick={() => decide(a.id, 'needs-changes')}>Needs changes</button>
                    </>
                  )}
                  {a.approvalStatus === 'Approved' && (
                    a.relatedMilestone ? (
                      <Link to={`/milestones/${a.relatedMilestone.milestoneBusinessId}`}>
                        View {a.relatedMilestone.milestoneBusinessId}
                      </Link>
                    ) : (
                      <span className="muted">Executed</span>
                    )
                  )}
                  {a.approvalStatus === 'Rejected' && <span className="muted">Rejected</span>}
                </div>
              </td>
            </tr>
          ))}
          {!loading && items.length === 0 && !error && (
            <tr><td colSpan={7} className="muted">No approval requests.</td></tr>
          )}
        </tbody>
      </table>
      </div>

      {confirmingLostId && (
        <LostToCompetitorDialog
          managerName={managerName}
          busy={busyId === confirmingLostId}
          onCancel={() => setConfirmingLostId(null)}
          onConfirm={() => void decide(confirmingLostId, 'approve', true)}
        />
      )}

      {confirmingTeamsId && (() => {
        const confirmingItem = items.find((i) => i.id === confirmingTeamsId);
        return (
          <ApproveTeamsBroadcastDialog
            requestName={confirmingItem?.requestName}
            opportunityName={confirmingItem?.opportunity?.opportunityName}
            alsoCreatesOpportunity={confirmingItem?.pendingAction?.kind === 'CreateOpportunity'}
            busy={busyId === confirmingTeamsId}
            onCancel={() => setConfirmingTeamsId(null)}
            onConfirm={() => void decide(confirmingTeamsId, 'approve')}
            onConfirmWithoutBroadcast={() => void decide(confirmingTeamsId, 'approve', false, true)}
          />
        );
      })()}
    </div>
  );
}
