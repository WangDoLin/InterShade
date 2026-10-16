import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

export type TaskScheduleType = 'timer' | 'cron';
export type TaskScheduleStatus = 'active' | 'completed' | 'cancelled';

export interface ScheduledTask {
  id: string;
  type: TaskScheduleType;
  prompt: string;
  status: TaskScheduleStatus;
  createdAt: number;
  nextRunAt: number;
  durationSeconds?: number;
  cronExpression?: string;
  timerCondition?: 'never' | 'any' | string;
  iterations: number;
  maxIterations?: number;
  isDaemon?: boolean;
}

export interface ScheduleTimerOptions {
  durationSeconds: number;
  prompt: string;
  timerCondition?: 'never' | 'any' | string;
}

export interface ScheduleCronOptions {
  cronExpression: string;
  prompt: string;
  maxIterations?: number;
  isDaemon?: boolean;
}

/**
 * TaskScheduler manages one-shot timers and recurring cron schedules for agents.
 * Emits reactive events when triggers fire, integrating with TaskManager and QueryEngine.
 */
export class TaskScheduler extends EventEmitter {
  private static instance: TaskScheduler | null = null;
  private tasks: Map<string, ScheduledTask> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();

  private constructor() {
    super();
  }

  static getInstance(): TaskScheduler {
    if (!this.instance) {
      this.instance = new TaskScheduler();
    }
    return this.instance;
  }

  /**
   * Schedule a one-shot timer.
   */
  scheduleTimer(options: ScheduleTimerOptions): ScheduledTask {
    const id = `task-${randomUUID().slice(0, 8)}`;
    const now = Date.now();
    const durationMs = options.durationSeconds * 1000;

    const task: ScheduledTask = {
      id,
      type: 'timer',
      prompt: options.prompt,
      status: 'active',
      createdAt: now,
      nextRunAt: now + durationMs,
      durationSeconds: options.durationSeconds,
      timerCondition: options.timerCondition || 'never',
      iterations: 0,
      maxIterations: 1,
    };

    this.tasks.set(id, task);

    const timer = setTimeout(() => {
      this.executeTask(id);
    }, durationMs);

    this.timers.set(id, timer);
    return task;
  }

  /**
   * Schedule a recurring cron expression.
   * Parses standard 5-part cron minute intervals for local scheduling.
   */
  scheduleCron(options: ScheduleCronOptions): ScheduledTask {
    const id = `task-${randomUUID().slice(0, 8)}`;
    const now = Date.now();

    // Calculate approximate interval from cron expression (default 60s if */1, or 300s if */5)
    let intervalMs = 60000;
    const match = options.cronExpression.match(/\*\/(\d+)/);
    if (match) {
      intervalMs = parseInt(match[1], 10) * 60000;
    }

    const task: ScheduledTask = {
      id,
      type: 'cron',
      prompt: options.prompt,
      status: 'active',
      createdAt: now,
      nextRunAt: now + intervalMs,
      cronExpression: options.cronExpression,
      iterations: 0,
      maxIterations: options.maxIterations,
      isDaemon: options.isDaemon ?? false,
    };

    this.tasks.set(id, task);

    const timer = setTimeout(() => {
      this.executeCronIteration(id, intervalMs);
    }, intervalMs);

    this.timers.set(id, timer);
    return task;
  }

  private executeTask(id: string): void {
    const task = this.tasks.get(id);
    if (!task || task.status !== 'active') return;

    task.iterations++;
    task.status = 'completed';
    this.timers.delete(id);

    this.emit('trigger', task);
    this.emit('completed', id);
  }

  private executeCronIteration(id: string, intervalMs: number): void {
    const task = this.tasks.get(id);
    if (!task || task.status !== 'active') return;

    task.iterations++;
    this.emit('trigger', task);

    if (task.maxIterations && task.iterations >= task.maxIterations) {
      task.status = 'completed';
      this.timers.delete(id);
      this.emit('completed', id);
    } else {
      task.nextRunAt = Date.now() + intervalMs;
      const nextTimer = setTimeout(() => {
        this.executeCronIteration(id, intervalMs);
      }, intervalMs);
      this.timers.set(id, nextTimer);
    }
  }

  /**
   * Cancel an active timer or cron task.
   */
  cancel(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.status !== 'active') return false;

    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }

    task.status = 'cancelled';
    this.emit('cancelled', id);
    return true;
  }

  listTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values());
  }

  getTask(id: string): ScheduledTask | undefined {
    return this.tasks.get(id);
  }

  /**
   * Cancel all running tasks (cleanup).
   */
  clearAll(): void {
    for (const [id, timer] of this.timers.entries()) {
      clearTimeout(timer);
      const t = this.tasks.get(id);
      if (t) t.status = 'cancelled';
    }
    this.timers.clear();
  }
}
