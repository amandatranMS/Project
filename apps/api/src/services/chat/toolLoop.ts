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
 *
 * If `onToken` is supplied, the model calls are streamed and each text delta of
 * the final answer is forwarded to it (for live "typing" in the UI). Tool-call
 * rounds are not surfaced as tokens.
 */
export type TokenSink = (delta: string) => void;

export async function runToolLoop(
  client: AzureOpenAI,
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
  tools: Tool[],
  maxSteps = 8,
  onToken?: TokenSink,
): Promise<string> {
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const openaiTools = tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const convo: any[] = [{ role: 'system', content: systemPrompt }, ...messages];

  // Runs the tool calls requested by the model and appends their results.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function executeToolCalls(toolCalls: any[]) {
    for (const tc of toolCalls) {
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

  for (let step = 0; step < maxSteps; step++) {
    if (onToken) {
      // Streaming path: forward text deltas and reconstruct any tool calls.
      const stream = await client.chat.completions.create({
        model,
        messages: convo,
        tools: openaiTools.length ? openaiTools : undefined,
        tool_choice: openaiTools.length ? 'auto' : undefined,
        stream: true,
      });
      let content = '';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolCalls: any[] = [];
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          content += delta.content;
          onToken(delta.content);
        }
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const i = tc.index ?? 0;
            toolCalls[i] ??= { id: '', type: 'function', function: { name: '', arguments: '' } };
            if (tc.id) toolCalls[i].id = tc.id;
            if (tc.function?.name) toolCalls[i].function.name += tc.function.name;
            if (tc.function?.arguments) toolCalls[i].function.arguments += tc.function.arguments;
          }
        }
      }
      if (!toolCalls.length) return content;
      convo.push({ role: 'assistant', content: content || null, tool_calls: toolCalls });
      await executeToolCalls(toolCalls);
      continue;
    }

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

    await executeToolCalls(msg.tool_calls);
  }

  return "I wasn't able to finish within the step limit — please refine your request.";
}
