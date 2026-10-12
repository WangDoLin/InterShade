import type { ToolCall, ToolExecutionContext, ToolResult } from '../types/index.js';
import type { ToolRegistry } from '../tools/ToolRegistry.js';
import type { HookEngine } from '../services/hooks/HookEngine.js';
import { PermissionEngine } from '../security/PermissionEngine.js';

export interface DispatchedToolResult {
  toolCall: ToolCall;
  resultContent: string;
  isError: boolean;
  durationMs: number;
}

export class ParallelToolDispatcher {
  /**
   * Executes a list of tool calls with optimal parallelization and permission checks:
   * - Evaluates permission rules and modes (default, plan, acceptEdits, bypass, etc.)
   * - Adjacent read-only tools are executed concurrently in parallel via Promise.allSettled()
   * - Mutating tools (file_edit, file_write, shell) are executed sequentially in deterministic order
   */
  static async dispatch(
    toolCalls: ToolCall[],
    toolRegistry: ToolRegistry,
    context: ToolExecutionContext,
    hookEngine?: HookEngine,
    onToolProgress?: (name: string, id: string, content: string, isError: boolean) => void,
    permissionEngine?: PermissionEngine
  ): Promise<DispatchedToolResult[]> {
    const permEngine = permissionEngine || new PermissionEngine(context.permissionMode);
    const results: DispatchedToolResult[] = [];

    let currentReadOnlyBatch: ToolCall[] = [];

    const flushReadOnlyBatch = async (): Promise<void> => {
      if (currentReadOnlyBatch.length === 0) return;

      const batchToExecute = [...currentReadOnlyBatch];
      currentReadOnlyBatch = [];

      const settled = await Promise.allSettled(
        batchToExecute.map(async (tc) => {
          const startTime = Date.now();
          const tool = toolRegistry.get(tc.name);

          if (!tool) {
            return {
              toolCall: tc,
              resultContent: `[ERROR]: Tool "${tc.name}" not found.`,
              isError: true,
              durationMs: Date.now() - startTime,
            };
          }

          const permCheck = permEngine.evaluate(tc.name, tc.arguments, tool.isReadOnly, tool.isDestructive);
          if (!permCheck.allowed) {
            if (permCheck.requiresPrompt && context.askConfirmation) {
              const approved = await context.askConfirmation(permCheck.reason, {
                toolName: tc.name,
                args: tc.arguments,
                reason: permCheck.reason,
              });
              if (!approved) {
                return {
                  toolCall: tc,
                  resultContent: '[PERMISSION DENIED]: User rejected permission request.',
                  isError: true,
                  durationMs: Date.now() - startTime,
                };
              }
            } else {
              return {
                toolCall: tc,
                resultContent: `[PERMISSION DENIED]: ${permCheck.reason}`,
                isError: true,
                durationMs: Date.now() - startTime,
              };
            }
          }

          try {
            if (hookEngine) {
              await hookEngine.triggerPreToolUse({
                toolName: tc.name,
                args: tc.arguments,
                context,
              });
            }

            const rawResult = await tool.execute(tc.arguments, context);
            const resultContent = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult, null, 2);

            if (hookEngine) {
              await hookEngine.triggerPostToolUse({
                toolName: tc.name,
                args: tc.arguments,
                result: resultContent,
                context,
              });
            }

            return {
              toolCall: tc,
              resultContent,
              isError: false,
              durationMs: Date.now() - startTime,
            };
          } catch (err: any) {
            const error = err as Error;
            const resultContent = `[TOOL ERROR]: ${error.message}`;

            if (hookEngine) {
              await hookEngine.triggerToolFailure({
                toolName: tc.name,
                args: tc.arguments,
                error,
                context,
              });
            }

            return {
              toolCall: tc,
              resultContent,
              isError: true,
              durationMs: Date.now() - startTime,
            };
          }
        })
      );

      for (let i = 0; i < settled.length; i++) {
        const item = settled[i];
        if (item.status === 'fulfilled') {
          results.push(item.value);
          if (onToolProgress) {
            onToolProgress(item.value.toolCall.name, item.value.toolCall.id, item.value.resultContent, item.value.isError);
          }
        } else {
          // Rejected: surface a proper error result instead of silently dropping the call
          const errorMsg = item.reason instanceof Error ? item.reason.message : String(item.reason);
          const fallbackResult: DispatchedToolResult = {
            toolCall: batchToExecute[i],
            resultContent: `[UNHANDLED ERROR]: ${errorMsg}`,
            isError: true,
            durationMs: 0,
          };
          results.push(fallbackResult);
          if (onToolProgress) {
            onToolProgress(fallbackResult.toolCall.name, fallbackResult.toolCall.id, fallbackResult.resultContent, true);
          }
        }
      }
    };

    for (const tc of toolCalls) {
      const tool = toolRegistry.get(tc.name);
      const isReadOnly = tool ? tool.isReadOnly : false;

      if (isReadOnly) {
        currentReadOnlyBatch.push(tc);
      } else {
        // Flush any pending read-only batch before running a mutating tool
        await flushReadOnlyBatch();

        // Run mutating tool sequentially
        const startTime = Date.now();
        let resultContent = '';
        let isError = false;

        if (!tool) {
          resultContent = `[ERROR]: Tool "${tc.name}" not found.`;
          isError = true;
        } else {
          const permCheck = permEngine.evaluate(tc.name, tc.arguments, tool.isReadOnly, tool.isDestructive);
          let isPermitted = permCheck.allowed;
          if (!permCheck.allowed) {
            if (permCheck.requiresPrompt && context.askConfirmation) {
              const approved = await context.askConfirmation(permCheck.reason, {
                toolName: tc.name,
                args: tc.arguments,
                reason: permCheck.reason,
              });
              if (approved) {
                isPermitted = true;
              } else {
                resultContent = '[PERMISSION DENIED]: User rejected permission request.';
                isError = true;
              }
            } else {
              resultContent = `[PERMISSION DENIED]: ${permCheck.reason}`;
              isError = true;
            }
          }

          if (isPermitted) {
            try {
              if (hookEngine) {
                await hookEngine.triggerPreToolUse({
                  toolName: tc.name,
                  args: tc.arguments,
                  context,
                });
              }

              const rawResult = await tool.execute(tc.arguments, context);
              resultContent = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult, null, 2);

              if (hookEngine) {
                await hookEngine.triggerPostToolUse({
                  toolName: tc.name,
                  args: tc.arguments,
                  result: resultContent,
                  context,
                });
              }
            } catch (err: any) {
              const error = err as Error;
              resultContent = `[TOOL ERROR]: ${error.message}`;
              isError = true;

              if (hookEngine) {
                await hookEngine.triggerToolFailure({
                  toolName: tc.name,
                  args: tc.arguments,
                  error,
                  context,
                });
              }
            }
          }
        }

        const res: DispatchedToolResult = {
          toolCall: tc,
          resultContent,
          isError,
          durationMs: Date.now() - startTime,
        };
        results.push(res);
        if (onToolProgress) {
          onToolProgress(tc.name, tc.id, resultContent, isError);
        }
      }
    }

    // Flush any remaining read-only tool batch
    await flushReadOnlyBatch();

    return results;
  }
}
