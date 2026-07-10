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
} from '@msx/shared';
import { api, type Milestone, type Opportunity } from '../../api/client';
import Modal from '../Modal';
import { TextField, NumberField, DateField, TextAreaField, SelectField } from './Fields';

interface Props {
  initial?: Milestone & { opportunity?: { opportunityName: string } };
  /** Pre-selected opportunity name (e.g. when adding from an opportunity page). */
  defaultOpportunityName?: string;
  onClose: () => void;
  onSaved: () => void;
}

const isoToDateInput = (v?: string | null) => (v ? new Date(v).toISOString().slice(0, 10) : '');
const clean = (v: string) => (v.trim() === '' ? undefined : v.trim());

export default function MilestoneForm({ initial, defaultOpportunityName, onClose, onSaved }: Props) {
  const editing = Boolean(initial);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [form, setForm] = useState({
    milestoneName: initial?.milestoneName ?? '',
    opportunityName: initial?.opportunity?.opportunityName ?? defaultOpportunityName ?? '',
    workload: initial?.workload ?? '',
    milestoneCategory: initial?.milestoneCategory ?? '',
    milestoneStatus: initial?.milestoneStatus ?? '',
    customerCommitment: '',
    deliveredBy: '',
    riskImpact: initial?.riskImpact ?? '',
    azureCapacityType: '',
    preferredAzureRegion: '',
    partnerName: initial?.partnerName ?? '',
    owner: initial?.owner ?? '',
    estDate: isoToDateInput(initial?.estDate),
    fitCharge: initial?.fitCharge != null ? String(initial.fitCharge) : '',
    riskDescription: initial?.riskDescription ?? '',
    blockedReason: initial?.blockedReason ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) api.get<Opportunity[]>('/opportunities').then(setOpportunities).catch(() => setOpportunities([]));
  }, [editing]);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      milestoneName: form.milestoneName.trim(),
      workload: clean(form.workload),
      milestoneCategory: clean(form.milestoneCategory),
      milestoneStatus: clean(form.milestoneStatus),
      customerCommitment: clean(form.customerCommitment),
      deliveredBy: clean(form.deliveredBy),
      riskImpact: clean(form.riskImpact),
      azureCapacityType: clean(form.azureCapacityType),
      preferredAzureRegion: clean(form.preferredAzureRegion),
      partnerName: clean(form.partnerName),
      owner: clean(form.owner),
      estDate: clean(form.estDate),
      fitCharge: form.fitCharge.trim() === '' ? undefined : Number(form.fitCharge),
      riskDescription: clean(form.riskDescription),
      blockedReason: clean(form.blockedReason),
    };
    try {
      if (editing && initial) {
        await api.patch(`/milestones/${initial.id}`, body);
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
        <TextField label="Owner" value={form.owner} onChange={set('owner')} />
        <DateField label="Estimated date" value={form.estDate} onChange={set('estDate')} />
        <NumberField label="Fit charge" value={form.fitCharge} onChange={set('fitCharge')} />
        <TextAreaField label="Risk description" value={form.riskDescription} onChange={set('riskDescription')} full />
        <TextAreaField label="Blocked reason" value={form.blockedReason} onChange={set('blockedReason')} full />
      </div>
    </Modal>
  );
}
