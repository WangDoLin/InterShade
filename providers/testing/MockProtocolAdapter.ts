import type { ProtocolAdapter } from '../protocols/ProtocolAdapter.js';
import type { ConnectionProfile } from '../profiles/ProviderProfile.js';
import type { ModelDescriptor } from '../catalog/ModelDescriptor.js';
import type {
  LanguageModel,
  ModelRequest,
  UnifiedStreamEvent,
} from '../core/BaseModel.js';
import { ProviderError } from '../core/ProviderErrors.js';
import type { ToolCall } from '../../types/index.js';

export type MockStreamBehavior =
  | { mode: 'text'; text: string }
  | { mode: 'tool_call'; toolId: string; toolName: string; argChunks: string[] }
  | { mode: 'error'; errorType: 'rate_limit' | 'auth' | 'timeout' | 'generic' }
  | { mode: 'delay_cancel'; delayMs: number };

export class MockProtocolAdapter implements ProtocolAdapter {
  readonly protocolId = 'mock-protocol';
  private behavior: MockStreamBehavior = { mode: 'text', text: 'Hello from mock LLM' };

  setBehavior(behavior: MockStreamBehavior): void {
    this.behavior = behavior;
  }

  createModel(connection: ConnectionProfile, descriptor: ModelDescriptor): LanguageModel {
    return new MockLanguageModel(connection, descriptor, () => this.behavior);
  }
}

class MockLanguageModel implements LanguageModel {
  readonly descriptor: ModelDescriptor;
  private readonly connection: ConnectionProfile;
  private readonly getBehavior: () => MockStreamBehavior;

  constructor(
    connection: ConnectionProfile,
    descriptor: ModelDescriptor,
    getBehavior: () => MockStreamBehavior
  ) {
    this.connection = connection;
    this.descriptor = descriptor;
    this.getBehavior = getBehavior;
  }

  async *stream(request: ModelRequest): AsyncGenerator<UnifiedStreamEvent, void, unknown> {
    yield { type: 'response.start', responseId: 'mock-resp-1' };

    const behavior = this.getBehavior();

    if (behavior.mode === 'text') {
      const words = behavior.text.split(' ');
      for (const word of words) {
        if (request.signal?.aborted) {
          yield {
            type: 'error',
            error: new ProviderError({ code: 'ABORTED', message: 'Request aborted', retryable: false }),
          };
          return;
        }
        yield { type: 'text.delta', text: word + ' ' };
      }
      yield {
        type: 'usage',
        usage: { inputTokens: 10, outputTokens: words.length },
      };
      yield { type: 'response.finish', reason: 'end_turn' };
      return;
    }

    if (behavior.mode === 'tool_call') {
      yield { type: 'tool_call.start', callId: behavior.toolId, name: behavior.toolName };

      let fullArgs = '';
      for (const chunk of behavior.argChunks) {
        fullArgs += chunk;
        yield { type: 'tool_call.delta', callId: behavior.toolId, inputDelta: chunk };
      }

      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(fullArgs);
      } catch {
        parsedArgs = { raw: fullArgs };
      }

      const completedCall: ToolCall = {
        id: behavior.toolId,
        name: behavior.toolName,
        arguments: parsedArgs,
        rawArguments: fullArgs,
      };

      yield { type: 'tool_call.ready', toolCall: completedCall };
      yield { type: 'response.finish', reason: 'tool_use' };
      return;
    }

    if (behavior.mode === 'error') {
      if (behavior.errorType === 'rate_limit') {
        yield {
          type: 'error',
          error: new ProviderError({
            code: 'RATE_LIMITED',
            message: 'Rate limit exceeded: 429 Too Many Requests',
            statusCode: 429,
            retryable: true,
          }),
        };
      } else if (behavior.errorType === 'auth') {
        yield {
          type: 'error',
          error: new ProviderError({
            code: 'AUTH_FAILED',
            message: 'Authentication failed: 401 Unauthorized',
            statusCode: 401,
            retryable: false,
          }),
        };
      } else {
        yield {
          type: 'error',
          error: new ProviderError({
            code: 'SERVER_ERROR',
            message: 'Internal server error: 500',
            statusCode: 500,
            retryable: true,
          }),
        };
      }
      return;
    }

    if (behavior.mode === 'delay_cancel') {
      // Simulate delay and check abort signal
      await new Promise((resolve) => setTimeout(resolve, behavior.delayMs));
      if (request.signal?.aborted) {
        yield {
          type: 'error',
          error: new ProviderError({ code: 'ABORTED', message: 'Request aborted by client', retryable: false }),
        };
        return;
      }
      yield { type: 'text.delta', text: 'Delayed message arrived' };
      yield { type: 'response.finish', reason: 'end_turn' };
    }
  }
}
