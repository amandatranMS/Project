import type { AzureOpenAI } from 'openai';

/** A callable the model can invoke, plus its JSON-schema description. */
export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

/**
 * Runs a chat-completion loop, executing tool calls until the model produces a
 * final text answer. Mirrors the Python agent's run_tool_loop.
 */
export async function runToolLoop(
  client: AzureOpenAI,
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
  tools: Tool[],
  maxSteps = 8,
): Promise<string> {
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const openaiTools = tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const convo: any[] = [{ role: 'system', content: systemPrompt }, ...messages];

  for (let step = 0; step < maxSteps; step++) {
    const resp = await client.chat.completions.create({
      model,
      messages: convo,
      tools: openaiTools.length ? openaiTools : undefined,
      tool_choice: openaiTools.length ? 'auto' : undefined,
    });
    const msg = resp.choices[0].message;

    if (!msg.tool_calls?.length) {
      return msg.content ?? '';
    }

    convo.push({
      role: 'assistant',
      content: msg.content,
      tool_calls: msg.tool_calls,
    });

    for (const tc of msg.tool_calls) {
      const tool = toolMap.get(tc.function.name);
      let result: unknown;
      let args: Record<string, unknown> = {};
      try {
        args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch {
        args = {};
      }
      if (!tool) {
        result = `Unknown tool: ${tc.function.name}`;
      } else {
        try {
          result = await tool.run(args);
        } catch (err) {
          result = `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      convo.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: typeof result === 'string' ? result : JSON.stringify(result),
      });
    }
  }

  return "I wasn't able to finish within the step limit — please refine your request.";
}
