import { runOrchestrator } from './chat/orchestrator.js';
import { runFoundryAgent } from './chat/foundryProxy.js';
import { screenForDefender } from './chat/defenderScreen.js';
import type { ChatMessage, TokenSink } from './chat/toolLoop.js';
import { prisma } from '../lib/prisma.js';
import { runWithAgentContext, type AgentTurnContext } from '../lib/agentContext.js';
import type { AuthUser } from '../lib/entraAuth.js';
import { createUserSession } from '../lib/userSessions.js';
import { HttpError } from '../lib/httpError.js';

export type ChatEngine = 'in-app' | 'foundry';

/** Coordinates one chat turn, user delegation, streaming, and audit attribution. */
export const chatService = {
  /**
   * Runs one assistant turn.
   * - 'in-app'  → orchestrator + specialists run in this process (default).
   * - 'foundry' → forwards to the deployed Foundry hosted agent (demo).
   *
   * If `onToken` is supplied, the in-app engine streams the answer token-by-token
   * for a live "typing" experience; the Foundry engine emits its answer in one
   * chunk (its tool calls arrive as separate requests, so we can't stream them).
   *
   * Either way, the conversation (prompts + answers) is captured onto the audit
   * rows created during the turn so investigators can review what led to each
   * governed action.
   */
  async send(messages: ChatMessage[], engine: ChatEngine, user?: AuthUser, onToken?: TokenSink) {
    // Mirror the user's latest message to the model's synchronous content filter so
    // Microsoft Defender for Cloud can raise jailbreak / prompt-injection alerts. The
    // hosted agent's streaming Responses path swallows content-filter blocks (it never
    // returns the HTTP 400 Defender keys off), so without this a malicious prompt is
    // blocked but never surfaces in Defender. Fire-and-forget: never blocks or throws.
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        screenForDefender(messages[i].content);
        break;
      }
    }

    // The in-app (direct Azure OpenAI) engine is off by default — the demo routes
    // every turn to the Foundry hosted agent. Set IN_APP_ENGINE_ENABLED=true to
    // re-enable it: it is the ONLY path Microsoft Purview Data Security / DLP can
    // govern (Purview does not cover Foundry agents), and it carries the signed-in
    // user's Defender/Purview user-security context on each model call.
    if (engine === 'in-app' && process.env.IN_APP_ENGINE_ENABLED !== 'true') {
      throw new HttpError(403, 'The in-app engine is disabled. Use the Foundry hosted agent.');
    }
    if (engine === 'foundry') {
      // If a real user is signed in, stash their token and give the hosted agent
      // an opaque session handle so it can act on their behalf (Graph OBO).
      const sessionId =
        user?.kind === 'user' && user.bearer ? createUserSession(user.bearer, user.email) : undefined;

      const startedAt = new Date();
      const reply = await runFoundryAgent(messages, onToken, sessionId);
      const fullConversation = JSON.stringify([...messages, { role: 'assistant', content: reply }]);
      // Attribute everything the hosted agent did during THIS user's turn to that
      // user, so the Approvals log and Audit Log stay private per user. The agent
      // calls back with the service key (no user identity), so its rows are created
      // with ownerId=null and back-stamped here.
      const ownerId = user?.kind === 'user' ? user.oid : undefined;
      await prisma.agentActionAuditLog.updateMany({
        where: { createdAt: { gte: startedAt }, conversation: null },
        data: { conversation: fullConversation, ...(ownerId ? { ownerId } : {}) },
      });
      if (ownerId) {
        await prisma.approvalRequest.updateMany({
          where: { createdAt: { gte: startedAt }, ownerId: null },
          data: { ownerId },
        });
      }
      return { reply, engine };
    }

    const ctx: AgentTurnContext = { conversation: messages, createdAuditIds: [] };
    const reply = await runWithAgentContext(ctx, () => runOrchestrator(messages, onToken));

    if (ctx.createdAuditIds.length) {
      const fullConversation = JSON.stringify([...messages, { role: 'assistant', content: reply }]);
      await prisma.agentActionAuditLog.updateMany({
        where: { id: { in: ctx.createdAuditIds } },
        data: { conversation: fullConversation },
      });
    }

    return { reply, engine };
  },
};
