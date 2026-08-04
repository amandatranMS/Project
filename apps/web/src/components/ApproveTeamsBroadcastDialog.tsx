import Modal from './Modal';

interface Props {
  /** The approval request's descriptive title (names the Teams recipient). */
  requestName?: string | null;
  /** Opportunity the broadcast is about, when known. */
  opportunityName?: string | null;
  /**
   * When true, approving also CREATES the opportunity (the Teams post is a side
   * effect folded into a single CreateOpportunity approval). When false, the
   * approval only posts the Teams message (the opportunity already exists).
   */
  alsoCreatesOpportunity?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  /**
   * Approve WITHOUT posting to Teams. Only meaningful for a CreateOpportunity request
   * (`alsoCreatesOpportunity`): the opportunity is still created, but no Teams message
   * is posted. When omitted, only the standard cancel/approve actions are shown.
   */
  onConfirmWithoutBroadcast?: () => void;
}

/**
 * Human-in-the-loop pop-up shown in the Approvals tab before approving a request that
 * posts a "new opportunity" visibility message to Microsoft Teams. Two shapes:
 *  - a standalone NotifyTeams request (the opportunity already exists), or
 *  - a CreateOpportunity request, where approving creates the opportunity AND posts
 *    the Teams message in one step (`alsoCreatesOpportunity`).
 * Confirming here is the explicit acknowledgement that authorises the send — nothing
 * goes out until a human approves.
 */
export default function ApproveTeamsBroadcastDialog({
  requestName,
  opportunityName,
  alsoCreatesOpportunity,
  busy,
  onCancel,
  onConfirm,
  onConfirmWithoutBroadcast,
}: Props) {
  const showSkip = alsoCreatesOpportunity && !!onConfirmWithoutBroadcast;
  return (
    <Modal
      title={alsoCreatesOpportunity ? 'Create opportunity and post to Teams?' : 'Post this opportunity to Teams?'}
      onClose={onCancel}
      footer={
        <div className="btn-row">
          <button className="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          {showSkip && (
            <button className="secondary" onClick={onConfirmWithoutBroadcast} disabled={busy}>
              {busy ? 'Creating…' : 'Create without posting'}
            </button>
          )}
          <button onClick={onConfirm} disabled={busy}>
            {busy
              ? (alsoCreatesOpportunity ? 'Creating…' : 'Sending…')
              : (alsoCreatesOpportunity ? 'Approve & create' : 'Approve & post to Teams')}
          </button>
        </div>
      }
    >
      <p>
        {alsoCreatesOpportunity ? 'Approving this request will create the opportunity' : 'Approving this request will send a Teams notification'}
        {opportunityName ? (
          <>
            {' '}
            {alsoCreatesOpportunity ? '' : 'about '}<strong>{opportunityName}</strong>
          </>
        ) : null}
        {alsoCreatesOpportunity
          ? ' and send a Teams notification to all STU(s) / MCAPS users for better visibility, transparency, and collaboration.'
          : ' to all STU(s) / MCAPS users for better visibility, transparency, and collaboration.'}
      </p>
      {requestName && <p className="muted">{requestName}</p>}
      {showSkip && (
        <p className="muted">
          Choose <strong>Create without posting</strong> to create the opportunity without notifying
          STU(s) / MCAPS users.
        </p>
      )}
      <p className="muted">
        Sent from your signed-in Microsoft account and recorded in the audit log. This confirmation is
        the human-in-the-loop gate — the agent never sends on its own.
      </p>
    </Modal>
  );
}
