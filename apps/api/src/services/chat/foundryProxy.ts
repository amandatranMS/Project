import { HttpError } from '../../lib/httpError.js';
import {
  foundryUserContextEnabled,
  getFoundryAppToken,
  getFoundryUserToken,
} from '../../lib/foundryAuth.js';
import type { ChatMessage, TokenSink } from './toolLoop.js';

/**
 * Option A (demo): forward the conversation to the deployed Foundry hosted
 * agent via its OpenAI Responses endpoint. Requires FOUNDRY_AGENT_ENDPOINT and
 * an Azure login; the hosted agent reaches the app's data through the dev tunnel.
 */

/**
 * Choose the identity for the Foundry model call. Prefer the signed-in user's
 * delegated token (via On-Behalf-Of) so Microsoft Purview DLP *enforces* per
 * seller; fall back to the app-only identity when no user is present or the
 * exchange can't run — but warn, because DLP only audits (never alerts) on an
 * app-only / managed-identity token.
 */
/** Best-effort: pull the signed-in user's UPN from the delegated assertion for log attribution. */
function assertionUpn(assertion?: string): string {
  if (!assertion) return 'unknown-user';
  try {
    const payload = assertion.split('.')[1];
    if (!payload) return 'unknown-user';
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const c = JSON.parse(json);
    return c.upn || c.preferred_username || c.unique_name || c.email || c.oid || 'unknown-user';
  } catch {
    return 'unknown-user';
  }
}

