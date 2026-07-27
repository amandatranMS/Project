import { useEffect, useState } from 'react';
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
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmingLostId, setConfirmingLostId] = useState<string | null>(null);
  const [managerName, setManagerName] = useState<string | null>(null);
  const [confirmingTeamsId, setConfirmingTeamsId] = useState<string | null>(null);

  function load() {
    api
      .get<ApprovalRequest[]>('/approval-requests')
      .then(setItems)
      .catch((e) => setError(e.message));
  }

  useEffect(load, []);

  /** True when approving this request will move a milestone to Lost To Competitor. */
  function movesToLost(a: ApprovalRequest): boolean {
    return a.pendingAction?.kind === 'UpdateMilestone' && a.pendingAction.milestoneStatus === LOST_TO_COMPETITOR;
  }

  /** True when approving this request will post a new-opportunity broadcast to Teams. */
  function isTeamsBroadcast(a: ApprovalRequest): boolean {
    return a.pendingAction?.kind === 'NotifyTeams';
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
    if (isTeamsBroadcast(a)) {
      setConfirmingTeamsId(a.id);
      return;
    }
    void decide(a.id, 'approve');
  }

  async function decide(
    id: string,
    action: 'approve' | 'reject' | 'needs-changes',
    acknowledgeManagerEmail = false,
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
        };
      }>(`/approval-requests/${id}/${action}`, { reviewedBy, acknowledgeManagerEmail });
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
          setMessage(`Approved — action executed: ${result.action} (simulated where applicable, recorded in the audit log).${emailNote}`);
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
          {items.map((a) => (
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
          {items.length === 0 && !error && (
            <tr><td colSpan={7} className="muted">No approval requests.</td></tr>
          )}
        </tbody>
      </table>

      {confirmingLostId && (
        <LostToCompetitorDialog
          managerName={managerName}
          busy={busyId === confirmingLostId}
          onCancel={() => setConfirmingLostId(null)}
          onConfirm={() => void decide(confirmingLostId, 'approve', true)}
        />
      )}

      {confirmingTeamsId && (
        <ApproveTeamsBroadcastDialog
          requestName={items.find((i) => i.id === confirmingTeamsId)?.requestName}
          opportunityName={items.find((i) => i.id === confirmingTeamsId)?.opportunity?.opportunityName}
          busy={busyId === confirmingTeamsId}
          onCancel={() => setConfirmingTeamsId(null)}
          onConfirm={() => void decide(confirmingTeamsId, 'approve')}
        />
      )}
    </div>
  );
}
