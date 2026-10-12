import path from 'node:path';
import type { ToolRegistry } from '../tools/ToolRegistry.js';
import type { ToolExecutionContext } from '../types/index.js';
import { TimelineRewindEngine } from '../state/TimelineRewindEngine.js';

export interface BatchOperation {
  id: string;
  tool: string;
  args: Record<string, any>;
}

export interface BatchOperationResult {
  id: string;
  tool: string;
  success: boolean;
  output?: string;
  error?: string;
  durationMs: number;
}

export interface BatchExecutionSummary {
  totalOperations: number;
  succeededCount: number;
  failedCount: number;
  isAtomicRollback: boolean;
  estimatedTokensSaved: number;
  results: BatchOperationResult[];
}

export class ZeroTurnBatcher {
  /**
   * Execute an atomic batch of tool operations in a single round-trip
   */
  static async executeBatch(
    operations: BatchOperation[],
    toolRegistry: ToolRegistry,
    context: ToolExecutionContext,
    atomic: boolean = true
  ): Promise<BatchExecutionSummary> {
    const results: BatchOperationResult[] = [];
    let savepointId: string | null = null;
    let isAtomicRollback = false;

    // 1. Classify operations into read-only and mutating
    const readOps: BatchOperation[] = [];
    const mutatingOps: BatchOperation[] = [];

    for (const op of operations) {
      const toolDef = toolRegistry.get(op.tool);
      if (toolDef?.isReadOnly) {
        readOps.push(op);
      } else {
        mutatingOps.push(op);
      }
    }

    // 2. Capture WAL savepoint if any mutating operations exist
    if (mutatingOps.length > 0 && atomic) {
      const targetFiles = mutatingOps
        .map((op) => (op.args.filePath ? (path.isAbsolute(op.args.filePath) ? op.args.filePath : path.resolve(context.cwd, op.args.filePath)) : null))
        .filter((f): f is string => Boolean(f));

      if (targetFiles.length > 0) {
        savepointId = TimelineRewindEngine.createSavepoint(
          `Batch-Execute-${Date.now()}`,
          targetFiles
        );
      }
    }

    // 3. Execute read-only operations concurrently (Promise.all)
    const readPromises = readOps.map(async (op) => {
      const start = Date.now();
      const toolDef = toolRegistry.get(op.tool);
      if (!toolDef) {
        return {
          id: op.id,
          tool: op.tool,
          success: false,
          error: `Tool "${op.tool}" not found in registry.`,
          durationMs: Date.now() - start,
        };
      }

      try {
        const out = await toolDef.execute(op.args, context);
        return {
          id: op.id,
          tool: op.tool,
          success: true,
          output: typeof out === 'string' ? out : JSON.stringify(out),
          durationMs: Date.now() - start,
        };
      } catch (err: any) {
        return {
          id: op.id,
          tool: op.tool,
          success: false,
          error: err.message || String(err),
          durationMs: Date.now() - start,
        };
      }
    });

    const readResults = await Promise.all(readPromises);
    results.push(...readResults);

    // Check if any read-only op failed in atomic mode
    const anyReadFailed = readResults.some((r) => !r.success);
    if (anyReadFailed && atomic) {
      if (savepointId) {
        TimelineRewindEngine.rollback(savepointId);
        isAtomicRollback = true;
      }
      return {
        totalOperations: operations.length,
        succeededCount: results.filter((r) => r.success).length,
        failedCount: results.filter((r) => !r.success).length,
        isAtomicRollback,
        estimatedTokensSaved: 0,
        results,
      };
    }

    // 4. Execute mutating operations sequentially
    for (const op of mutatingOps) {
      const start = Date.now();
      const toolDef = toolRegistry.get(op.tool);

      if (!toolDef) {
        results.push({
          id: op.id,
          tool: op.tool,
          success: false,
          error: `Mutating tool "${op.tool}" not found in registry.`,
          durationMs: Date.now() - start,
        });

        if (atomic && savepointId) {
          TimelineRewindEngine.rollback(savepointId);
          isAtomicRollback = true;
          break;
        }
        continue;
      }

      try {
        const out = await toolDef.execute(op.args, context);
        results.push({
          id: op.id,
          tool: op.tool,
          success: true,
          output: typeof out === 'string' ? out : JSON.stringify(out),
          durationMs: Date.now() - start,
        });
      } catch (err: any) {
        results.push({
          id: op.id,
          tool: op.tool,
          success: false,
          error: err.message || String(err),
          durationMs: Date.now() - start,
        });

        if (atomic && savepointId) {
          TimelineRewindEngine.rollback(savepointId);
          isAtomicRollback = true;
          break;
        }
      }
    }

    // 5. Calculate estimated token savings
    // In multi-turn chat, each separate round trip duplicates system prompt (~2000 tokens) + history (~3000 tokens)
    const turnsCollapsed = Math.max(0, operations.length - 1);
    const estimatedTokensSaved = turnsCollapsed * 3500;

    return {
      totalOperations: operations.length,
      succeededCount: results.filter((r) => r.success).length,
      failedCount: results.filter((r) => !r.success).length,
      isAtomicRollback,
      estimatedTokensSaved,
      results,
    };
  }
}
