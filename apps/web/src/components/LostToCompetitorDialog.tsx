import { useState } from 'react';
import Modal from './Modal';

interface Props {
  /** Manager display name / email, when resolved from Entra; falls back to generic copy. */
  managerName?: string | null;
  /**
   * When true, the milestone has no competitor yet — one MUST be entered here
   * before the change can proceed. `onConfirm` receives the entered value.
   */
  requireCompetitor?: boolean;
  /**
   * Whether confirming triggers the executive-summary email to the seller's
   * manager (a real transition INTO "Lost To Competitor"). Controls the copy and
   * the confirm-button label. Defaults to true (the manager-notify use case).
   */
  notifyManager?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (competitorName?: string) => void;
}

/**
 * Human-in-the-loop pop-up shown before a milestone is moved to
 * "Lost To Competitor". Two jobs, either or both of which can apply:
 *  - Require the competitor name when the milestone doesn't have one yet
 *    (`requireCompetitor`) — the field must be filled before confirming.
 *  - Acknowledge that an executive-summary email will be sent to the seller's
 *    manager (resolved from Microsoft Entra) when this is a real transition
 *    (`notifyManager`).
 */
export default function LostToCompetitorDialog({
  managerName,
  requireCompetitor = false,
  notifyManager = true,
  busy,
  onCancel,
  onConfirm,
}: Props) {
  const [competitor, setCompetitor] = useState('');
  const recipient = managerName?.trim() ? managerName.trim() : 'your manager';
  const competitorMissing = requireCompetitor && competitor.trim() === '';

  const confirm = () => {
    if (competitorMissing || busy) return;
    onConfirm(requireCompetitor ? competitor.trim() : undefined);
  };

  const confirmLabel = notifyManager
    ? busy
      ? 'Sending…'
      : 'Acknowledge & send email'
    : busy
      ? 'Saving…'
      : 'Save competitor & continue';

  return (
    <Modal
      title={requireCompetitor && !notifyManager ? 'Competitor required' : 'Notify manager of competitive loss'}
      onClose={onCancel}
      footer={
        <div className="btn-row">
          <button className="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="danger" onClick={confirm} disabled={busy || competitorMissing}>
            {confirmLabel}
          </button>
        </div>
      }
    >
      <p>
        Marking this milestone <strong>“Lost To Competitor”</strong>
        {notifyManager ? ' will notify your manager of the competitive loss.' : '.'}
      </p>
      {requireCompetitor && (
        <>
          <p className="muted">
            A competitor is required for this status. Enter which competitor the deal was lost to.
          </p>
          <div className="form-field full">
            <label>
              Competitor <span className="req">*</span>
            </label>
            <input
              autoFocus
              value={competitor}
              placeholder="e.g. Google, AWS, Salesforce…"
              onChange={(e) => setCompetitor(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirm();
              }}
            />
          </div>
        </>
      )}
      {notifyManager && (
        <p className="muted">
          An executive-summary email will be sent to <strong>{recipient}</strong> (the manager is
          resolved from Microsoft Entra; the content is built from this mock opportunity’s data and
          recorded in the audit log). Nothing is sent until you acknowledge.
        </p>
      )}
    </Modal>
  );
}
