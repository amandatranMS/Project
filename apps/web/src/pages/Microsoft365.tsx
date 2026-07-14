import { useState } from 'react';
import { useMsal } from '@azure/msal-react';
import { graphConsentRequest } from '../auth/msalConfig';
import { api } from '../api/client';

/**
 * A small test surface for the real Microsoft Graph integration (Option B).
 * Everything here runs AS the signed-in user (on-behalf-of) — no agent, no
 * admin, no Copilot. Use it to verify reads and the send-as-you email before
 * wiring the Foundry hosted agent (Stage 3).
 */
export default function Microsoft365() {
  const { instance, accounts } = useMsal();
  const [output, setOutput] = useState('Run an action to see the result.');
  const [busy, setBusy] = useState(false);

  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const [teamsTo, setTeamsTo] = useState('');
  const [teamsMsg, setTeamsMsg] = useState('');

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    setOutput(`${label}…`);
    try {
      const data = await fn();
      setOutput(`${label} ✓\n\n${JSON.stringify(data, null, 2)}`);
    } catch (err) {
      setOutput(`${label} ✗\n\n${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const connect = () => {
    // Full-page redirect (not popup): reliable in embedded/popup-blocked
    // browsers. Returns to the app after consent; main.tsx handles the redirect.
    setOutput('Redirecting to Microsoft for consent…');
    void instance.acquireTokenRedirect({ ...graphConsentRequest, account: accounts[0] });
  };

  const sendEmail = (confirm: boolean) =>
    run(confirm ? 'Send email (as me)' : 'Preview email', () =>
      api.post('/graph/outlook/send', { to, subject, body, confirm }),
    );

  const notifyTeams = (confirm: boolean) =>
    run(confirm ? 'Send Teams notification' : 'Preview Teams notification', () =>
      api.post('/graph/teams/notify', {
        message: teamsMsg,
        to: teamsTo || undefined,
        confirm,
      }),
    );

  return (
    <div className="m365-page">
      <h2>Microsoft 365 (acts as you)</h2>
      <p className="muted">
        Real Microsoft Graph, on your behalf. Reads use your login; the org chart also
        needs a one-time admin consent. Sending is gated: Preview first, then Send. Email
        and Teams run in <strong>simulate</strong> mode by default (recorded &amp; audited,
        not delivered) — switch to live delivery later once an admin consents.
      </p>

      <section className="m365-section">
        <h3>1 · Consent</h3>
        <button className="btn" disabled={busy} onClick={connect}>
          Connect Microsoft 365
        </button>
      </section>

      <section className="m365-section">
        <h3>2 · Read</h3>
        <div className="m365-actions">
          <button className="btn" disabled={busy} onClick={() => run('My profile', () => api.get('/graph/me'))}>
            My profile
          </button>
          <button className="btn" disabled={busy} onClick={() => run('My hierarchy', () => api.get('/graph/hierarchy'))}>
            Manager & coworkers
          </button>
          <button className="btn" disabled={busy} onClick={() => run('My email', () => api.get('/graph/outlook/messages?top=5'))}>
            Recent email
          </button>
          <button className="btn" disabled={busy} onClick={() => run('My Teams chats', () => api.get('/graph/teams/chats?top=5'))}>
            Recent Teams chats
          </button>
        </div>
      </section>

      <section className="m365-section">
        <h3>3 · Send email (as you)</h3>
        <div className="m365-form">
          <input placeholder="To (email address)" value={to} onChange={(e) => setTo(e.target.value)} />
          <input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <textarea placeholder="Body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="m365-actions">
            <button className="btn" disabled={busy || !to || !subject || !body} onClick={() => sendEmail(false)}>
              Preview
            </button>
            <button className="btn btn-primary" disabled={busy || !to || !subject || !body} onClick={() => sendEmail(true)}>
              Send as me
            </button>
          </div>
        </div>
      </section>

      <section className="m365-section">
        <h3>4 · Notify a teammate on Teams</h3>
        <div className="m365-form">
          <input placeholder="To (email, optional)" value={teamsTo} onChange={(e) => setTeamsTo(e.target.value)} />
          <textarea placeholder="Message" rows={3} value={teamsMsg} onChange={(e) => setTeamsMsg(e.target.value)} />
          <div className="m365-actions">
            <button className="btn" disabled={busy || !teamsMsg} onClick={() => notifyTeams(false)}>
              Preview
            </button>
            <button className="btn btn-primary" disabled={busy || !teamsMsg} onClick={() => notifyTeams(true)}>
              Send notification
            </button>
          </div>
        </div>
      </section>

      <section className="m365-section">
        <h3>Result</h3>
        <pre className="m365-output">{output}</pre>
      </section>
    </div>
  );
}
