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
 * Human-in-the-loop consent pop-up shown right after a Solution Engineer creates
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
        A Microsoft Teams message summarising <strong>{opportunityName}</strong> will be sent to the
        team for visibility, so other Solution Engineers can collaborate on it.
      </p>
      <p className="muted">
        The message content is built from this opportunity’s data and the send is recorded in the
        audit log. This is the confirmation that authorises it — nothing is sent unless you agree.
      </p>
    </Modal>
  );
}