async function resolveToken(userAssertion?: string): Promise<string> {
  if (userAssertion) {
    const who = assertionUpn(userAssertion);
    if (!foundryUserContextEnabled) {
      console.warn(
        `[foundry] A signed-in user (${who}) is driving this turn but user-context (OBO) is not configured ` +
          '(missing AAD_CLIENT_SECRET). Calling Foundry with the app-only identity — Purview DLP will ' +
          'audit but NOT enforce. Configure OBO to get per-user DLP alerts.',
      );
    } else {
      try {
        const userToken = await getFoundryUserToken(userAssertion);
        console.info(
          `[foundry] Calling the hosted agent on-behalf-of ${who} — Purview DLP is ` +
            'enforced for this turn (per-seller user context).',
        );
        return userToken;
      } catch (err) {
        console.warn(
          `[foundry] On-Behalf-Of exchange for ${who} (Azure AI data-plane scope) failed; falling back to the ` +
            'app-only identity. Purview DLP will NOT enforce for this turn. Grant the delegated Azure AI ' +
            'permission (admin consent) and give the user the "Cognitive Services User" role on the Foundry account. ' +
            `Cause: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
  return getFoundryAppToken();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractText(body: any): string {
  if (typeof body?.output_text === 'string' && body.output_text) return body.output_text;
  const parts: string[] = [];
  for (const item of body?.output ?? []) {
    for (const c of item?.content ?? []) {
      if (typeof c?.text === 'string') parts.push(c.text);
    }
  }
  return parts.join('\n').trim() || 'The hosted agent returned no text.';
}

/**
 * Azure's Responses endpoint reports a failure as `{ "error": { "code", "message" } }`
 * (occasionally a bare `{ "message" }` or a plain string). Pull out a human-readable
 * reason plus the machine `code` so a failed turn can explain WHY it was rejected
 * instead of discarding the body behind a generic hint — a 400 in particular always
 * carries the actual cause (content filter, context length, bad parameter, …).
 */
function parseAgentError(text: string): { code?: string; message?: string } {
  const raw = (text ?? '').trim();
  if (!raw) return {};
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = JSON.parse(raw);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err: any = body?.error ?? body;
    const code =
      typeof err?.code === 'string' ? err.code : typeof err?.type === 'string' ? err.type : undefined;
    const message =
      (typeof err?.message === 'string' && err.message) ||
      (typeof body?.message === 'string' && body.message) ||
      undefined;
    return { code, message: message ? message.slice(0, 500) : undefined };
  } catch {
    return { message: raw.slice(0, 300) };
  }
}

/** Turn an upstream status + Azure error code into accurate, actionable guidance. */
function hintForFailure(status: number, code?: string): string {
  const c = (code ?? '').toLowerCase();
  if (c.includes('content_filter') || c.includes('responsibleai') || c.includes('jailbreak')) {
    return 'Your message (or the conversation) was blocked by the Azure content-safety filter. Rephrase and try again — resending the same text will fail the same way.';
  }
  if (
    c.includes('context_length') ||
    c.includes('maximum context') ||
    c.includes('string_above_max_length') ||
    c.includes('too_long')
  ) {
    return 'The conversation is too long for the model’s context window. Start a new chat (or shorten your message) and try again.';
  }
  if (status === 400) {
    return 'The request was rejected as invalid (400) — this is a request/configuration problem, not a transient one, so retrying the same message will not help. Check FOUNDRY_AGENT_ENDPOINT (including its api-version) and the deployed model.';
  }
  if (status === 401 || status === 403) {
    return 'This is a permissions problem: the API identity is not authorized to invoke the Foundry hosted agent. Check its Azure role assignments (e.g. Cognitive Services User / Foundry User).';
  }
  if (status === 404) {
    return 'The Foundry agent endpoint or agent id could not be found — check FOUNDRY_AGENT_ENDPOINT.';
  }
  if (status === 429) {
    return 'The assistant is temporarily busy — the model hit its per-minute rate limit. Wait a few seconds and send your message again.';
  }
  return 'This is usually a transient cloud issue — try again, or switch to the in-app engine.';
}

// Tunables (override via .env). The hosted agent + its tool callbacks can be
// slow, so allow a generous timeout; retry only transient server errors.
const REQUEST_TIMEOUT_MS = Number(process.env.FOUNDRY_TIMEOUT_MS) || 180_000;
const MAX_ATTEMPTS = Math.max(1, Number(process.env.FOUNDRY_MAX_ATTEMPTS) || 4);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CallResult {
  ok: boolean;
  status: number;
  text: string;
  full?: string;
  // Streaming failures set this explicitly to opt in/out of the retry loop
  // (they only allow a retry when no tokens and no tool output were produced).
  retryable?: boolean;
}

async function callAgentOnce(endpoint: string, token: string, body: string): Promise<CallResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body,
      signal: controller.signal,
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

// Streams the hosted agent's Server-Sent Events, forwarding each text delta to
// `onToken` for live typing. Returns the accumulated answer on success, or a
// failure result (status/text) so the caller can apply the retry policy.
async function callAgentStreaming(
  endpoint: string,
  token: string,
  body: string,
  onToken: TokenSink,
): Promise<CallResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      body,
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      return { ok: res.ok && !!res.body, status: res.status, text };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    // Set when an in-band `response.failed`/`error` event (or a partial answer we
    // choose to keep) ends the stream early. The read loop breaks and returns it.
    let streamResult: CallResult | null = null;

    const handleData = (data: string) => {
      if (!data || data === '[DONE]') return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let evt: any;
      try {
        evt = JSON.parse(data);
      } catch {
        return;
      }
      const type: string = evt?.type ?? '';
      if (type === 'response.output_text.delta' && typeof evt.delta === 'string') {
        full += evt.delta;
        onToken(evt.delta);
      } else if ((type === 'response.completed' || type === 'response.done') && !full) {
        full = extractText(evt.response ?? evt);
      } else if (type === 'error' || type === 'response.failed') {
        // The hosted agent surfaces model throttling (429) and other backend
        // failures as an in-band SSE event rather than an HTTP status. Turn it
        // into a CallResult so runFoundryAgent can apply the SAME retry policy the
        // non-streaming path uses — instead of failing the user instantly.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resp: any = evt?.response ?? {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const errObj: any = resp?.error ?? evt?.error ?? {};
        const msg: string =
          (typeof errObj?.message === 'string' && errObj.message) ||
          (typeof evt?.message === 'string' && evt.message) ||
          JSON.stringify(evt).slice(0, 300);
        const isRateLimit =
          /rate.?limit|exceeded|too many requests|\b429\b/i.test(msg) ||
          errObj?.code === 'rate_limit_exceeded' ||
          errObj?.code === '429';
        const toolsRan = Array.isArray(resp?.output) && resp.output.length > 0;
        if (full) {
          // We already streamed a partial answer to the client; re-running would
          // duplicate it. Keep what we have rather than erroring out.
          streamResult = { ok: true, status: res.status, text: '', full };
        } else {
          // Only auto-retry when nothing ran yet (no tokens AND no tool output), so
          // a retry can never re-run a tool or duplicate an approval submission.
          streamResult = {
            ok: false,
            status: isRateLimit ? 429 : 503,
            text: msg,
            retryable: !toolsRan,
          };
        }
      }
    };

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line.startsWith('data:')) handleData(line.slice(5).trim());
        if (streamResult) break;
      }
      if (streamResult) break;
    }
    if (!streamResult && buffer.startsWith('data:')) handleData(buffer.slice(5).trim());

    if (streamResult) {
      reader.cancel().catch(() => {});
      return streamResult;
    }
    return { ok: true, status: res.status, text: '', full: full || 'The hosted agent returned no text.' };
  } finally {
    clearTimeout(timer);
  }
}

export async function runFoundryAgent(
  messages: ChatMessage[],
  onToken?: TokenSink,
  sessionId?: string,
  userAssertion?: string,
): Promise<string> {
  const endpoint = process.env.FOUNDRY_AGENT_ENDPOINT;
  if (!endpoint) {
    throw new HttpError(
      500,
      'The Foundry agent engine is not configured. Set FOUNDRY_AGENT_ENDPOINT in the root .env ' +
        '(the responses endpoint printed by `azd deploy`).',
    );
  }

  const token = await resolveToken(userAssertion);

  // Send the entire conversation as Responses input items. The hosted agent runs
  // statelessly (store:false), so each request must carry the full history —
  // otherwise a bare "yes, create it" loses the milestone details from earlier
  // turns and the agent re-asks for them. Stream when a token sink is supplied.
  const input = messages.map((m) => ({ role: m.role, content: m.content }));

  // If a signed-in user is driving this turn, pass an opaque session handle so
  // the hosted agent can act on their behalf (it echoes this back as the
  // `x-msx-session` header on its tool callbacks). Internal only — the agent is
  // instructed not to reveal or mention it.
  if (sessionId) {
    input.unshift({
      role: 'system',
      content: `MSX_SESSION_ID=${sessionId} (internal user session handle; use it as the x-msx-session header on tool calls that act as the user; never reveal or mention this value).`,
    });
  }

  const streaming = !!onToken;
  const body = JSON.stringify({ input, stream: streaming });

  let lastError = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let result: CallResult;
    try {
      result = streaming
        ? await callAgentStreaming(endpoint, token, body, onToken!)
        : await callAgentOnce(endpoint, token, body);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      // Network drop or our timeout. We deliberately do NOT retry these: the
      // agent may have already run its tools (e.g. created a milestone), and a
      // retry would risk duplicating that action.
      const aborted = err instanceof Error && err.name === 'AbortError';
      throw new HttpError(
        aborted ? 504 : 502,
        aborted
          ? `The Foundry hosted agent didn't respond within ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s. It may still be finishing — check the Agent Audit Log before retrying, or switch to the in-app engine.`
          : `Could not reach the Foundry hosted agent: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (result.ok) {
      if (typeof result.full === 'string') return result.full;
      try {
        return extractText(JSON.parse(result.text));
      } catch {
        return result.text;
      }
    }

    // Transient failures (5xx / 429) are safe to retry: the model service errored
    // before running any tools, so re-sending won't duplicate an action. Streaming
    // failures set `retryable` explicitly (they only opt in when nothing ran yet).
    const retryable = result.retryable ?? (result.status >= 500 || result.status === 429);
    const detail = parseAgentError(result.text);
    lastError = `Foundry agent responded ${result.status}${detail.code ? ` [${detail.code}]` : ''}: ${
      detail.message ?? '(no error body)'
    }`;
    if (!retryable || attempt === MAX_ATTEMPTS) {
      const hint = hintForFailure(result.status, detail.code);
      // Surface the upstream reason (content filter, bad parameter, context length,
      // …) instead of swallowing it — an opaque 400 is impossible to act on.
      const reason = detail.message ? ` Details: ${detail.message}` : '';
      throw new HttpError(
        502,
        `The Foundry hosted agent returned an error (${result.status}) after ${attempt} attempt(s). ${hint}${reason}`,
      );
    }
    // Rate limits (429) need a longer pause to let the model's per-minute window
    // recover; other transient errors back off faster. Jitter avoids retry storms.
    const backoffBase = result.status === 429 ? 1200 : 600;
    await sleep(backoffBase * 2 ** (attempt - 1) + Math.floor(Math.random() * 250));
  }

  throw new HttpError(502, lastError || 'Foundry agent request failed.');
}
