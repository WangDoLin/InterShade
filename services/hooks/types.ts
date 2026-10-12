import type { ToolExecutionContext, UnifiedMessage } from '../../types/index.js';

export type HookEventType =
  | 'session_start'
  | 'session_end'
  | 'pre_tool_use'
  | 'post_tool_use'
  | 'post_tool_use_failure'
  | 'turn_end';

export interface PreToolUsePayload {
  toolName: string;
  args: Record<string, unknown>;
  context: ToolExecutionContext;
}

export interface PostToolUsePayload {
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  context: ToolExecutionContext;
}

export interface ToolFailurePayload {
  toolName: string;
  args: Record<string, unknown>;
  error: Error;
  context: ToolExecutionContext;
}

export interface TurnEndPayload {
  turnIndex: number;
  messages: UnifiedMessage[];
  context: ToolExecutionContext;
}

export type HookHandler<T = unknown> = (payload: T) => Promise<void> | void;
