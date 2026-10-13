import { z } from 'zod';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';
import { PlanManager, type PlanStep } from '../../state/PlanManager.js';

const PlanStepSchema = z.object({
  id: z.string().optional().describe('Step ID or number (e.g. "1", "2")'),
  title: z.string().describe('Short title of the step'),
  description: z.string().optional().describe('Details of what needs to be implemented or investigated'),
  targetFiles: z.array(z.string()).optional().describe('Target files affected by this step'),
  dependencies: z.array(z.string()).optional().describe('Prior step IDs required before this step'),
  changeType: z
    .enum(['new', 'modified', 'unchanged', 'removed'])
    .optional()
    .describe('Change classification relative to previous plan revision'),
});

const PlanModeInputSchema = z.object({
  action: z
    .enum(['enter', 'exit', 'create', 'update', 'view', 'get'])
    .describe('Action: "enter" or "exit" Plan Mode; "create" a new plan; "update" to merge additions/modifications into existing plan; "view" or "get" to inspect active plan'),
  planTitle: z.string().optional().describe('Title or primary objective of the plan'),
  planSummary: z.string().optional().describe('Summary of the plan or exit rationale'),
  planSteps: z.array(PlanStepSchema).optional().describe('Ordered atomic plan steps'),
  changesDescription: z
    .string()
    .optional()
    .describe('Explanation of what is being added or modified relative to the previous plan revision'),
  acceptanceCriteria: z
    .array(z.string())
    .optional()
    .describe('Verification criteria and test requirements for this plan'),
});

type PlanModeInput = z.infer<typeof PlanModeInputSchema>;

export class PlanModeTool extends BaseTool<PlanModeInput, string> {
  readonly name = 'plan_mode';
  readonly description =
    'Manage Plan Mode and maintain active architectural plans. Supports entering/exiting safe read-only plan mode, creating plans, incrementally merging additions or modifications with previous plans, and viewing active plan revisions.';
  readonly isReadOnly = true;
  readonly inputSchema = PlanModeInputSchema;

  async execute(args: PlanModeInput, context: ToolExecutionContext): Promise<string> {
    const sessionId = context.sessionId;

    switch (args.action) {
      case 'enter': {
        context.permissionMode = 'plan';
        const activePlan = PlanManager.getActivePlan(sessionId);
        let notice = '[PLAN MODE ON]: Write tools and shell execution are locked to read-only. Investigate code and formulate/refine implementation plan.';
        if (activePlan) {
          notice += `\n\nExisting Active Plan Found (v${activePlan.currentVersion}): "${activePlan.title}".\nWhen modifying, use action="update" to seamlessly merge new requirements into this plan.`;
        }
        return notice;
      }

      case 'exit': {
        context.permissionMode = 'default';
        let plan = PlanManager.getActivePlan(sessionId);
        if (args.planSteps && args.planSteps.length > 0) {
          plan = PlanManager.mergePlan(sessionId, {
            title: args.planTitle,
            overview: args.planSummary,
            steps: args.planSteps as PlanStep[],
            changelog: args.changesDescription ? [args.changesDescription] : undefined,
            acceptanceCriteria: args.acceptanceCriteria,
          });
        }
        const planMarkdown = plan
          ? PlanManager.formatPlanMarkdown(plan, { showChangelog: true })
          : args.planSummary || 'Proceeding with execution.';
        return `[PLAN MODE OFF]: Execution unlocked. Plan established:\n\n${planMarkdown}`;
      }

      case 'create': {
        if (!args.planSteps || args.planSteps.length === 0) {
          throw new Error('Field "planSteps" is required when action="create".');
        }
        const plan = PlanManager.createOrReplacePlan(sessionId, {
          title: args.planTitle || 'Architectural Implementation Plan',
          overview: args.planSummary,
          steps: args.planSteps as PlanStep[],
          acceptanceCriteria: args.acceptanceCriteria,
        });

        if (context.onProgress) {
          context.onProgress(`Created active plan v1 with ${plan.steps.length} steps`);
        }

        return `[PLAN CREATED (v1)]: "${plan.title}"\n\n${PlanManager.formatPlanMarkdown(plan, { showChangelog: false })}`;
      }

      case 'update': {
        const plan = PlanManager.mergePlan(sessionId, {
          title: args.planTitle,
          overview: args.planSummary,
          steps: args.planSteps as PlanStep[],
          additionsOrChangesText: args.changesDescription,
          acceptanceCriteria: args.acceptanceCriteria,
        });

        if (context.onProgress) {
          context.onProgress(`Merged plan into revision v${plan.currentVersion} (${plan.steps.length} steps)`);
        }

        return `[PLAN UPDATED & MERGED (v${plan.currentVersion})]: "${plan.title}"\n\n${PlanManager.formatPlanMarkdown(plan, { showChangelog: true })}`;
      }

      case 'view':
      case 'get': {
        const plan = PlanManager.getActivePlan(sessionId);
        if (!plan) {
          return '[PLAN NOTICE]: No active plan has been established for this session yet. Use action="create" or "enter" to begin planning.';
        }
        return PlanManager.formatPlanMarkdown(plan, { showChangelog: true });
      }

      default: {
        return '[PLAN MODE]: Unrecognized action.';
      }
    }
  }
}
