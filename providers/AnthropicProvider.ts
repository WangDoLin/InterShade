import { Anthropic } from '@anthropic-ai/sdk';
import { BaseProvider, type ChatStreamParams } from './BaseProvider.js';
import type { StreamEvent, ToolCall } from '../types/index.js';
import { zodToJsonSchema } from './zodHelper.js';

export class AnthropicProvider extends BaseProvider {
  readonly name = 'anthropic';
  private client: Anthropic;

  constructor(apiKey?: string) {
    super();
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
  }

  async *streamChat(params: ChatStreamParams): AsyncGenerator<StreamEvent, void, unknown> {
    const { model, systemPrompt, messages, tools, temperature, thinkingBudget, signal } = params;

    // Convert tools to Anthropic format
    const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: zodToJsonSchema(t.inputSchema) as Anthropic.Tool.InputSchema,
    }));

    // Enable prompt caching on the last tool to cache all tools definitions in Anthropic KV cache
    if (anthropicTools.length > 0) {
      (anthropicTools[anthropicTools.length - 1] as any).cache_control = { type: 'ephemeral' };
    }

    // Convert messages to Anthropic MessageParam format
    const anthropicMessages: Anthropic.MessageParam[] = [];
    for (const msg of messages) {
      if (msg.role === 'user') {
        anthropicMessages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        const contentBlocks: Anthropic.ContentBlockParam[] = [];
        if (msg.content) {
          contentBlocks.push({ type: 'text', text: msg.content });
        }
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            contentBlocks.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            });
          }
        }
        anthropicMessages.push({ role: 'assistant', content: contentBlocks });
      } else if (msg.role === 'tool' && msg.toolResult) {
        const toolResultBlock: Anthropic.ToolResultBlockParam = {
          type: 'tool_result',
          tool_use_id: msg.toolResult.toolCallId,
          content: msg.toolResult.content,
          is_error: msg.toolResult.isError,
        };

        const lastMsg = anthropicMessages[anthropicMessages.length - 1];
        if (lastMsg && lastMsg.role === 'user' && Array.isArray(lastMsg.content)) {
          (lastMsg.content as Anthropic.ContentBlockParam[]).push(toolResultBlock);
        } else {
          anthropicMessages.push({
            role: 'user',
            content: [toolResultBlock],
          });
        }
      }
    }

    // System prompt with Anthropic KV cache control for ultra-low TTFT
    const systemPromptBlocks: Anthropic.TextBlockParam[] = [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ];

    // Configure thinking parameters if enabled
    const isThinking = thinkingBudget && thinkingBudget > 0;

    const stream = this.client.messages.stream(
      {
        model,
        max_tokens: isThinking ? Math.max(16384, (thinkingBudget || 0) + 8192) : (params.maxTokens ?? 16384),
        system: systemPromptBlocks,
        messages: anthropicMessages,
        tools: anthropicTools.length > 0 ? anthropicTools : undefined,
        temperature: isThinking ? undefined : (temperature ?? 0.2),
        thinking: isThinking ? { type: 'enabled', budget_tokens: thinkingBudget } : undefined,
      },
      { signal }
    );

    let currentToolCall: { id: string; name: string; argsString: string } | null = null;

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_start') {
        if (chunk.content_block.type === 'tool_use') {
          currentToolCall = {
            id: chunk.content_block.id,
            name: chunk.content_block.name,
            argsString: '',
          };
          yield { type: 'tool_call_start', id: currentToolCall.id, name: currentToolCall.name };
        }
      } else if (chunk.type === 'content_block_delta') {
        if (chunk.delta.type === 'text_delta') {
          yield { type: 'text_delta', delta: chunk.delta.text };
        } else if (chunk.delta.type === 'thinking_delta') {
          yield { type: 'thought_delta', delta: chunk.delta.thinking };
        } else if (chunk.delta.type === 'input_json_delta') {
          if (currentToolCall) {
            currentToolCall.argsString += chunk.delta.partial_json;
            yield { type: 'tool_call_delta', id: currentToolCall.id, delta: chunk.delta.partial_json };
          }
        }
      } else if (chunk.type === 'content_block_stop') {
        if (currentToolCall) {
          let parsedArgs = {};
          try {
            parsedArgs = currentToolCall.argsString ? JSON.parse(currentToolCall.argsString) : {};
          } catch {
            parsedArgs = { raw: currentToolCall.argsString };
          }
          const toolCall: ToolCall = {
            id: currentToolCall.id,
            name: currentToolCall.name,
            arguments: parsedArgs,
            rawArguments: currentToolCall.argsString,
          };
          yield { type: 'tool_call_done', toolCall };
          currentToolCall = null;
        }
      }
    }

    const finalMessage = await stream.finalMessage();
    if (finalMessage.usage) {
      const u = finalMessage.usage as unknown as {
        input_tokens: number;
        output_tokens: number;
        cache_read_input_tokens?: number;
      };
      yield {
        type: 'usage',
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        cacheReadTokens: u.cache_read_input_tokens || 0,
      };
    }

    const reason =
      finalMessage.stop_reason === 'tool_use'
        ? 'tool_use'
        : finalMessage.stop_reason === 'max_tokens'
        ? 'max_tokens'
        : 'end_turn';
    yield {
      type: 'finish',
      reason,
    };
  }
}
