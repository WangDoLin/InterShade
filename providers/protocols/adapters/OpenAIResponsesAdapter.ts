import type { ProtocolAdapter } from '../ProtocolAdapter.js';
import type { ConnectionProfile } from '../../profiles/ProviderProfile.js';
import type { ModelDescriptor } from '../../catalog/ModelDescriptor.js';
import type {
  LanguageModel,
  ModelRequest,
  UnifiedStreamEvent,
} from '../../core/BaseModel.js';
import { ProviderError } from '../../core/ProviderErrors.js';
import { ConnectionRegistry } from '../../core/ConnectionRegistry.js';
import { NetworkGuard } from '../../security/NetworkGuard.js';
import { zodToJsonSchema } from '../../zodHelper.js';
import type { ToolCall } from '../../../types/index.js';

interface PendingResponsesToolCall {
  callId: string;
  name: string;
  argsString: string;
}

export class OpenAIResponsesAdapter implements ProtocolAdapter {
  readonly protocolId = 'openai-responses';

  createModel(connection: ConnectionProfile, descriptor: ModelDescriptor): LanguageModel {
    return new OpenAIResponsesLanguageModel(connection, descriptor);
  }
}

class OpenAIResponsesLanguageModel implements LanguageModel {
  readonly descriptor: ModelDescriptor;
  private readonly connection: ConnectionProfile;

  constructor(connection: ConnectionProfile, descriptor: ModelDescriptor) {
    this.connection = connection;
    this.descriptor = descriptor;
  }

  async *stream(request: ModelRequest): AsyncGenerator<UnifiedStreamEvent, void, unknown> {
    ConnectionRegistry.validateBaseURL(this.connection);
    const apiKey = ConnectionRegistry.resolveApiKey(this.connection) || 'dummy-key';
    const baseURL = (this.connection.baseURL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const endpoint = `${baseURL}/responses`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...this.connection.headers,
    };

    const payload = this.buildResponsesPayload(request);

    try {
      yield { type: 'response.start' };

      const response = await NetworkGuard.safeFetch(
        endpoint,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: request.signal,
        },
        { isLocalAllowed: this.connection.isLocalAllowed }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new ProviderError({
          code: response.status === 401 ? 'AUTH_FAILED' : response.status === 429 ? 'RATE_LIMITED' : 'SERVER_ERROR',
          message: `OpenAI Responses API error (${response.status}): ${errorText}`,
          statusCode: response.status,
          retryable: response.status === 429 || response.status >= 500,
        });
      }

      if (!response.body) {
        throw new ProviderError({
          code: 'SERVER_ERROR',
          message: 'Empty response body from OpenAI Responses API',
          retryable: true,
        });
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const pendingToolCalls = new Map<string, PendingResponsesToolCall>();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') continue;

          let parsedEvent: Record<string, unknown>;
          try {
            parsedEvent = JSON.parse(dataStr);
          } catch {
            continue;
          }

          const eventType = parsedEvent.type as string | undefined;

          if (eventType === 'response.output_item.added') {
            const item = parsedEvent.item as Record<string, unknown> | undefined;
            if (item && item.type === 'function_call') {
              const callId = (item.id as string) || (item.call_id as string) || `call_${Date.now()}`;
              const name = (item.name as string) || '';
              pendingToolCalls.set(callId, { callId, name, argsString: '' });
              yield { type: 'tool_call.start', callId, name };
            }
          } else if (eventType === 'response.output_item.delta') {
            const delta = parsedEvent.delta as Record<string, unknown> | undefined;
            if (delta) {
              if (typeof delta.text === 'string') {
                yield { type: 'text.delta', text: delta.text };
              }
              if (typeof delta.arguments === 'string') {
                const callId = (parsedEvent.item_id as string) || Array.from(pendingToolCalls.keys())[0];
                if (callId && pendingToolCalls.has(callId)) {
                  const pending = pendingToolCalls.get(callId)!;
                  pending.argsString += delta.arguments;
                  yield { type: 'tool_call.delta', callId, inputDelta: delta.arguments };
                }
              }
            }
          } else if (eventType === 'response.output_item.done') {
            const item = parsedEvent.item as Record<string, unknown> | undefined;
            if (item && item.type === 'function_call') {
              const callId = (item.id as string) || (item.call_id as string);
              const pending = callId ? pendingToolCalls.get(callId) : undefined;
              const rawArgs = pending?.argsString || (item.arguments as string) || '{}';
              let parsedArgs: Record<string, unknown> = {};
              try {
                parsedArgs = JSON.parse(rawArgs);
              } catch (parseErr) {
                throw new ProviderError({
                  code: 'INVALID_REQUEST',
                  message: `Stream corrupted: Tool call '${item.name}' arguments are invalid JSON: ${rawArgs}`,
                  retryable: true,
                  rawError: parseErr,
                });
              }

              const toolCall: ToolCall = {
                id: callId || `call_${Date.now()}`,
                name: (item.name as string) || pending?.name || '',
                arguments: parsedArgs,
                rawArguments: rawArgs,
              };
              yield { type: 'tool_call.ready', toolCall };
            }
          } else if (eventType === 'response.completed') {
            const respObj = parsedEvent.response as Record<string, unknown> | undefined;
            if (respObj?.usage) {
              const u = respObj.usage as Record<string, number>;
              yield {
                type: 'usage',
                usage: {
                  inputTokens: u.input_tokens || 0,
                  outputTokens: u.output_tokens || 0,
                },
              };
            }
            const finishReason = pendingToolCalls.size > 0 ? 'tool_use' : 'end_turn';
            yield { type: 'response.finish', reason: finishReason };
          }
        }
      }
    } catch (err) {
      const normalized = ProviderError.fromUnknown(err);
      yield { type: 'error', error: normalized };
    }
  }

  private buildResponsesPayload(request: ModelRequest): Record<string, unknown> {
    const inputItems: Array<Record<string, unknown>> = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        inputItems.push({ role: 'system', content: msg.content });
      } else if (msg.role === 'user') {
        inputItems.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        const item: Record<string, unknown> = { role: 'assistant', content: msg.content };
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          item.tool_calls = msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          }));
        }
        inputItems.push(item);
      } else if (msg.role === 'tool' && msg.toolResult) {
        inputItems.push({
          role: 'tool',
          call_id: msg.toolResult.toolCallId,
          output: msg.toolResult.content,
        });
      }
    }

    const tools = (request.tools || []).map((t) => ({
      type: 'function',
      name: t.name,
      description: t.description,
      parameters: zodToJsonSchema(t.inputSchema),
    }));

    return {
      model: request.modelId,
      input: inputItems,
      tools: tools.length > 0 ? tools : undefined,
      stream: true,
      temperature: request.generation?.temperature ?? 0.2,
      max_output_tokens: request.generation?.maxTokens ?? 16384,
    };
  }
}
