import OpenAI from 'openai';
import { BaseProvider, type ChatStreamParams } from './BaseProvider.js';
import type { StreamEvent, ToolCall } from '../types/index.js';
import { zodToJsonSchema } from './zodHelper.js';

export class OpenAIProvider extends BaseProvider {
  readonly name = 'openai';
  private client: OpenAI;

  constructor(apiKey?: string, baseURL?: string) {
    super();
    this.client = new OpenAI({
      apiKey: apiKey || process.env.OPENAI_API_KEY || 'dummy-key',
      baseURL: baseURL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    });
  }

  async *streamChat(params: ChatStreamParams): AsyncGenerator<StreamEvent, void, unknown> {
    const { model, systemPrompt, messages, tools, temperature, signal } = params;

    // Convert tools to OpenAI format
    const openAITools: OpenAI.Chat.Completions.ChatCompletionTool[] = tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: zodToJsonSchema(t.inputSchema) as Record<string, unknown>,
      },
    }));

    // Convert messages
    const openAIMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
    ];

    for (const msg of messages) {
      if (msg.role === 'user') {
        openAIMessages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        const assistantMsg: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
          role: 'assistant',
          content: msg.content || null,
        };
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          assistantMsg.tool_calls = msg.toolCalls.map((tc: ToolCall) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          }));
        }
        openAIMessages.push(assistantMsg);
      } else if (msg.role === 'tool' && msg.toolResult) {
        openAIMessages.push({
          role: 'tool',
          tool_call_id: msg.toolResult.toolCallId,
          content: msg.toolResult.content,
        });
      }
    }

    const stream = await this.client.chat.completions.create(
      {
        model,
        messages: openAIMessages,
        tools: openAITools.length > 0 ? openAITools : undefined,
        temperature: temperature ?? 0.2,
        max_tokens: params.maxTokens ?? 16384,
        stream: true,
        stream_options: { include_usage: true },
      },
      { signal }
    );

    const pendingToolCalls = new Map<number, { id: string; name: string; argsString: string }>();

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (choice?.delta) {
        const delta = choice.delta;

        // Handle standard text delta
        if (delta.content) {
          yield { type: 'text_delta', delta: delta.content };
        }

        // Handle reasoning content (DeepSeek R1 / o3-mini)
        if ('reasoning_content' in delta && typeof (delta as Record<string, unknown>).reasoning_content === 'string') {
          yield { type: 'thought_delta', delta: (delta as Record<string, unknown>).reasoning_content as string };
        }

        // Handle streaming tool calls
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const index = tc.index;
            if (!pendingToolCalls.has(index)) {
              const newTc = {
                id: tc.id || `call_${Date.now()}_${index}`,
                name: tc.function?.name || '',
                argsString: tc.function?.arguments || '',
              };
              pendingToolCalls.set(index, newTc);
              yield { type: 'tool_call_start', id: newTc.id, name: newTc.name };
            } else {
              const existing = pendingToolCalls.get(index)!;
              if (tc.function?.name && !existing.name) {
                existing.name = tc.function.name;
              }
              if (tc.function?.arguments) {
                existing.argsString += tc.function.arguments;
                yield { type: 'tool_call_delta', id: existing.id, delta: tc.function.arguments };
              }
            }
          }
        }
      }

      if (chunk.usage) {
        yield {
          type: 'usage',
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens,
        };
      }
    }

    // Finalize all tool calls
    for (const [, tc] of pendingToolCalls) {
      let parsedArgs = {};
      try {
        parsedArgs = tc.argsString ? JSON.parse(tc.argsString) : {};
      } catch {
        parsedArgs = { raw: tc.argsString };
      }
      yield {
        type: 'tool_call_done',
        toolCall: {
          id: tc.id,
          name: tc.name,
          arguments: parsedArgs,
          rawArguments: tc.argsString,
        },
      };
    }

    yield { type: 'finish', reason: pendingToolCalls.size > 0 ? 'tool_use' : 'end_turn' };
  }
}
