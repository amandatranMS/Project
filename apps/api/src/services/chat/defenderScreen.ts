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

const ENDPOINT = process.env.DEFENDER_SCREEN_ENDPOINT?.trim();
// Enabled only when an endpoint is configured and it isn't explicitly turned off.
const ENABLED = !!ENDPOINT && process.env.DEFENDER_SCREEN_ENABLED !== 'false';
const TIMEOUT_MS = Number(process.env.DEFENDER_SCREEN_TIMEOUT_MS) || 15_000;
const MAX_CHARS = Number(process.env.DEFENDER_SCREEN_MAX_CHARS) || 8_000;

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
  const text = (userText ?? '').trim().slice(0, MAX_CHARS);
  if (!ENABLED || !text) return;
  void (async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        await fetch(ENDPOINT!, {
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
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // Best-effort telemetry only — swallow network errors, timeouts, and 4xx/5xx.
    }
  })();
}
