import Modal from './Modal';

interface Props {
  /** The approval request's descriptive title (names the Teams recipient). */
  requestName?: string | null;
  /** Opportunity the broadcast is about, when known. */
  opportunityName?: string | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Human-in-the-loop pop-up shown in the Approvals tab before approving an
 * agent-submitted "notify the team of a new opportunity" request. Approving posts
 * the Microsoft Teams message to the configured teammate. Confirming here is the
 * explicit acknowledgement that authorises that send — nothing goes out until
 * a human approves.
 */
export default function ApproveTeamsBroadcastDialog({
  requestName,
  opportunityName,
  busy,
  onCancel,
  onConfirm,
}: Props) {
  return (
    <Modal
      title="Post this opportunity to Teams?"
      onClose={onCancel}
      footer={
        <div className="btn-row">
          <button className="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={busy}>
            {busy ? 'Sending…' : 'Approve & post to Teams'}
          </button>
        </div>
      }
    >
      <p>
        Approving this request will post a Microsoft Teams message
        {opportunityName ? (
          <>
            {' '}
            about <strong>{opportunityName}</strong>
          </>
        ) : null}{' '}
        for team visibility.
      </p>
      {requestName && <p className="muted">{requestName}</p>}
      <p className="muted">
        The message was drafted by the agent from this opportunity’s data and is recorded in the
        audit log. This confirmation is the human-in-the-loop gate — the agent never sends on its
        own.
      </p>
    </Modal>
  );
}
