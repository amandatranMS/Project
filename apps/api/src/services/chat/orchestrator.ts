import { getAiClient } from '../../lib/aiClient.js';
import { runToolLoop, type ChatMessage, type TokenSink } from './toolLoop.js';
import { milestoneTools, dashboardTools, opportunityTools, searchTools } from './msxTools.js';

// Single flat agent: the assistant calls the MSX tools directly instead of
// delegating to nested specialist sub-agents. This removes an entire layer of
// sequential model round-trips, which roughly halves response latency for
// multi-step actions like creating a milestone.
const ASSISTANT_INSTRUCTIONS =
  'You are the assistant for a SYNTHETIC MOCK MSX Milestone workspace (this is NOT real MSX, ' +
  'Dataverse, or customer data). You can read and manage milestones and opportunities and read ' +
  'dashboard metrics using the tools available to you. Analyze the user\'s request and call the ' +
  'most relevant tool(s) directly; you may call several in turn (e.g. look up an opportunity, then ' +
  'create a milestone under it). To find a record by ANY field value other than its OPP-/MS- id ' +
  '(a TPID like TPID-1001, a customer, industry, owner/AE/SE, competitor, region, date, or any ' +
  'other field), call search_records with that value — it matches across every field and returns ' +
  'the full records. Never say a record does not exist until a search_records call for it comes ' +
  'back empty. Creating a milestone requires an existing opportunity name — if ' +
  'unsure, say so. Report ids and names clearly and combine results into one clear, plain-language ' +
  'answer. Never invent records — rely on your tools. When the user asks for an assessment, ' +
  'recommendation, plan, or next steps for one opportunity, structure the answer as Known Facts, ' +
  'Assumptions, Recommended Actions, and Expected Outcome. Known Facts may contain only values ' +
  'returned by tools for that opportunity. Label every inference as an assumption; say "None" if ' +
  'none are needed. Present general Solution Engineering advice as proposed actions, not record ' +
  'facts. Never introduce a specific person or role, partner, date, risk rating, count, or pipeline ' +
  'metric unless a tool returned it for that scope. Do not mix dashboard metrics into a ' +
  'single-opportunity answer unless the user explicitly requests pipeline context. Keep ' +
  'recommendations concise and tied to the stated blocker or objective. Before creating, updating, or deleting ' +
  'anything, restate the exact action and values and ask the user to confirm; only proceed after ' +
  'they clearly agree.';

// All MSX capabilities exposed as first-class tools on the single agent.
const ALL_TOOLS = [...milestoneTools, ...dashboardTools, ...opportunityTools, ...searchTools];

/** Runs one assistant turn over the supplied conversation history. */
export async function runOrchestrator(messages: ChatMessage[], onToken?: TokenSink): Promise<string> {
  const { client, deployment } = getAiClient();
  return runToolLoop(client, deployment, ASSISTANT_INSTRUCTIONS, messages, ALL_TOOLS, 8, onToken);
}
