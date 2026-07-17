import type { AuthUser } from '../lib/entraAuth.js';
import { graphGet, graphPost } from '../lib/graph.js';
import { recordAgentAction } from '../lib/audit.js';
import { HttpError } from '../lib/httpError.js';

/**
 * Microsoft Graph reads on behalf of the signed-in user (Teams, Outlook, org
 * hierarchy). Every read is audited via recordAgentAction per governance. We
 * log counts/summaries — not full message bodies — into the audit trail, and
 * never persist Graph data into the 11 mock tables.
 */

interface GraphUser {
  id: string;
  displayName?: string;
  mail?: string;
  userPrincipalName?: string;
  jobTitle?: string;
  department?: string;
}

interface GraphList<T> {
  value: T[];
}

interface GraphMessage {
  id: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  webLink?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
}

interface GraphChat {
  id: string;
  topic?: string | null;
  chatType?: string;
  lastUpdatedDateTime?: string;
}

const USER_SELECT = 'id,displayName,mail,userPrincipalName,jobTitle,department';

/** 'live' delivers via Microsoft Graph; anything else simulates (no admin needed). */
function sendMode(): 'live' | 'simulate' {
  return process.env.GRAPH_SEND_MODE === 'live' ? 'live' : 'simulate';
}

/**
 * When true, sends proceed WITHOUT the Preview/confirm gate (agent acts
 * autonomously). Deliberately allowed ONLY in simulate mode — live (real)
 * delivery always requires an explicit confirm, so a real email/Teams message
 * can never go out without a human.
 */
function autoConfirmEnabled(): boolean {
  return process.env.SEND_AUTO_CONFIRM === 'true' && sendMode() === 'simulate';
}

function assertion(user: AuthUser): string {
  if (user.kind !== 'user' || !user.bearer) {
    throw new HttpError(401, 'A signed-in Microsoft user is required for this action.');
  }
  return user.bearer;
}

/** Who to record as the actor: the user's email, or the service principal. */
function actorOf(user: AuthUser): string {
  return user.email ?? (user.kind === 'service' ? 'foundry-agent (service)' : 'unknown');
}

/** Run a Graph read, auditing success/failure as a security event. */
async function audited<T>(
  user: AuthUser,
  actionType: string,
  inputSummary: string,
  run: () => Promise<{ data: T; outputSummary: string }>,
): Promise<T> {
  try {
    const { data, outputSummary } = await run();
    await recordAgentAction({
      agentName: 'GraphConnector',
      actionType,
      actor: actorOf(user),
      inputSummary,
      outputSummary,
      securityEvent: true,
      result: 'Success',
    });
    return data;
  } catch (err) {
    await recordAgentAction({
      agentName: 'GraphConnector',
      actionType,
      actor: actorOf(user),
      inputSummary,
      outputSummary: err instanceof Error ? err.message : String(err),
      securityEvent: true,
      result: 'Failed',
    });
    throw err;
  }
}

