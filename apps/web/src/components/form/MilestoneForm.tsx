import { useEffect, useState } from 'react';
import {
  WORKLOADS,
  MILESTONE_CATEGORIES,
  MILESTONE_STATUSES,
  CUSTOMER_COMMITMENTS,
  DELIVERED_BY,
  RISK_IMPACTS,
  AZURE_CAPACITY_TYPES,
  PREFERRED_AZURE_REGIONS,
  LOST_TO_COMPETITOR,
} from '@msx/shared';
import { api, type Milestone, type Opportunity, type GraphManager } from '../../api/client';
import Modal from '../Modal';
import LostToCompetitorDialog from '../LostToCompetitorDialog';
import { TextField, NumberField, DateField, TextAreaField, SelectField, BoolSelectField } from './Fields';

interface Props {
  initial?: Milestone & { opportunity?: { opportunityName: string } };
  /** Pre-selected opportunity name (e.g. when adding from an opportunity page). */
  defaultOpportunityName?: string;
  onClose: () => void;
  onSaved: () => void;
}

const isoToDateInput = (v?: string | null) => (v ? new Date(v).toISOString().slice(0, 10) : '');
const clean = (v: string) => (v.trim() === '' ? undefined : v.trim());
const boolToInput = (v?: boolean | null) => (v == null ? '' : String(v));
const boolFrom = (v: string) => (v === '' ? undefined : v === 'true');

