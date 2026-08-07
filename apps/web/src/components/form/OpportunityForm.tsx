import { useEffect, useState } from 'react';
import { SOLUTION_AREAS, SALES_STAGES, OPPORTUNITY_STATUSES, FORECAST_CATEGORIES } from '@msx/shared';
import { api, announceOpportunity, type Opportunity } from '../../api/client';
import Modal from '../Modal';
import OpportunityCreatedNotifyDialog from '../OpportunityCreatedNotifyDialog';
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
    forecastCategory: initial?.forecastCategory ?? '',
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
  // After a successful CREATE we show a consent modal offering to notify the team
  // via Teams; `created` holds the new opportunity while that modal is open.
  const [created, setCreated] = useState<Opportunity | null>(null);
  const [notifyBusy, setNotifyBusy] = useState(false);
  const [notifyError, setNotifyError] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  // On a NEW opportunity, TPID is assigned automatically by the server. Fetch a preview
  // of the next sequential number to show in the (read-only) field; the server still
  // owns the authoritative value at save time.
  useEffect(() => {
    if (editing) return;
    let cancelled = false;
    api
      .get<{ tpid: string }>('/opportunities/next-tpid')
      .then((r) => {
        if (!cancelled) setForm((f) => ({ ...f, tpid: r.tpid }));
      })
      .catch(() => {
        /* preview is best-effort; the server assigns the TPID regardless */
      });
    return () => {
      cancelled = true;
    };
  }, [editing]);

  async function save() {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      opportunityName: form.opportunityName.trim(),
      customerName: clean(form.customerName),
      // On create the server auto-assigns the next sequential TPID, so don't send the
      // previewed value (avoids the form dictating the number). On edit, keep it.
      tpid: editing ? clean(form.tpid) : undefined,
      solutionArea: clean(form.solutionArea),
      salesStage: clean(form.salesStage),
      status: clean(form.status),
      forecastCategory: clean(form.forecastCategory),
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
      if (editing && initial) {
        await api.patch(`/opportunities/${initial.id}`, body);
        onSaved();
        onClose();
      } else {
        const opp = await api.post<Opportunity>('/opportunities', body);
        onSaved(); // refresh the list behind the consent modal
        setCreated(opp); // show the "notify the team?" consent modal instead of closing
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Send the Teams visibility broadcast the user just consented to, then close. */
  async function notifyTeam() {
    if (!created) return;
    setNotifyBusy(true);
    setNotifyError(null);
    try {
      await announceOpportunity(created.id, true);
      onClose();
    } catch (e) {
      setNotifyError((e as Error).message);
    } finally {
      setNotifyBusy(false);
    }
  }

  // Consent step: opportunity is already saved; ask before notifying the team.
  if (created) {
    return (
      <OpportunityCreatedNotifyDialog
        opportunityName={created.opportunityName}
        busy={notifyBusy}
        error={notifyError}
        onSkip={onClose}
        onConfirm={notifyTeam}
      />
    );
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
        {editing ? (
          <TextField label="TPID" value={form.tpid} onChange={set('tpid')} />
        ) : (
          <TextField
            label="TPID"
            value={form.tpid}
            onChange={set('tpid')}
            readOnly
            placeholder="Auto-assigned on save"
            hint="Assigned automatically — the next available number."
          />
        )}
        <SelectField label="Solution area" value={form.solutionArea} onChange={set('solutionArea')} options={SOLUTION_AREAS} />
        <SelectField label="Sales stage" value={form.salesStage} onChange={set('salesStage')} options={SALES_STAGES} />
        <SelectField label="Status" value={form.status} onChange={set('status')} options={OPPORTUNITY_STATUSES} />
        <SelectField label="Forecast category" value={form.forecastCategory} onChange={set('forecastCategory')} options={FORECAST_CATEGORIES} />
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
