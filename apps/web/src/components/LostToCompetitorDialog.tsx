import Modal from './Modal';

interface Props {
  /** Manager display name / email, when resolved from Entra; falls back to generic copy. */
  managerName?: string | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Human-in-the-loop pop-up shown before a milestone is moved to
 * "Lost To Competitor". Marking the loss sends an executive-summary email to
 * the seller's manager (resolved from Microsoft Entra). Confirming here is the
 * explicit acknowledgement that authorises that send.
 */
export default function LostToCompetitorDialog({ managerName, busy, onCancel, onConfirm }: Props) {
  const recipient = managerName?.trim() ? managerName.trim() : 'your manager';
  return (
    <Modal
      title="Notify manager of competitive loss"
      onClose={onCancel}
      footer={
        <div className="btn-row">
          <button className="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Sending…' : 'Acknowledge & send email'}
          </button>
        </div>
      }
    >
      <p>
        Marking this milestone <strong>“Lost To Competitor”</strong> will send an executive-summary
        email to <strong>{recipient}</strong> describing the situation.
      </p>
      <p className="muted">
        The manager is resolved from Microsoft Entra; the email content is built from this mock
        opportunity’s data. The send is recorded in the audit log. This is the confirmation that
        authorises the email — nothing is sent until you acknowledge.
      </p>
    </Modal>
  );
}
