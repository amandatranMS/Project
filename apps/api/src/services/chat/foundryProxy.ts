import { DefaultAzureCredential } from '@azure/identity';
import type { ChatMessage } from './toolLoop.js';

/**
 * Option A (demo): forward the conversation to the deployed Foundry hosted
 * agent via its OpenAI Responses endpoint. Requires FOUNDRY_AGENT_ENDPOINT and
 * an Azure login; the hosted agent reaches the app's data through the dev tunnel.
 */
const SCOPES = ['https://ai.azure.com/.default', 'https://cognitiveservices.azure.com/.default'];

const credential = new DefaultAzureCredential();

async function getToken(): Promise<string> {
  let lastErr: unknown;
  for (const scope of SCOPES) {
    try {
      const t = await credential.getToken(scope);
      if (t?.token) return t.token;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`Could not acquire an Azure token: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
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

export async function runFoundryAgent(messages: ChatMessage[]): Promise<string> {
  const endpoint = process.env.FOUNDRY_AGENT_ENDPOINT;
  if (!endpoint) {
    throw new Error(
      'The Foundry agent engine is not configured. Set FOUNDRY_AGENT_ENDPOINT in the root .env ' +
        '(the responses endpoint printed by `azd deploy`).',
    );
  }

  const token = await getToken();

  // Send the entire conversation as Responses input items. The hosted agent runs
  // statelessly (store:false), so each request must carry the full history —
  // otherwise a bare "yes, create it" loses the milestone details from earlier
  // turns and the agent re-asks for them.
  const input = messages.map((m) => ({ role: m.role, content: m.content }));

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ input, stream: false }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Foundry agent responded ${res.status}: ${text.slice(0, 300)}`);
  }
  try {
    return extractText(JSON.parse(text));
  } catch {
    return text;
  }
}