export default function MilestoneForm({ initial, defaultOpportunityName, onClose, onSaved }: Props) {
  const editing = Boolean(initial);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [form, setForm] = useState({
    milestoneName: initial?.milestoneName ?? '',
    opportunityName: initial?.opportunity?.opportunityName ?? defaultOpportunityName ?? '',
    workload: initial?.workload ?? '',
    milestoneCategory: initial?.milestoneCategory ?? '',
    milestoneStatus: initial?.milestoneStatus ?? '',
    statusReason: initial?.statusReason ?? '',
    customerCommitment: initial?.customerCommitment ?? '',
    deliveredBy: initial?.deliveredBy ?? '',
    riskImpact: initial?.riskImpact ?? '',
    azureCapacityType: initial?.azureCapacityType ?? '',
    preferredAzureRegion: initial?.preferredAzureRegion ?? '',
    partnerName: initial?.partnerName ?? '',
    competitorName: initial?.competitorName ?? '',
    owner: initial?.owner ?? '',
    createdBy: initial?.createdBy ?? '',
    estDate: isoToDateInput(initial?.estDate),
    fitCharge: initial?.fitCharge != null ? String(initial.fitCharge) : '',
    nonRecurring: boolToInput(initial?.nonRecurring),
    riskDescription: initial?.riskDescription ?? '',
    mitigationPlan: initial?.mitigationPlan ?? '',
    blockedReason: initial?.blockedReason ?? '',
    blockedOwner: initial?.blockedOwner ?? '',
    blockedSince: isoToDateInput(initial?.blockedSince),
    expectedResolutionDate: isoToDateInput(initial?.expectedResolutionDate),
    escalated: boolToInput(initial?.escalated),
    comments: initial?.comments ?? '',
    lastUpdated: isoToDateInput(initial?.lastUpdated),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingLost, setConfirmingLost] = useState(false);
  const [managerName, setManagerName] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) api.get<Opportunity[]>('/opportunities').then(setOpportunities).catch(() => setOpportunities([]));
  }, [editing]);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  function buildBody(): Record<string, unknown> {
    return {
      milestoneName: form.milestoneName.trim(),
      workload: clean(form.workload),
      milestoneCategory: clean(form.milestoneCategory),
      milestoneStatus: clean(form.milestoneStatus),
      statusReason: clean(form.statusReason),
      customerCommitment: clean(form.customerCommitment),
      deliveredBy: clean(form.deliveredBy),
      riskImpact: clean(form.riskImpact),
      azureCapacityType: clean(form.azureCapacityType),
      preferredAzureRegion: clean(form.preferredAzureRegion),
      partnerName: clean(form.partnerName),
      competitorName: clean(form.competitorName),
      owner: clean(form.owner),
      createdBy: clean(form.createdBy),
      estDate: clean(form.estDate),
      fitCharge: form.fitCharge.trim() === '' ? undefined : Number(form.fitCharge),
      nonRecurring: boolFrom(form.nonRecurring),
      riskDescription: clean(form.riskDescription),
      mitigationPlan: clean(form.mitigationPlan),
      blockedReason: clean(form.blockedReason),
      blockedOwner: clean(form.blockedOwner),
      blockedSince: clean(form.blockedSince),
      expectedResolutionDate: clean(form.expectedResolutionDate),
      escalated: boolFrom(form.escalated),
      comments: clean(form.comments),
      lastUpdated: clean(form.lastUpdated),
    };
  }

  async function doSave(acknowledgeManagerEmail: boolean) {
    setBusy(true);
    setError(null);
    const body = buildBody();
    try {
      if (editing && initial) {
        await api.patch(`/milestones/${initial.id}`, { ...body, acknowledgeManagerEmail });
      } else {
        await api.post('/milestones', { ...body, opportunityName: form.opportunityName.trim() });
      }
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function save() {
    setError(null);
    // A real transition INTO Lost To Competitor (edit only — creating a new
    // milestone doesn't trigger the manager email) needs an acknowledgement.
    const movingToLost =
      editing &&
      initial?.milestoneStatus !== LOST_TO_COMPETITOR &&
      clean(form.milestoneStatus) === LOST_TO_COMPETITOR;
    if (movingToLost) {
      setManagerName(null);
      api
        .get<{ manager: GraphManager | null }>('/graph/manager')
        .then((r) => setManagerName(r.manager?.displayName ?? r.manager?.mail ?? null))
        .catch(() => setManagerName(null));
      setConfirmingLost(true);
      return;
    }
    void doSave(false);
  }

  const canSave = form.milestoneName.trim() !== '' && (editing || form.opportunityName.trim() !== '');

  return (
    <Modal
      title={editing ? 'Edit milestone' : 'New milestone'}
      onClose={onClose}
      footer={
        <>
          <button className="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button onClick={save} disabled={busy || !canSave}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {error && <p className="error">{error}</p>}
      <div className="form-grid">
        <TextField label="Milestone name" value={form.milestoneName} onChange={set('milestoneName')} required full />
        {!editing && (
          <SelectField
            label="Opportunity"
            value={form.opportunityName}
            onChange={set('opportunityName')}
            options={opportunities.map((o) => o.opportunityName)}
            required
            full
            placeholder="Select an opportunity…"
          />
        )}
        <SelectField label="Workload" value={form.workload} onChange={set('workload')} options={WORKLOADS} />
        <SelectField label="Category" value={form.milestoneCategory} onChange={set('milestoneCategory')} options={MILESTONE_CATEGORIES} />
        <SelectField label="Status" value={form.milestoneStatus} onChange={set('milestoneStatus')} options={MILESTONE_STATUSES} />
        <SelectField label="Customer commitment" value={form.customerCommitment} onChange={set('customerCommitment')} options={CUSTOMER_COMMITMENTS} />
        <SelectField label="Delivered by" value={form.deliveredBy} onChange={set('deliveredBy')} options={DELIVERED_BY} />
        <SelectField label="Risk impact" value={form.riskImpact} onChange={set('riskImpact')} options={RISK_IMPACTS} />
        <SelectField label="Azure capacity type" value={form.azureCapacityType} onChange={set('azureCapacityType')} options={AZURE_CAPACITY_TYPES} />
        <SelectField label="Preferred Azure region" value={form.preferredAzureRegion} onChange={set('preferredAzureRegion')} options={PREFERRED_AZURE_REGIONS} />
        <TextField label="Partner" value={form.partnerName} onChange={set('partnerName')} />
        <TextField label="Competitor" value={form.competitorName} onChange={set('competitorName')} />
        <TextField label="Owner" value={form.owner} onChange={set('owner')} />
        <TextField label="Created by" value={form.createdBy} onChange={set('createdBy')} />
        <DateField label="Estimated date" value={form.estDate} onChange={set('estDate')} />
        <NumberField label="Fit charge" value={form.fitCharge} onChange={set('fitCharge')} />
        <BoolSelectField label="Non-recurring" value={form.nonRecurring} onChange={set('nonRecurring')} />
        <TextField label="Status reason" value={form.statusReason} onChange={set('statusReason')} />
        <DateField label="Last updated" value={form.lastUpdated} onChange={set('lastUpdated')} />
        <TextAreaField label="Risk description" value={form.riskDescription} onChange={set('riskDescription')} full />
        <TextAreaField label="Mitigation plan" value={form.mitigationPlan} onChange={set('mitigationPlan')} full />
        <TextAreaField label="Blocked reason" value={form.blockedReason} onChange={set('blockedReason')} full />
        <TextField label="Blocked owner" value={form.blockedOwner} onChange={set('blockedOwner')} />
        <DateField label="Blocked since" value={form.blockedSince} onChange={set('blockedSince')} />
        <DateField label="Expected resolution" value={form.expectedResolutionDate} onChange={set('expectedResolutionDate')} />
        <BoolSelectField label="Escalated" value={form.escalated} onChange={set('escalated')} />
        <TextAreaField label="Comments" value={form.comments} onChange={set('comments')} full />
      </div>
      {confirmingLost && (
        <LostToCompetitorDialog
          managerName={managerName}
          busy={busy}
          onCancel={() => setConfirmingLost(false)}
          onConfirm={() => void doSave(true)}
        />
      )}
    </Modal>
  );
}
