import { DefaultAzureCredential } from '@azure/identity';

/**
 * Surface agent-UI jailbreak / prompt-injection attempts in Microsoft Defender.
 *
 * Defender for Cloud's "AI threat protection" raises its jailbreak alert from the
 * SYNCHRONOUS content-filter block (HTTP 400) that Azure OpenAI's chat/completions
 * returns when Prompt Shields flags a prompt. The Foundry hosted agent reaches the
 * model through the streaming Responses API, where a block comes back as an in-band
 * `response.failed` event (HTTP 200) — so Defender never sees the 400 and no alert
 * fires, even though the prompt IS blocked and the user sees a refusal.
 *
 * To close that gap we mirror each user turn to the SAME model deployment with a
 * tiny, synchronous chat/completions "screening" call. A malicious prompt trips the
 * input filter (400 content_filter) → Defender alert + email; a benign prompt returns
 * 200 and nothing happens. The call is fire-and-forget: its result is irrelevant (the
 * content-safety evaluation Defender ingests happens regardless of whether we read the
 * body) and it must never add latency to, or throw into, the chat turn.
 */

// AAD scopes for the model data-plane (the account has local auth disabled).
const SCOPES = ['https://cognitiveservices.azure.com/.default', 'https://ai.azure.com/.default'];
const credential = new DefaultAzureCredential();

// Read configuration at CALL TIME, not module load. Capturing these into module-level
// constants at import time is fragile: if this module is evaluated before dotenv has
// populated process.env — or the process started before `.env` was finished being
// written — the shim silently disables itself (enabled=false) with no way to tell, and
// no amount of prompting produces a Defender alert. Reading per-call is cheap and immune
// to import order.
function readConfig() {
  const endpoint = process.env.DEFENDER_SCREEN_ENDPOINT?.trim();
  // Enabled only when an endpoint is configured and it isn't explicitly turned off.
  const enabled = !!endpoint && process.env.DEFENDER_SCREEN_ENABLED !== 'false';
  const timeoutMs = Number(process.env.DEFENDER_SCREEN_TIMEOUT_MS) || 15_000;
  const maxChars = Number(process.env.DEFENDER_SCREEN_MAX_CHARS) || 8_000;
  return { endpoint, enabled, timeoutMs, maxChars };
}

// Best-effort visibility. The screening call is deliberately fire-and-forget, but a
// silent no-op is precisely why a missing Defender alert is impossible to diagnose. We
// announce the effective state ONCE (always), and log per-call detail when
// DEFENDER_SCREEN_DEBUG=true.
let announced = false;
function debug(...args: unknown[]): void {
  if (process.env.DEFENDER_SCREEN_DEBUG === 'true') console.log('[defender-screen]', ...args);
}

let tokenCache: { token: string; expiresOn: number } | null = null;
async function getToken(): Promise<string | null> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresOn - 60_000 > now) return tokenCache.token;
  for (const scope of SCOPES) {
    try {
      const t = await credential.getToken(scope);
      if (t?.token) {
        tokenCache = { token: t.token, expiresOn: t.expiresOnTimestamp };
        return t.token;
      }
    } catch {
      // Try the next scope.
    }
  }
  return null;
}

/**
 * Fire-and-forget: mirror `userText` to the model's content filter so Defender can
 * see (and alert on) a jailbreak / prompt-injection attempt. Never awaited by callers;
 * all errors are swallowed so screening can never affect the chat turn.
 */
export function screenForDefender(userText: string): void {
  const { endpoint, enabled, timeoutMs, maxChars } = readConfig();

  // Announce the effective state once, so a disabled shim is obvious in the API log
  // instead of an invisible no-op (the #1 reason "no Defender alerts" is a mystery).
  if (!announced) {
    announced = true;
    console.log(
      enabled
        ? `[defender-screen] enabled — mirroring prompts to ${endpoint} for Defender AI threat detection`
        : '[defender-screen] disabled — set DEFENDER_SCREEN_ENDPOINT (and DEFENDER_SCREEN_ENABLED!=false), then restart the API, to surface agent-UI jailbreaks in Microsoft Defender',
    );
  }

  const text = (userText ?? '').trim().slice(0, maxChars);
  if (!enabled || !text) return;
  void (async () => {
    try {
      const token = await getToken();
      if (!token) {
        debug('no Azure token — check az login / managed identity and the "Cognitive Services OpenAI User" role');
        return;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(endpoint!, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          // The INPUT Prompt Shield runs before generation, so a jailbreak is caught
          // (400) regardless of this tiny output budget — which keeps the call cheap.
          body: JSON.stringify({
            messages: [{ role: 'user', content: text }],
            max_completion_tokens: 16,
          }),
          signal: controller.signal,
        });
        // A 400 content_filter is the SUCCESS signal here: a jailbreak tripped the input
        // Prompt Shield, which is exactly what Defender turns into an alert. A 401/403
        // means the identity lacks data-plane access, so the filter never runs — no alert.
        debug(
          `screened prompt -> HTTP ${res.status}` +
            (res.status === 400
              ? ' (content_filter → Defender jailbreak alert expected)'
              : res.status === 401 || res.status === 403
                ? ' (UNAUTHORIZED → grant the API identity "Cognitive Services OpenAI User"; no alert will fire)'
                : ''),
        );
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      // Best-effort telemetry only — swallow network errors, timeouts, and 4xx/5xx,
      // but surface them under DEBUG so a broken shim can actually be diagnosed.
      debug('screening call failed:', err instanceof Error ? err.message : String(err));
    }
  })();
}
