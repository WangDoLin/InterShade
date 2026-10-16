import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SkillRegistry } from '../services/skills/SkillRegistry.js';
import { ScienceSkillBridge } from '../services/skills/ScienceSkillBridge.js';
import { TaskScheduler } from '../services/scheduler/TaskScheduler.js';
import { ScheduleTaskTool } from '../tools/agentic/ScheduleTaskTool.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { ToolSearchTool } from '../tools/meta/ToolSearchTool.js';

describe('Phase 2 & Phase 3: Skills, Science Bridge & Task Scheduler', () => {
  describe('Progressive Skill Disclosure (Hermes authoring standard)', () => {
    it('should enforce description length <= 60 characters in compact catalog', () => {
      const registry = new SkillRegistry();
      const compactCatalog = registry.getCompactCatalog();

      assert.ok(compactCatalog.length > 0, 'Catalog should contain discovered skills');
      for (const skill of compactCatalog) {
        assert.ok(
          skill.description.length <= 60,
          `Skill ${skill.name} description exceeds 60 chars: "${skill.description}" (${skill.description.length})`
        );
      }
    });
  });

  describe('ScienceSkillBridge', () => {
    it('should report availability status for uv / python without crashing', () => {
      const hasUv = ScienceSkillBridge.isUvAvailable();
      assert.equal(typeof hasUv, 'boolean');
    });
  });

  describe('TaskScheduler & ScheduleTaskTool', () => {
    it('should schedule and list one-shot timers', () => {
      const scheduler = TaskScheduler.getInstance();
      const task = scheduler.scheduleTimer({
        durationSeconds: 100,
        prompt: 'Check build status',
      });

      assert.ok(task.id.startsWith('task-'));
      assert.equal(task.type, 'timer');
      assert.equal(task.status, 'active');

      const listed = scheduler.listTasks();
      const found = listed.find((t) => t.id === task.id);
      assert.ok(found);

      // Clean up by cancelling
      const cancelled = scheduler.cancel(task.id);
      assert.equal(cancelled, true);
      assert.equal(scheduler.getTask(task.id)?.status, 'cancelled');
    });

    it('should execute ScheduleTaskTool create, list, and cancel actions', async () => {
      const tool = new ScheduleTaskTool();
      const mockContext = {
        sessionId: 'test-session',
        cwd: process.cwd(),
        permissionMode: 'default' as const,
        signal: new AbortController().signal,
        askConfirmation: async () => true,
        askQuestion: async () => 'test',
      };

      // 1. Create timer
      const createRes = await tool.execute(
        {
          action: 'create',
          durationSeconds: 60,
          prompt: 'Remind user to push code',
        },
        mockContext
      );
      assert.ok(createRes.includes('Timer scheduled successfully'));
      const idMatch = createRes.match(/`task-([a-f0-9]+)`/);
      assert.ok(idMatch, 'Response should contain scheduled Task ID');
      const taskId = `task-${idMatch[1]}`;

      // 2. List timers
      const listRes = await tool.execute({ action: 'list' }, mockContext);
      assert.ok(listRes.includes(taskId));

      // 3. Cancel timer
      const cancelRes = await tool.execute({ action: 'cancel', taskId }, mockContext);
      assert.ok(cancelRes.includes('Successfully cancelled'));
    });
  });

  describe('ToolSearchTool (Deferred Tool Discovery)', () => {
    it('should search and activate deferred tools by keyword', async () => {
      const toolRegistry = new ToolRegistry();
      const searchTool = new ToolSearchTool(toolRegistry);
      const mockContext = {
        sessionId: 'test-session',
        cwd: process.cwd(),
        permissionMode: 'default' as const,
        signal: new AbortController().signal,
        askConfirmation: async () => true,
        askQuestion: async () => 'test',
      };

      const deferred = toolRegistry.getDeferredTools();
      assert.ok(deferred.length > 0, 'Deferred tools should exist');

      const firstDeferred = deferred[0];
      const searchResult = await searchTool.execute(
        { query: `select:${firstDeferred.name}` },
        mockContext
      );

      assert.ok(searchResult.includes('successfully activated'));
      const activeTools = toolRegistry.getActiveTools();
      assert.ok(activeTools.some((t) => t.name === firstDeferred.name));
    });
  });
});
