import { runOrchestrator } from './chat/orchestrator.js';
import { runFoundryAgent } from './chat/foundryProxy.js';
import type { ChatMessage } from './chat/toolLoop.js';

export type ChatEngine = 'in-app' | 'foundry';

export const chatService = {
  /**
   * Runs one assistant turn.
   * - 'in-app'  → orchestrator + specialists run in this process (default).
   * - 'foundry' → forwards to the deployed Foundry hosted agent (demo).
   */
  async send(messages: ChatMessage[], engine: ChatEngine) {
    const reply =
      engine === 'foundry' ? await runFoundryAgent(messages) : await runOrchestrator(messages);
    return { reply, engine };
  },
};
