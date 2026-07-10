import { getAiClient } from '../../lib/aiClient.js';
import { runToolLoop, type ChatMessage, type Tool } from './toolLoop.js';
import { milestoneTools, dashboardTools, opportunityTools } from './msxTools.js';

const CONFIRM_RULE =
  ' Before creating, updating, or deleting anything, restate the exact action and values and ask ' +
  'the user to confirm; only proceed after they clearly agree. Never invent data — rely on your tools.';

interface SpecialistSpec {
  name: string;
  description: string;
  instructions: string;
  tools: Tool[];
}

const SPECIALISTS: SpecialistSpec[] = [
  {
    name: 'milestone_specialist',
    description: 'Handles milestones: list, look up, create, update, or delete milestones.',
    instructions:
      'You are the Milestone specialist for a SYNTHETIC MOCK MSX workspace. Use your tools to read ' +
      'and modify milestones. Creating a milestone requires an existing opportunity name — if unsure, ' +
      'say so. Report ids and names clearly.' + CONFIRM_RULE,
    tools: milestoneTools,
  },
  {
    name: 'dashboard_specialist',
    description: 'Answers questions about aggregate metrics and pipeline health.',
    instructions:
      'You are the Dashboard specialist for a SYNTHETIC MOCK MSX workspace. Use get_dashboard_summary ' +
      'to answer questions about counts (active opportunities, at-risk/blocked milestones, pending ' +
      'approvals) and pipeline value. Summarize the numbers plainly.',
    tools: dashboardTools,
  },
  {
    name: 'opportunity_specialist',
    description: 'Handles opportunities: list, look up, or create opportunities.',
    instructions:
      'You are the Opportunity specialist for a SYNTHETIC MOCK MSX workspace. Use your tools to read ' +
      'and create opportunities. Report ids and names clearly.' + CONFIRM_RULE,
    tools: opportunityTools,
  },
];

const ORCHESTRATOR_INSTRUCTIONS =
  'You are the main assistant for a SYNTHETIC MOCK MSX Milestone workspace (this is NOT real MSX, ' +
  'Dataverse, or customer data). You coordinate a team of specialist agents, each exposed to you as ' +
  'a tool. Analyze the user\'s request and delegate to the most relevant specialist(s) by calling ' +
  'their ask_* tool with a clear, self-contained instruction. You may call several in turn (e.g. look ' +
  'up an opportunity, then create a milestone under it). Combine their results into one clear, ' +
  'plain-language answer. Never invent records; rely on the specialists. For any action that creates, ' +
  'updates, or deletes data, make sure the user has confirmed before it happens.';

/** Wraps each specialist as a single tool the orchestrator can call. */
function buildSpecialistTools(model: string): Tool[] {
  const { client } = getAiClient();
  return SPECIALISTS.map((spec) => ({
    name: `ask_${spec.name}`,
    description: spec.description,
    parameters: {
      type: 'object',
      properties: {
        request: {
          type: 'string',
          description: 'A clear, self-contained instruction or question for this specialist.',
        },
      },
      required: ['request'],
    },
    run: (a) =>
      runToolLoop(
        client,
        model,
        spec.instructions,
        [{ role: 'user', content: String(a.request ?? '') }],
        spec.tools,
      ),
  }));
}

/** Runs one orchestrator turn over the supplied conversation history. */
export async function runOrchestrator(messages: ChatMessage[]): Promise<string> {
  const { client, deployment } = getAiClient();
  const roster = SPECIALISTS.map((s) => `- ask_${s.name}: ${s.description}`).join('\n');
  const system = `${ORCHESTRATOR_INSTRUCTIONS}\n\nYour specialist team:\n${roster}`;
  return runToolLoop(client, deployment, system, messages, buildSpecialistTools(deployment));
}
