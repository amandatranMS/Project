import type { AuthUser } from '../lib/entraAuth.js';
import { createGraphSession, graphGet, graphPost, GraphError, type GraphSession } from '../lib/graph.js';
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
  accountEnabled?: boolean;
  userType?: string;
}
export type { GraphUser };

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

interface GraphChatMessage {
  id: string;
  messageType?: string;
  createdDateTime?: string;
  from?: { user?: { displayName?: string } | null } | null;
  body?: { content?: string; contentType?: string };
}

/** A chat plus the recent messages inside it (content the agent can reason over). */
interface TeamsChatThread {
  id: string;
  topic: string | null;
  chatType?: string;
  lastUpdatedDateTime?: string;
  messages: { from: string; sentAt?: string; text: string }[];
}

const USER_SELECT = 'id,displayName,mail,userPrincipalName,jobTitle,department';
const TENANT_USER_SELECT = `${USER_SELECT},accountEnabled,userType`;
const TENANT_BROADCAST_CONCURRENCY = 2;

/** Collapse Teams HTML message content to a short plain-text preview. */
function toPreview(body?: { content?: string; contentType?: string }, max = 400): string {
  const raw = body?.content ?? '';
  const text =
    body?.contentType === 'html'
      ? raw.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
      : raw;
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/**
 * Delivery mode. Defaults to 'live' — real Microsoft Graph delivery — so email and
 * Teams are actually sent (after the human confirm gate). Set GRAPH_SEND_MODE=simulate
 * to explicitly opt back into recorded-but-undelivered sends (e.g. for tests/demos).
 */
function sendMode(): 'live' | 'simulate' {
  return process.env.GRAPH_SEND_MODE === 'simulate' ? 'simulate' : 'live';
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

async function sendTeamsChat(session: GraphSession, senderId: string, recipientId: string, message: string) {
  const chat = await session.post<{ id: string }>('/chats', {
    chatType: 'oneOnOne',
    members: [
      {
        '@odata.type': '#microsoft.graph.aadUserConversationMember',
        roles: ['owner'],
        'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${senderId}')`,
      },
      {
        '@odata.type': '#microsoft.graph.aadUserConversationMember',
        roles: ['owner'],
        'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${recipientId}')`,
      },
    ],
  });
  if (!chat?.id) throw new HttpError(502, 'Could not open a Teams chat with the recipient.');
  await session.post(`/chats/${chat.id}/messages`, { body: { content: message } });
}

async function mapConcurrent<T, R>(
  values: T[],
  concurrency: number,
  work: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (next < values.length) {
        const index = next++;
        results[index] = await work(values[index]);
      }
    }),
  );
  return results;
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

  /**
   * The signed-in user's manager only (lighter than hierarchy()). Returns null
   * when the user has no manager on record (Graph 404). Any other Graph failure
   * (e.g. missing consent) propagates so callers can audit it as a failure.
   */
  manager(user: AuthUser): Promise<GraphUser | null> {
    const token = assertion(user);
    return audited<GraphUser | null>(user, 'ReadManager', 'GET /me/manager', async () => {
      try {
        const m = await graphGet<GraphUser>(token, `/me/manager?$select=${USER_SELECT}`);
        return {
          data: m,
          outputSummary: `manager=${m.displayName ?? m.userPrincipalName ?? m.id}`,
        };
      } catch (err) {
        if (err instanceof GraphError && err.status === 404) {
          return { data: null, outputSummary: 'no manager on record' };
        }
        throw err;
      }
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
   * Recent Teams chats WITH the last few messages inside each — the actual
   * content the agent needs to extract information from. Lists the top chats,
   * then reads up to `perChat` recent messages per chat (sender + short text
   * preview + timestamp). Only metadata/previews are returned and audited; full
   * bodies are never persisted into the mock tables.
   */
  teamsMessages(user: AuthUser, topChats: number, perChat: number) {
    const token = assertion(user);
    return audited(user, 'ReadTeams', `GET /me/chats messages top=${topChats} perChat=${perChat}`, async () => {
      const chats = (
        await graphGet<GraphList<GraphChat>>(
          token,
          `/me/chats?$top=${topChats}&$orderby=lastMessagePreview/createdDateTime desc`,
        )
      ).value;

      const threads: TeamsChatThread[] = [];
      let totalMessages = 0;
      for (const chat of chats) {
        let messages: TeamsChatThread['messages'] = [];
        try {
          const raw = await graphGet<GraphList<GraphChatMessage>>(
            token,
            `/me/chats/${chat.id}/messages?$top=${perChat}`,
          );
          messages = raw.value
            .filter((m) => (m.messageType ?? 'message') === 'message')
            .map((m) => ({
              from: m.from?.user?.displayName ?? 'unknown',
              sentAt: m.createdDateTime,
              text: toPreview(m.body),
            }))
            .filter((m) => m.text.length > 0);
        } catch {
          // A single chat that can't be read (e.g. a meeting/system chat) must not
          // fail the whole read — skip its messages and keep going.
          messages = [];
        }
        totalMessages += messages.length;
        threads.push({
          id: chat.id,
          topic: chat.topic ?? null,
          chatType: chat.chatType,
          lastUpdatedDateTime: chat.lastUpdatedDateTime,
          messages,
        });
      }
      return {
        data: threads,
        outputSummary: `returned ${totalMessages} messages across ${threads.length} chats`,
      };
    });
  },

  /**
   * Send an Outlook email AS the signed-in user (delegated Mail.Send).
   * Confirm gate: without `confirm: true`, nothing is sent — we return a preview
   * so the agent must restate the email and get an explicit go-ahead first.
   * Honors GRAPH_SEND_MODE: 'live' (default — real Graph send via admin-consented
   * Mail.Send) or 'simulate' (records but does not deliver; no admin needed).
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
   * Post a Teams notification. Confirm-gated like email. In 'live' mode (default)
   * it sends AS the signed-in user (delegated): it resolves the recipient, opens
   * or reuses a 1:1 chat, and posts the message. In 'simulate' mode it records the
   * action without delivering — no admin needed. Live requires the delegated
   * Chat.ReadWrite + ChatMessage.Send scopes and a `to` recipient.
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

    return audited<{ sent: boolean; simulated: boolean; to: string; message: string; note?: string }>(
      user,
      'NotifyTeams',
      `notifyTeams to=${input.to ?? '(self)'} mode=${mode}`,
      async () => {
        if (mode === 'live') {
          const token = user.bearer!;
          const recipientEmail = input.to ?? user.email;
          if (!recipientEmail) {
            throw new HttpError(
              400,
              'A recipient email is required for a live Teams message when the signed-in account has no email claim.',
            );
          }
          // Send AS the signed-in user (delegated). Resolve both parties to their
          // Entra object ids, open (or reuse) a 1:1 chat, then post the message.
          const recipient = await graphGet<{ id: string }>(
            token,
            `/users/${encodeURIComponent(recipientEmail)}?$select=id`,
          );
          const meUser = await graphGet<{ id: string }>(token, '/me?$select=id');
          if (recipient.id === meUser.id) {
            throw new HttpError(
              400,
              'You cannot open a 1:1 Teams chat with yourself. Enter a different recipient (e.g. a teammate) and try again.',
            );
          }
          let chat: { id: string } | null;
          try {
            chat = await graphPost<{ id: string }>(token, '/chats', {
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
          } catch (err) {
            // Creating a 1:1 chat needs the delegated Chat.ReadWrite (or Chat.Create)
            // scope. If the signed-in user's token predates that consent, Graph
            // returns a 403 scope error — surface an actionable message.
            if (
              err instanceof GraphError &&
              (err.status === 403 || /scope|permission/i.test(err.message))
            ) {
              throw new HttpError(
                403,
                'Teams send needs the Chat.ReadWrite permission, which your current sign-in token does not carry yet. Click "Connect Microsoft 365" on this page to refresh consent, then try again.',
              );
            }
            throw err;
          }
          if (!chat?.id) {
            throw new HttpError(502, 'Could not open a Teams chat with the recipient.');
          }
          await graphPost(token, `/chats/${chat.id}/messages`, {
            body: { content: input.message },
          });
          return {
            data: { sent: true, simulated: false, to: recipientEmail, message: input.message },
            outputSummary: `sent Teams message to ${recipientEmail}`,
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

  /**
   * Broadcast a Teams DM to every enabled member account in the signed-in user's
   * tenant. Guests, disabled accounts, accounts without an address, and the sender
   * are excluded. The directory read and aggregate delivery result are both audited.
   */
  async notifyTenantTeams(user: AuthUser, input: { message: string; confirm?: boolean }) {
    const mode = sendMode();
    if (mode === 'live') assertion(user);
    if (!input.confirm && !autoConfirmEnabled()) {
      return {
        sent: false,
        requiresConfirmation: true,
        mode,
        preview: { audience: 'All enabled tenant members', message: input.message },
        note: 'Not sent. Re-submit with confirm=true to post this tenant-wide Teams notification.',
      };
    }

    if (mode === 'simulate') {
      return audited(user, 'NotifyTeamsTenantBroadcast', 'tenant-wide Teams broadcast mode=simulate', async () => ({
        data: {
          sent: true,
          simulated: true,
          audience: 'tenant',
          recipientCount: 0,
          deliveredCount: 0,
          failedCount: 0,
          message: input.message,
          note: 'Simulated tenant-wide Teams notification — not delivered.',
        },
        outputSummary: 'SIMULATED tenant-wide Teams notification (not delivered)',
      }));
    }

    const token = assertion(user);
    let directory;
    try {
      directory = await audited(
        user,
        'ReadTenantUsers',
        'GET /users for tenant-wide Teams broadcast',
        async () => {
          const graph = await createGraphSession(token);
          const [meUser, users] = await Promise.all([
            graph.get<{ id: string }>('/me?$select=id'),
            graph.getAll<GraphUser>(`/users?$select=${TENANT_USER_SELECT}&$top=999`),
          ]);
          const eligible = users.filter(
            (candidate) =>
              candidate.id !== meUser.id &&
              candidate.accountEnabled !== false &&
              candidate.userType !== 'Guest' &&
              Boolean(candidate.mail || candidate.userPrincipalName),
          );
          return {
            data: { session: graph, me: meUser, recipients: eligible },
            outputSummary: `resolved ${eligible.length} enabled tenant member recipients`,
          };
        },
      );
    } catch (err) {
      if (err instanceof GraphError && err.status === 403) {
        throw new HttpError(
          403,
          'Tenant-wide Teams broadcast requires administrator consent for User.Read.All, Chat.ReadWrite, and ChatMessage.Send. Ask a tenant administrator to grant consent, then sign in again.',
        );
      }
      throw err;
    }
    const { session, me, recipients } = directory;

    const deliveries = await mapConcurrent(recipients, TENANT_BROADCAST_CONCURRENCY, async (recipient) => {
      try {
        await sendTeamsChat(session, me.id, recipient.id, input.message);
        return { sent: true as const };
      } catch (err) {
        return { sent: false as const };
      }
    });
    const failures = deliveries.filter((delivery) => !delivery.sent);
    const deliveredCount = deliveries.length - failures.length;

    await recordAgentAction({
      agentName: 'GraphConnector',
      actionType: 'NotifyTeamsTenantBroadcast',
      actor: actorOf(user),
      inputSummary: `tenant-wide Teams broadcast recipients=${recipients.length} mode=live`,
      outputSummary:
        failures.length === 0
          ? `sent Teams message to all ${deliveredCount} eligible tenant members`
          : `sent=${deliveredCount}, failed=${failures.length}, eligible=${recipients.length}`,
      securityEvent: true,
      result: failures.length === 0 ? 'Success' : 'Failed',
    });

    return {
      sent: failures.length === 0,
      simulated: false,
      audience: 'tenant',
      recipientCount: recipients.length,
      deliveredCount,
      failedCount: failures.length,
      message: input.message,
      ...(failures.length > 0
        ? {
            note:
              deliveredCount > 0
                ? 'Teams delivery was partially successful. Some eligible tenant members did not receive the message; verify Chat.ReadWrite and ChatMessage.Send consent and retry if needed.'
                : 'No Teams messages were delivered. Verify administrator consent for Chat.ReadWrite and ChatMessage.Send, then sign in again and retry.',
          }
        : {}),
    };
  },
};
