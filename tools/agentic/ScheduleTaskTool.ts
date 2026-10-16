import { z } from 'zod';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';
import { TaskScheduler } from '../../services/scheduler/TaskScheduler.js';

const ScheduleTaskInputSchema = z.object({
  action: z
    .enum(['create', 'cancel', 'list'])
    .optional()
    .describe('Action to perform: "create" to schedule a new task, "cancel" to abort a task, or "list" to view active schedules.'),
  prompt: z
    .string()
    .optional()
    .describe('The notification message/prompt to send to the agent when the timer expires or cron triggers.'),
  durationSeconds: z
    .number()
    .optional()
    .describe('For one-shot timers: Number of seconds to wait before triggering notification.'),
  cronExpression: z
    .string()
    .optional()
    .describe('For recurring schedules: Standard cron expression (e.g., "*/5 * * * *" for every 5 minutes).'),
  timerCondition: z
    .string()
    .optional()
    .describe('When a timer should early terminate ("never", "any", or a specific task-id).'),
  maxIterations: z
    .number()
    .optional()
    .describe('Maximum number of times a recurring cron schedule will fire.'),
  taskId: z
    .string()
    .optional()
    .describe('Task ID to cancel when action is "cancel".'),
});

type ScheduleTaskInput = z.infer<typeof ScheduleTaskInputSchema>;

export class ScheduleTaskTool extends BaseTool<ScheduleTaskInput, string> {
  readonly name = 'schedule_task';
  readonly description =
    'Schedule a one-shot timer or recurring cron job to send background notifications or reminders to the agent.';
  readonly inputSchema = ScheduleTaskInputSchema;
  readonly isReadOnly = false;
  readonly isDestructive = false;
  readonly requiresPermission = false;

  async execute(args: ScheduleTaskInput, context: ToolExecutionContext): Promise<string> {
    const scheduler = TaskScheduler.getInstance();
    const action = args.action || 'create';

    if (action === 'list') {
      const tasks = scheduler.listTasks();
      if (tasks.length === 0) {
        return 'No scheduled tasks currently active.';
      }
      const lines = tasks.map((t) => {
        const nextIn = Math.max(0, Math.round((t.nextRunAt - Date.now()) / 1000));
        return `- **${t.id}** [${t.type}] Status: ${t.status} | Next run in: ${nextIn}s | Prompt: "${t.prompt}" (Iterations: ${t.iterations}${t.maxIterations ? `/${t.maxIterations}` : ''})`;
      });
      return `### Scheduled Tasks (${tasks.length}):\n${lines.join('\n')}`;
    }

    if (action === 'cancel') {
      if (!args.taskId) {
        return '[SCHEDULE ERROR]: "taskId" is required when action is "cancel".';
      }
      const success = scheduler.cancel(args.taskId);
      if (success) {
        return `Successfully cancelled scheduled task: ${args.taskId}`;
      }
      return `Task "${args.taskId}" not found or already completed/cancelled.`;
    }

    // Action === 'create'
    if (!args.prompt) {
      return '[SCHEDULE ERROR]: "prompt" is required when scheduling a task.';
    }

    if (!args.durationSeconds && !args.cronExpression) {
      return '[SCHEDULE ERROR]: Either "durationSeconds" (for timers) or "cronExpression" (for crons) must be specified.';
    }

    if (args.durationSeconds) {
      const task = scheduler.scheduleTimer({
        durationSeconds: args.durationSeconds,
        prompt: args.prompt,
        timerCondition: args.timerCondition,
      });

      if (context.onProgress) {
        context.onProgress(`Scheduled one-shot timer (${task.id}) for ${args.durationSeconds}s`);
      }

      return `Timer scheduled successfully!\n- **Task ID**: \`${task.id}\`\n- **Duration**: ${args.durationSeconds}s\n- **Prompt**: "${task.prompt}"\n- **Condition**: ${task.timerCondition}`;
    }

    if (args.cronExpression) {
      const task = scheduler.scheduleCron({
        cronExpression: args.cronExpression,
        prompt: args.prompt,
        maxIterations: args.maxIterations,
      });

      if (context.onProgress) {
        context.onProgress(`Scheduled cron job (${task.id}) with pattern: ${args.cronExpression}`);
      }

      return `Cron job scheduled successfully!\n- **Task ID**: \`${task.id}\`\n- **Expression**: \`${task.cronExpression}\`\n- **Prompt**: "${task.prompt}"\n- **Max Iterations**: ${args.maxIterations || 'Unlimited'}`;
    }

    return '[SCHEDULE ERROR]: Invalid schedule parameters.';
  }
}
