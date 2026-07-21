import { useState } from 'react';
import { api, type DealTeamMember } from '../../api/client';
import Modal from '../Modal';
import { TextField, DateField, TextAreaField, BoolSelectField } from './Fields';

interface Props {
  initial?: DealTeamMember;
  /** Opportunity this member belongs to (required to create a new member). */
  opportunityName: string;
  onClose: () => void;
  onSaved: () => void;
}

const isoToDateInput = (v?: string | null) => (v ? new Date(v).toISOString().slice(0, 10) : '');
const clean = (v: string) => (v.trim() === '' ? undefined : v.trim());
const boolToInput = (v?: boolean | null) => (v == null ? '' : String(v));
const boolFrom = (v: string) => (v === '' ? undefined : v === 'true');

export default function DealTeamForm({ initial, opportunityName, onClose, onSaved }: Props) {
  const editing = Boolean(initial);
  const [form, setForm] = useState({
    personName: initial?.personName ?? '',
    role: initial?.role ?? '',
    teamArea: initial?.teamArea ?? '',
    addedDate: isoToDateInput(initial?.addedDate),
    active: boolToInput(initial?.active),
    handoffRequired: boolToInput(initial?.handoffRequired),
    handoffNotes: initial?.handoffNotes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      personName: form.personName.trim(),
      role: form.role.trim(),
      teamArea: clean(form.teamArea),
      addedDate: clean(form.addedDate),
      active: boolFrom(form.active),
      handoffRequired: boolFrom(form.handoffRequired),
      handoffNotes: clean(form.handoffNotes),
    };
    try {
      if (editing && initial) await api.patch(`/deal-team-members/${initial.id}`, body);
      else await api.post('/deal-team-members', { ...body, opportunityName });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const canSave = form.personName.trim() !== '' && form.role.trim() !== '';

  return (
    <Modal
      title={editing ? 'Edit deal team member' : 'Add deal team member'}
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
        <TextField label="Name" value={form.personName} onChange={set('personName')} required />
        <TextField label="Role" value={form.role} onChange={set('role')} required />
        <TextField label="Team area" value={form.teamArea} onChange={set('teamArea')} />
        <DateField label="Added date" value={form.addedDate} onChange={set('addedDate')} />
        <BoolSelectField label="Active" value={form.active} onChange={set('active')} />
        <BoolSelectField label="Handoff required" value={form.handoffRequired} onChange={set('handoffRequired')} />
        <TextAreaField label="Handoff notes" value={form.handoffNotes} onChange={set('handoffNotes')} full />
      </div>
    </Modal>
  );
}
