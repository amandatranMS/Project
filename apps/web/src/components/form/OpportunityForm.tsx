import { useState } from 'react';
import { SOLUTION_AREAS, SALES_STAGES, OPPORTUNITY_STATUSES } from '@msx/shared';
import { api, type Opportunity } from '../../api/client';
import Modal from '../Modal';
import { TextField, NumberField, DateField, TextAreaField, SelectField } from './Fields';

interface Props {
  initial?: Opportunity;
  onClose: () => void;
  onSaved: () => void;
}

const isoToDateInput = (v?: string | null) => (v ? new Date(v).toISOString().slice(0, 10) : '');
const clean = (v: string) => (v.trim() === '' ? undefined : v.trim());

export default function OpportunityForm({ initial, onClose, onSaved }: Props) {
  const editing = Boolean(initial);
  const [form, setForm] = useState({
    opportunityName: initial?.opportunityName ?? '',
    customerName: initial?.customerName ?? '',
    tpid: initial?.tpid ?? '',
    solutionArea: initial?.solutionArea ?? '',
    salesStage: initial?.salesStage ?? '',
    status: initial?.status ?? '',
    estimatedRevenue: initial?.estimatedRevenue != null ? String(initial.estimatedRevenue) : '',
    closeDate: isoToDateInput(initial?.closeDate),
    competitorName: initial?.competitorName ?? '',
    aeOwner: initial?.aeOwner ?? '',
    assignedSE: initial?.assignedSE ?? '',
    industry: initial?.industry ?? '',
    consumptionPhase: initial?.consumptionPhase ?? '',
    lastUpdated: isoToDateInput(initial?.lastUpdated),
    businessProblem: initial?.businessProblem ?? '',
    nextStep: initial?.nextStep ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      opportunityName: form.opportunityName.trim(),
      customerName: clean(form.customerName),
      tpid: clean(form.tpid),
      solutionArea: clean(form.solutionArea),
      salesStage: clean(form.salesStage),
      status: clean(form.status),
      estimatedRevenue: form.estimatedRevenue.trim() === '' ? undefined : Number(form.estimatedRevenue),
      closeDate: clean(form.closeDate),
      competitorName: clean(form.competitorName),
      aeOwner: clean(form.aeOwner),
      assignedSE: clean(form.assignedSE),
      industry: clean(form.industry),
      consumptionPhase: clean(form.consumptionPhase),
      lastUpdated: clean(form.lastUpdated),
      businessProblem: clean(form.businessProblem),
      nextStep: clean(form.nextStep),
    };
    try {
      if (editing && initial) await api.patch(`/opportunities/${initial.id}`, body);
      else await api.post('/opportunities', body);
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={editing ? 'Edit opportunity' : 'New opportunity'}
      onClose={onClose}
      footer={
        <>
          <button className="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button onClick={save} disabled={busy || form.opportunityName.trim() === ''}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {error && <p className="error">{error}</p>}
      <div className="form-grid">
        <TextField label="Opportunity name" value={form.opportunityName} onChange={set('opportunityName')} required full />
        <TextField label="Account (customer)" value={form.customerName} onChange={set('customerName')} />
        <TextField label="TPID" value={form.tpid} onChange={set('tpid')} />
        <SelectField label="Solution area" value={form.solutionArea} onChange={set('solutionArea')} options={SOLUTION_AREAS} />
        <SelectField label="Sales stage" value={form.salesStage} onChange={set('salesStage')} options={SALES_STAGES} />
        <SelectField label="Status" value={form.status} onChange={set('status')} options={OPPORTUNITY_STATUSES} />
        <NumberField label="Estimated revenue" value={form.estimatedRevenue} onChange={set('estimatedRevenue')} />
        <DateField label="Estimated close date" value={form.closeDate} onChange={set('closeDate')} />
        <TextField label="Competitor" value={form.competitorName} onChange={set('competitorName')} />
        <TextField label="Industry" value={form.industry} onChange={set('industry')} />
        <TextField label="Consumption phase" value={form.consumptionPhase} onChange={set('consumptionPhase')} />
        <DateField label="Last updated" value={form.lastUpdated} onChange={set('lastUpdated')} />
        <TextField label="AE owner" value={form.aeOwner} onChange={set('aeOwner')} />
        <TextField label="Assigned SE" value={form.assignedSE} onChange={set('assignedSE')} />
        <TextAreaField label="Business problem" value={form.businessProblem} onChange={set('businessProblem')} full />
        <TextAreaField label="Next step" value={form.nextStep} onChange={set('nextStep')} full />
      </div>
    </Modal>
  );
}