export const graphService = {
  /** The signed-in user's own profile. */
  me(user: AuthUser) {
    const token = assertion(user);
    return audited(user, 'ReadProfile', 'GET /me', async () => {
      const data = await graphGet<GraphUser>(token, `/me?$select=${USER_SELECT}`);
      return { data, outputSummary: `profile for ${data.userPrincipalName ?? data.id}` };
    });
  },

  /** Manager, direct reports, and colleagues (the manager's other reports). */
  hierarchy(user: AuthUser) {
    const token = assertion(user);
    return audited(user, 'ReadHierarchy', 'GET /me manager + reports', async () => {
      const me = await graphGet<GraphUser>(token, `/me?$select=${USER_SELECT}`);

      let manager: GraphUser | null = null;
      try {
        manager = await graphGet<GraphUser>(token, `/me/manager?$select=${USER_SELECT}`);
      } catch {
        manager = null; // user may have no manager (Graph 404)
      }

      const directReports = (
        await graphGet<GraphList<GraphUser>>(token, `/me/directReports?$select=${USER_SELECT}`)
      ).value;

      let colleagues: GraphUser[] = [];
      if (manager?.id) {
        const peers = (
          await graphGet<GraphList<GraphUser>>(
            token,
            `/users/${manager.id}/directReports?$select=${USER_SELECT}`,
          )
        ).value;
        colleagues = peers.filter((p) => p.id !== me.id);
      }

      const data = { me, manager, directReports, colleagues };
      const summary = `manager=${manager?.displayName ?? 'none'}, reports=${directReports.length}, colleagues=${colleagues.length}`;
      return { data, outputSummary: summary };
    });
  },

  /** Recent Outlook messages (metadata + preview only). */
  messages(user: AuthUser, top: number) {
    const token = assertion(user);
    return audited(user, 'ReadOutlook', `GET /me/messages top=${top}`, async () => {
      const list = await graphGet<GraphList<GraphMessage>>(
        token,
        `/me/messages?$top=${top}&$select=id,subject,bodyPreview,receivedDateTime,webLink,from&$orderby=receivedDateTime desc`,
      );
      return { data: list.value, outputSummary: `returned ${list.value.length} messages` };
    });
  },

  /** Recent Teams chats (metadata only). */
  chats(user: AuthUser, top: number) {
    const token = assertion(user);
    return audited(user, 'ReadTeams', `GET /me/chats top=${top}`, async () => {
      const list = await graphGet<GraphList<GraphChat>>(
        token,
        `/me/chats?$top=${top}&$orderby=lastMessagePreview/createdDateTime desc`,
      );
      return { data: list.value, outputSummary: `returned ${list.value.length} chats` };
    });
  },

  /**
   * Send an Outlook email AS the signed-in user (delegated Mail.Send).
   * Confirm gate: without `confirm: true`, nothing is sent — we return a preview
   * so the agent must restate the email and get an explicit go-ahead first.
   * Honors GRAPH_SEND_MODE: 'simulate' (default, no admin — records but does not
   * deliver) or 'live' (real Graph send, needs admin-consented Mail.Send).
   */
  async sendMail(
    user: AuthUser,
    input: { to: string; subject: string; body: string; confirm?: boolean },
  ) {
    const mode = sendMode();
    // Live delivery always needs a real signed-in user (their token + explicit
    // confirm). Simulation may be driven by the service principal (the hosted
    // agent) since nothing is actually delivered.
    if (mode === 'live') assertion(user);

    if (!input.confirm && !autoConfirmEnabled()) {
      return {
        sent: false,
        requiresConfirmation: true,
        mode,
        preview: { to: input.to, subject: input.subject, body: input.body },
        note: 'Not sent. Re-submit the same request with confirm=true to send this email.',
      };
    }

    return audited<{ sent: boolean; simulated: boolean; to: string; subject: string; note?: string }>(
      user,
      'SendOutlookMail',
      `sendMail to=${input.to} subject="${input.subject}" mode=${mode}`,
      async () => {
        if (mode === 'live') {
          await graphPost(user.bearer!, '/me/sendMail', {
            message: {
              subject: input.subject,
              body: { contentType: 'Text', content: input.body },
              toRecipients: [{ emailAddress: { address: input.to } }],
            },
            saveToSentItems: true,
          });
          return {
            data: { sent: true, simulated: false, to: input.to, subject: input.subject },
            outputSummary: `sent email to ${input.to}`,
          };
        }
        // Simulate: record the action but don't deliver.
        return {
          data: {
            sent: true,
            simulated: true,
            to: input.to,
            subject: input.subject,
            note: 'Simulated — not delivered. Set GRAPH_SEND_MODE=live (after admin consent) to send for real.',
          },
          outputSummary: `SIMULATED email to ${input.to} (not delivered)`,
        };
      },
    );
  },

  /**
   * Post a Teams notification. Confirm-gated like email. In 'simulate' mode
   * (default) it records the action without delivering — no admin needed. In
   * 'live' mode it sends AS the signed-in user (delegated): it resolves the
   * recipient, opens or reuses a 1:1 chat, and posts the message. Requires the
   * delegated Chat.ReadWrite + ChatMessage.Send scopes and a `to` recipient.
   */
  async notifyTeams(
    user: AuthUser,
    input: { message: string; to?: string; confirm?: boolean },
  ) {
    const mode = sendMode();
    if (mode === 'live') assertion(user);

    if (!input.confirm && !autoConfirmEnabled()) {
      return {
        sent: false,
        requiresConfirmation: true,
        mode,
        preview: { to: input.to ?? '(self)', message: input.message },
        note: 'Not sent. Re-submit with confirm=true to post this Teams notification.',
      };
    }

    return audited(
      user,
      'NotifyTeams',
      `notifyTeams to=${input.to ?? '(self)'} mode=${mode}`,
      async () => {
        if (mode === 'live') {
          const token = user.bearer!;
          if (!input.to) {
            throw new HttpError(400, 'A recipient email (to) is required to send a live Teams message.');
          }
          // Send AS the signed-in user (delegated). Resolve both parties to their
          // Entra object ids, open (or reuse) a 1:1 chat, then post the message.
          const recipient = await graphGet<{ id: string }>(
            token,
            `/users/${encodeURIComponent(input.to)}?$select=id`,
          );
          const meUser = await graphGet<{ id: string }>(token, '/me?$select=id');
          const chat = await graphPost<{ id: string }>(token, '/chats', {
            chatType: 'oneOnOne',
            members: [
              {
                '@odata.type': '#microsoft.graph.aadUserConversationMember',
                roles: ['owner'],
                'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${meUser.id}')`,
              },
              {
                '@odata.type': '#microsoft.graph.aadUserConversationMember',
                roles: ['owner'],
                'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${recipient.id}')`,
              },
            ],
          });
          if (!chat?.id) {
            throw new HttpError(502, 'Could not open a Teams chat with the recipient.');
          }
          await graphPost(token, `/chats/${chat.id}/messages`, {
            body: { content: input.message },
          });
          return {
            data: { sent: true, simulated: false, to: input.to, message: input.message },
            outputSummary: `sent Teams message to ${input.to}`,
          };
        }
        return {
          data: {
            sent: true,
            simulated: true,
            to: input.to ?? '(self)',
            message: input.message,
            note: 'Simulated Teams notification — not delivered.',
          },
          outputSummary: `SIMULATED Teams notification to ${input.to ?? '(self)'}`,
        };
      },
    );
  },
};
