import { getAiClient } from '../../lib/aiClient.js';
import { runToolLoop, type ChatMessage, type TokenSink } from './toolLoop.js';
import { milestoneTools, dashboardTools, opportunityTools } from './msxTools.js';

// Single flat agent: the assistant calls the MSX tools directly instead of
// delegating to nested specialist sub-agents. This removes an entire layer of
// sequential model round-trips, which roughly halves response latency for
// multi-step actions like creating a milestone.
const ASSISTANT_INSTRUCTIONS =
  'You are the assistant for a SYNTHETIC MOCK MSX Milestone workspace (this is NOT real MSX, ' +
  'Dataverse, or customer data). You can read and manage milestones and opportunities and read ' +
  'dashboard metrics using the tools available to you. Analyze the user\'s request and call the ' +
  'most relevant tool(s) directly; you may call several in turn (e.g. look up an opportunity, then ' +
  'create a milestone under it). Creating a milestone requires an existing opportunity name — if ' +
  'unsure, say so. Report ids and names clearly and combine results into one clear, plain-language ' +
  'answer. Never invent records — rely on your tools. Before creating, updating, or deleting ' +
  'anything, restate the exact action and values and ask the user to confirm; only proceed after ' +
  'they clearly agree.';

// All MSX capabilities exposed as first-class tools on the single agent.
const ALL_TOOLS = [...milestoneTools, ...dashboardTools, ...opportunityTools];

/** Runs one assistant turn over the supplied conversation history. */
export async function runOrchestrator(messages: ChatMessage[], onToken?: TokenSink): Promise<string> {
  const { client, deployment } = getAiClient();
  return runToolLoop(client, deployment, ASSISTANT_INSTRUCTIONS, messages, ALL_TOOLS, 8, onToken);
}
