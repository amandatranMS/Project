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

function assertion(user: AuthUser): string {
  if (user.kind !== 'user' || !user.bearer) {
    throw new HttpError(401, 'A signed-in Microsoft user is required for this action.');
  }
  return user.bearer;
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
      actor: user.email,
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
      actor: user.email,
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
   */
  async sendMail(
    user: AuthUser,
    input: { to: string; subject: string; body: string; confirm?: boolean },
  ) {
    const token = assertion(user);

    if (!input.confirm) {
      return {
        sent: false,
        requiresConfirmation: true,
        preview: { to: input.to, subject: input.subject, body: input.body },
        note: 'Not sent. Re-submit the same request with confirm=true to send this email as you.',
      };
    }

    return audited(
      user,
      'SendOutlookMail',
      `sendMail to=${input.to} subject="${input.subject}"`,
      async () => {
        await graphPost(token, '/me/sendMail', {
          message: {
            subject: input.subject,
            body: { contentType: 'Text', content: input.body },
            toRecipients: [{ emailAddress: { address: input.to } }],
          },
          saveToSentItems: true,
        });
        return {
          data: { sent: true, to: input.to, subject: input.subject },
          outputSummary: `sent email to ${input.to}`,
        };
      },
    );
  },
};
