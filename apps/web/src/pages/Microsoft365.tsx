import { useState } from 'react';
import { useMsal } from '@azure/msal-react';
import { graphConsentRequest } from '../auth/msalConfig';
import { api } from '../api/client';

interface FormattedResult {
  headline: string;
  sections: Array<{ title?: string; items: string[] }>;
  raw: string;
}

function section(title: string | undefined, items: string[]): { title?: string; items: string[] } {
  return { title, items };
}

function toJson(data: unknown): string {
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

function fmtDate(value: unknown): string {
  if (typeof value !== 'string' || !value) return 'Unknown time';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function summarizeProfile(data: any): FormattedResult {
  if (!data || typeof data !== 'object') {
    return {
      headline: 'Profile loaded.',
      sections: [section('Summary', ['Profile details are available below.'])],
      raw: toJson(data),
    };
  }
  return {
    headline: `Signed in as ${data.displayName ?? 'Unknown user'}`,
    sections: [
      section('Profile', [
        `Email: ${data.mail ?? data.userPrincipalName ?? 'Unknown'}`,
        `Job title: ${data.jobTitle ?? 'Not set'}`,
        `Department: ${data.department ?? 'Not set'}`,
      ]),
    ],
    raw: toJson(data),
  };
}

function summarizeHierarchy(data: any): FormattedResult {
  if (!data || typeof data !== 'object') {
    return {
      headline: 'Hierarchy loaded.',
      sections: [section('Summary', ['Hierarchy details are available below.'])],
      raw: toJson(data),
    };
  }
  const manager = data.manager?.displayName ?? 'None';
  const reports = Array.isArray(data.directReports) ? data.directReports : [];
  const colleagues = Array.isArray(data.colleagues) ? data.colleagues : [];

  const reportLines = reports.slice(0, 8).map((p: any) => `- ${p.displayName ?? 'Unknown'} (${p.jobTitle ?? 'No title'})`);
  const colleagueLines = colleagues.slice(0, 8).map((p: any) => `- ${p.displayName ?? 'Unknown'} (${p.jobTitle ?? 'No title'})`);

  return {
    headline: `Manager: ${manager}`,
    sections: [
      section('Counts', [`Direct reports: ${reports.length}`, `Colleagues: ${colleagues.length}`]),
      ...(reportLines.length ? [section('Top direct reports', reportLines)] : []),
      ...(colleagueLines.length ? [section('Top colleagues', colleagueLines)] : []),
    ],
    raw: toJson(data),
  };
}

function summarizeMessages(data: any): FormattedResult {
  if (!Array.isArray(data)) {
    return {
      headline: 'Recent email loaded.',
      sections: [section('Summary', ['Email details are available below.'])],
      raw: toJson(data),
    };
  }
  if (data.length === 0) {
    return {
      headline: 'No recent email found.',
      sections: [section('Summary', ['Your mailbox query returned no messages.'])],
      raw: toJson(data),
    };
  }
  const rows = data.map((m: any, i: number) => {
    const from = m?.from?.emailAddress?.name ?? m?.from?.emailAddress?.address ?? 'Unknown sender';
    return `${i + 1}. ${m?.subject ?? '(No subject)'} | From: ${from} | Received: ${fmtDate(m?.receivedDateTime)} | Preview: ${(m?.bodyPreview ?? '').toString().trim() || 'No preview'}`;
  });
  return {
    headline: `Recent email (${data.length})`,
    sections: [section('Messages', rows)],
    raw: toJson(data),
  };
}

function summarizeChats(data: any): FormattedResult {
  if (!Array.isArray(data)) {
    return {
      headline: 'Recent Teams chats loaded.',
      sections: [section('Summary', ['Teams chat details are available below.'])],
      raw: toJson(data),
    };
  }
  if (data.length === 0) {
    return {
      headline: 'No recent Teams chats found.',
      sections: [section('Summary', ['No chats matched this query.'])],
      raw: toJson(data),
    };
  }
  const rows = data.map((c: any, i: number) => {
    const topic = c?.topic || '(No topic)';
    const type = c?.chatType || 'unknown';
    const updated = fmtDate(c?.lastUpdatedDateTime);
    return `${i + 1}. ${topic} [${type}] | Last updated: ${updated}`;
  });
  return {
    headline: `Recent Teams chats (${data.length})`,
    sections: [section('Chats', rows)],
    raw: toJson(data),
  };
}

function summarizeDelivery(data: any, channel: 'email' | 'teams'): FormattedResult {
  if (!data || typeof data !== 'object') {
    return {
      headline: `${channel === 'email' ? 'Email' : 'Teams notification'} processed.`,
      sections: [section('Summary', ['Details are available below.'])],
      raw: toJson(data),
    };
  }
  if (data.requiresConfirmation) {
    return {
      headline: `${channel === 'email' ? 'Email' : 'Teams notification'} preview ready.`,
      sections: [
        section('Preview details', [
          `Mode: ${data.mode ?? 'unknown'}`,
          `Recipient: ${data.preview?.to ?? '(self)'}`,
          ...(channel === 'email' ? [`Subject: ${data.preview?.subject ?? '(no subject)'}`] : []),
          `${channel === 'email' ? 'Body' : 'Message'}: ${data.preview?.body ?? data.preview?.message ?? ''}`,
        ]),
        section('Next step', ['Nothing was sent yet. Use the Send button when ready.']),
      ],
      raw: toJson(data),
    };
  }

  const simulated = Boolean(data.simulated);
  return {
    headline: `${channel === 'email' ? 'Email' : 'Teams notification'} ${data.sent ? 'processed' : 'not sent'}.`,
    sections: [
      section('Delivery details', [
        `Mode: ${simulated ? 'simulate (recorded only)' : 'live (delivered)'}`,
        `Recipient: ${data.to ?? '(self)'}`,
        ...(data.subject ? [`Subject: ${data.subject}`] : []),
        ...(data.note ? [`Note: ${data.note}`] : []),
      ]),
    ],
    raw: toJson(data),
  };
}

function formatResult(label: string, data: unknown): FormattedResult {
  if (label === 'My profile') return summarizeProfile(data);
  if (label === 'My hierarchy') return summarizeHierarchy(data);
  if (label === 'My email') return summarizeMessages(data);
  if (label === 'My Teams chats') return summarizeChats(data);
  if (label.includes('email')) return summarizeDelivery(data, 'email');
  if (label.includes('Teams')) return summarizeDelivery(data, 'teams');
  return {
    headline: `${label} completed.`,
    sections: [section('Summary', ['Details are available below.'])],
    raw: toJson(data),
  };
}

/**
 * A small test surface for the real Microsoft Graph integration (Option B).
 * Everything here runs AS the signed-in user (on-behalf-of) — no agent, no
 * admin, no Copilot. Use it to verify reads and the send-as-you email before
 * wiring the Foundry hosted agent (Stage 3).
 */
export default function Microsoft365() {
  const { instance, accounts } = useMsal();
  const [result, setResult] = useState<FormattedResult>({
    headline: 'Run an action to see the result.',
    sections: [section('How to start', ['Use Connect first, then choose a read or send action.'])],
    raw: '',
  });
  const [resultTone, setResultTone] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [busy, setBusy] = useState(false);

  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const [teamsTo, setTeamsTo] = useState('');
  const [teamsMsg, setTeamsMsg] = useState('');

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    setResultTone('loading');
    setResult({
      headline: `${label} in progress…`,
      sections: [section('Working', ['Please wait while we call Microsoft Graph.'])],
      raw: '',
    });
    try {
      const data = await fn();
      setResult(formatResult(label, data));
      setResultTone('success');
    } catch (err) {
      setResult({
        headline: `${label} failed.`,
        sections: [section('Error details', [err instanceof Error ? err.message : String(err)])],
        raw: '',
      });
      setResultTone('error');
    } finally {
      setBusy(false);
    }
  };

  const connect = () => {
    // Full-page redirect (not popup): reliable in embedded/popup-blocked
    // browsers. Returns to the app after consent; main.tsx handles the redirect.
    setResultTone('loading');
    setResult({
      headline: 'Redirecting to Microsoft for consent…',
      sections: [section('Next step', ['You will return to this page automatically after sign-in.'])],
      raw: '',
    });
    void instance.acquireTokenRedirect({ ...graphConsentRequest, account: accounts[0] });
  };

  const useEmailTemplate = () => {
    setSubject('Follow-up on milestone approval');
    setBody('Hi team,\n\nQuick update: the milestone is ready for your review. Please take a look and share feedback.\n\nThanks.');
  };

  const useTeamsTemplate = () => {
    setTeamsMsg('Quick reminder: please review the latest milestone update and add comments by end of day. Thanks.');
  };

  async function copySummary() {
    const text = [
      result.headline,
      ...result.sections.flatMap((s) => [s.title ? `${s.title}:` : '', ...s.items].filter(Boolean)),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setResultTone('success');
    } catch {
      // Clipboard can be blocked by browser permissions.
    }
  }

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
    <div className="m365-page stack">
      <div className="page-header">
        <h1>Microsoft 365</h1>
        <span className="badge blue">Acts as signed-in user</span>
      </div>

      <p className="m365-intro muted">
        Real Microsoft Graph, on your behalf. Reads use your login; the org chart also
        needs a one-time admin consent. Sending is gated: Preview first, then Send. Email
        and Teams run in <strong>simulate</strong> mode by default (recorded &amp; audited,
        not delivered) — switch to live delivery later once an admin consents.
      </p>

      <section className="card m365-section">
        <h3>1 · Consent</h3>
        <button className="btn" disabled={busy} onClick={connect}>
          Connect Microsoft 365
        </button>
      </section>

      <section className="card m365-section">
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

      <section className="card m365-section">
        <h3>3 · Send email (as you)</h3>
        <p className="muted m365-help">Tip: Start with Preview to confirm wording, then click Send as me.</p>
        <div className="m365-form">
          <input placeholder="To (email address)" value={to} onChange={(e) => setTo(e.target.value)} />
          <input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <textarea placeholder="Body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="m365-actions">
            <button className="btn secondary" type="button" disabled={busy} onClick={useEmailTemplate}>
              Use template
            </button>
            <button className="btn" disabled={busy || !to || !subject || !body} onClick={() => sendEmail(false)}>
              Preview
            </button>
            <button className="btn btn-primary" disabled={busy || !to || !subject || !body} onClick={() => sendEmail(true)}>
              Send as me
            </button>
          </div>
        </div>
      </section>

      <section className="card m365-section">
        <h3>4 · Notify a teammate on Teams</h3>
        <p className="muted m365-help">Tip: Add recipient email only when you want a targeted notification.</p>
        <div className="m365-form">
          <input placeholder="To (email, optional)" value={teamsTo} onChange={(e) => setTeamsTo(e.target.value)} />
          <textarea placeholder="Message" rows={3} value={teamsMsg} onChange={(e) => setTeamsMsg(e.target.value)} />
          <div className="m365-actions">
            <button className="btn secondary" type="button" disabled={busy} onClick={useTeamsTemplate}>
              Use template
            </button>
            <button className="btn" disabled={busy || !teamsMsg} onClick={() => notifyTeams(false)}>
              Preview
            </button>
            <button className="btn btn-primary" disabled={busy || !teamsMsg} onClick={() => notifyTeams(true)}>
              Send notification
            </button>
          </div>
        </div>
      </section>

      <section className="card m365-section">
        <div className="spread m365-result-head">
          <h3>Result</h3>
          <div className="m365-result-actions">
            <span
              className={`badge ${
                resultTone === 'success' ? 'green' : resultTone === 'error' ? 'red' : resultTone === 'loading' ? 'blue' : 'gray'
              }`}
            >
              {resultTone === 'success' ? 'Success' : resultTone === 'error' ? 'Failed' : resultTone === 'loading' ? 'Running' : 'Ready'}
            </span>
            <button className="btn secondary" type="button" onClick={copySummary} disabled={busy}>
              Copy summary
            </button>
          </div>
        </div>
        <div className="m365-output" role="status" aria-live="polite">
          <p className="m365-output-headline">{result.headline}</p>
          {result.sections.map((s, i) => (
            <section key={`${s.title ?? 'section'}-${i}`} className="m365-output-section">
              {s.title && <p className="m365-output-section-title">{s.title}</p>}
              <ul className="m365-output-list">
                {s.items.map((item, j) => (
                  <li key={`${item}-${j}`}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
          {result.raw && (
            <details className="m365-raw">
              <summary>Show technical details</summary>
              <pre>{result.raw}</pre>
            </details>
          )}
        </div>
      </section>
    </div>
  );
}
