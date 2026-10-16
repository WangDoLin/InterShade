import { z } from 'zod';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';
import { PlanManager, type PlanStep } from '../../state/PlanManager.js';

export interface PlanStepInput {
  id?: string;
  title: string;
  description?: string;
  targetFiles?: string[];
  dependencies?: string[];
  changeType?: 'new' | 'modified' | 'unchanged' | 'removed';
}

const PlanStepObjectSchema = z.object({
  id: z.union([z.string(), z.number()]).optional().transform((v) => (v !== undefined ? String(v) : undefined)),
  title: z.string().optional(),
  name: z.string().optional(),
  step: z.union([z.string(), z.number()]).optional().transform((v) => (v !== undefined ? String(v) : undefined)),
  text: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  details: z.string().optional(),
  targetFiles: z
    .union([z.array(z.string()), z.string().transform((s) => [s])])
    .optional(),
  dependencies: z
    .union([
      z.array(z.union([z.string(), z.number()]).transform((v) => String(v))),
      z.string().transform((s) => [s]),
    ])
    .optional(),
  changeType: z
    .union([
      z.enum(['new', 'modified', 'unchanged', 'removed']),
      z.string().transform((ct) => {
        const lower = ct.toLowerCase().trim();
        if (['new', 'add', 'create', 'added'].includes(lower)) return 'new';
        if (['modified', 'mod', 'update', 'edit', 'changed'].includes(lower)) return 'modified';
        if (['removed', 'delete', 'del'].includes(lower)) return 'removed';
        return 'unchanged';
      }),
    ])
    .optional(),
});

const PlanStepItemSchema: z.ZodType<PlanStepInput, any, any> = z.union([
  z.string().transform((str): PlanStepInput => ({
    title: str,
    description: str,
  })),
  PlanStepObjectSchema.transform((val): PlanStepInput => {
    const res: PlanStepInput = {
      title: val.title || val.name || val.summary || val.text || (val.step ? `Step ${val.step}` : 'Plan Step'),
    };
    const idVal = val.id ?? val.step;
    if (idVal !== undefined) res.id = idVal;
    const descVal = val.description || val.details || val.text || val.summary || val.title;
    if (descVal !== undefined) res.description = descVal;
    if (val.targetFiles !== undefined) res.targetFiles = val.targetFiles;
    if (val.dependencies !== undefined) res.dependencies = val.dependencies;
    if (val.changeType !== undefined) res.changeType = val.changeType as any;
    return res;
  }),
]);

export interface PlanModeInput {
  action?: 'enter' | 'exit' | 'create' | 'update' | 'view' | 'get';
  planTitle?: string;
  planSummary?: string;
  planSteps?: PlanStepInput[];
  changesDescription?: string;
  acceptanceCriteria?: string[];
}

const PlanModeInputSchema: z.ZodType<PlanModeInput, any, any> = z.object({
  action: z
    .union([
      z.enum(['enter', 'exit', 'create', 'update', 'view', 'get']),
      z.string().transform((act) => {
        const lower = act.toLowerCase().trim();
        if (['enter', 'on', 'enable', 'start', 'in'].includes(lower)) return 'enter';
        if (['exit', 'off', 'disable', 'done', 'finish', 'complete'].includes(lower)) return 'exit';
        if (['create', 'plan', 'roadmap', 'set', 'save', 'propose', 'draft', 'new', 'generate'].includes(lower)) return 'create';
        if (['update', 'merge', 'edit', 'modify', 'add', 'append'].includes(lower)) return 'update';
        if (['view', 'get', 'show', 'status', 'inspect', 'read', 'list'].includes(lower)) return 'view';
        return 'create';
      }),
    ])
    .optional()
    .default('create'),
  planTitle: z.union([z.string(), z.number().transform(String)]).optional().describe('Title or primary objective of the plan'),
  planSummary: z.union([z.string(), z.number().transform(String)]).optional().describe('Summary of the plan or exit rationale'),
  planSteps: z.array(PlanStepItemSchema).optional().describe('Ordered atomic plan steps'),
  changesDescription: z
    .string()
    .optional()
    .describe('Explanation of what is being added or modified relative to the previous plan revision'),
  acceptanceCriteria: z
    .union([z.array(z.string()), z.string().transform((s) => [s])])
    .optional()
    .describe('Verification criteria and test requirements for this plan'),
});

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
        let steps = args.planSteps as PlanStep[] | undefined;
        if (!steps || steps.length === 0) {
          steps = [
            {
              id: '1',
              title: args.planTitle || 'Execute Architectural Objective',
              description: args.planSummary || 'Formulate and execute implementation roadmap',
            },
          ];
        }
        const plan = PlanManager.createOrReplacePlan(sessionId, {
          title: args.planTitle || 'Architectural Implementation Plan',
          overview: args.planSummary,
          steps,
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
