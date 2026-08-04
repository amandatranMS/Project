import Modal from './Modal';

interface Props {
  /** The just-created opportunity's display name. */
  opportunityName: string;
  busy?: boolean;
  /** Error from a failed send attempt, shown inline so the user can retry. */
  error?: string | null;
  /** Close without sending. */
  onSkip: () => void;
  /** Authorise and send the Teams visibility message. */
  onConfirm: () => void;
}

/**
 * Human-in-the-loop consent pop-up shown right after a user creates
 * an opportunity. Agreeing posts a Microsoft Teams message summarising the new
 * opportunity to the configured teammate, for visibility and collaboration.
 * Nothing is sent until the user acknowledges here.
 */
export default function OpportunityCreatedNotifyDialog({
  opportunityName,
  busy,
  error,
  onSkip,
  onConfirm,
}: Props) {
  return (
    <Modal
      title="Share this opportunity with the team?"
      onClose={onSkip}
      footer={
        <div className="btn-row">
          <button className="secondary" onClick={onSkip} disabled={busy}>
            Not now
          </button>
          <button onClick={onConfirm} disabled={busy}>
            {busy ? 'Sending…' : 'Send Teams message'}
          </button>
        </div>
      }
    >
      {error && <p className="error">{error}</p>}
      <p>
        This sends a Teams notification about <strong>{opportunityName}</strong> to all STU(s) /
        MCAPS users for better visibility, transparency, and collaboration.
      </p>
      <p className="muted">
        Nothing is sent unless you confirm here, and the send is recorded in the audit log.
      </p>
    </Modal>
  );
}
