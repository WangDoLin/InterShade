import type {
  HookEventType,
  HookHandler,
  PreToolUsePayload,
  PostToolUsePayload,
  ToolFailurePayload,
  TurnEndPayload,
} from './types.js';

export class HookEngine {
  private handlers: Map<HookEventType, Set<HookHandler<any>>> = new Map();

  constructor() {
    this.registerDefaultHooks();
  }

  register<T = any>(event: HookEventType, handler: HookHandler<T>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    const set = this.handlers.get(event)!;
    set.add(handler);

    return () => {
      set.delete(handler);
    };
  }

  async triggerPreToolUse(payload: PreToolUsePayload): Promise<void> {
    const handlers = this.handlers.get('pre_tool_use');
    if (!handlers) return;
    for (const h of handlers) {
      await h(payload);
    }
  }

  async triggerPostToolUse(payload: PostToolUsePayload): Promise<void> {
    const handlers = this.handlers.get('post_tool_use');
    if (!handlers) return;
    for (const h of handlers) {
      await h(payload);
    }
  }

  async triggerToolFailure(payload: ToolFailurePayload): Promise<void> {
    const handlers = this.handlers.get('post_tool_use_failure');
    if (!handlers) return;
    for (const h of handlers) {
      await h(payload);
    }
  }

  async triggerTurnEnd(payload: TurnEndPayload): Promise<void> {
    const handlers = this.handlers.get('turn_end');
    if (!handlers) return;
    for (const h of handlers) {
      await h(payload);
    }
  }

  private registerDefaultHooks(): void {
    // Built-in Hook 1: File Edit / Write tracking
    this.register<PostToolUsePayload>('post_tool_use', async (payload) => {
      if (payload.toolName === 'file_edit' || payload.toolName === 'file_write') {
        const filePath = payload.args.filePath as string;
        if (filePath && payload.context.onProgress) {
          payload.context.onProgress(`[HOOK: FILE MODIFIED] Tracked mutation on "${filePath}" for verification gating.`);
        }
      }
    });

    // Built-in Hook 2: Tool failure diagnostic reporting
    this.register<ToolFailurePayload>('post_tool_use_failure', async (payload) => {
      if (payload.context.onProgress) {
        payload.context.onProgress(
          `[HOOK: TOOL FAILURE] Tool "${payload.toolName}" encountered error: ${payload.error.message}`
        );
      }
    });
  }
}
