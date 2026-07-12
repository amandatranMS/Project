import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-chat-turn context. Set at the start of an in-app assistant turn so that
 * any governed action recorded during the turn (via recordAgentAction) can be
 * linked back to the conversation (prompts + answers) that produced it.
 *
 * Only works for the in-app engine, where the agent's tools run in this process
 * within the same async call chain. Foundry hosted-agent tool calls arrive as
 * separate HTTP requests and are outside this context.
 */
export interface ChatTurnMessage {
  role: string;
  content: string;
}

export interface AgentTurnContext {
  /** Messages sent into this turn (prior turns + the new user prompt). */
  conversation: ChatTurnMessage[];
  /** Audit-log row ids created during this turn (stamped with the full transcript afterwards). */
  createdAuditIds: string[];
}

const storage = new AsyncLocalStorage<AgentTurnContext>();

export function runWithAgentContext<T>(ctx: AgentTurnContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

export function getAgentContext(): AgentTurnContext | undefined {
  return storage.getStore();
}
