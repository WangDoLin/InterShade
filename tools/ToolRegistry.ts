import type { ToolDefinition } from '../types/index.js';
import { FileReadTool } from './filesystem/FileReadTool.js';
import { FileEditTool } from './filesystem/FileEditTool.js';
import { FileWriteTool } from './filesystem/FileWriteTool.js';
import { GrepTool } from './search/GrepTool.js';
import { GlobTool } from './search/GlobTool.js';
import { ShellTool } from './execution/ShellTool.js';
import { AskUserTool } from './agentic/AskUserTool.js';
import { PlanModeTool } from './agentic/PlanModeTool.js';
import { SubagentTool } from './agentic/SubagentTool.js';
import { RepomixTool } from './context/RepomixTool.js';
import { SemanticSearchTool } from './search/SemanticSearchTool.js';
import { TaskTool } from './task/TaskTool.js';
import { ToolSearchTool } from './meta/ToolSearchTool.js';
import { MemorySearchTool } from './search/MemorySearchTool.js';
import { MemoryRecordTool } from './search/MemoryRecordTool.js';
import { SkillDiscoveryTool } from './agentic/SkillDiscoveryTool.js';
import { SkillActivateTool } from './agentic/SkillActivateTool.js';
import { SkillAuditTool } from './agentic/SkillAuditTool.js';
import { LspTool } from './code/LspTool.js';
import { BatchExecuteTool } from './execution/BatchExecuteTool.js';
import { GitCommitTool } from './execution/GitCommitTool.js';
import { RepoMapTool } from './context/RepoMapTool.js';
import { CodeReviewSentinelTool } from './code/CodeReviewSentinelTool.js';
import { ScheduleTaskTool } from './agentic/ScheduleTaskTool.js';

import { WebFetchTool } from './web/WebFetchTool.js';
import {
  SerenaOutlineTool,
  SerenaDefinitionTool,
  SerenaReferencesTool,
  SerenaDiagnosticsTool,
} from './semantic/SemanticTools.js';
import {
  ReachWebSearchTool,
  ReachWebReadTool,
  ReachGithubResearchTool,
  ReachDoctorTool,
} from './reach/ReachTools.js';
import {
  OrcaWorktreeCreateTool,
  OrcaWorktreeListTool,
  OrcaWorktreeDiffTool,
  OrcaWorktreeCleanupTool,
} from './orchestration/OrchestrationTools.js';

export class ToolRegistry {
  private tools: Map<string, ToolDefinition<any, any>> = new Map();
  private activeDeferredTools: Set<string> = new Set();

  constructor() {
    this.registerDefaultTools();
  }

  private registerDefaultTools(): void {
    // Core tools (always active)
    this.register(new FileReadTool());
    this.register(new FileEditTool());
    this.register(new FileWriteTool());
    this.register(new GrepTool());
    this.register(new GlobTool());
    this.register(new ShellTool());
    this.register(new AskUserTool());
    this.register(new PlanModeTool());
    this.register(new TaskTool());
    this.register(new ScheduleTaskTool());
    this.register(new ToolSearchTool(this));
    this.register(new MemorySearchTool());
    this.register(new MemoryRecordTool());
    this.register(new SkillDiscoveryTool());
    this.register(new SkillActivateTool());
    this.register(new SkillAuditTool());
    this.register(new LspTool());
    this.register(new BatchExecuteTool(this));
    this.register(new GitCommitTool());
    this.register(new RepoMapTool());
    this.register(new CodeReviewSentinelTool());

    // Serena Semantic Engine tools
    this.register(new SerenaOutlineTool());
    this.register(new SerenaDefinitionTool());
    this.register(new SerenaReferencesTool());
    this.register(new SerenaDiagnosticsTool());

    // Agent Reach tools
    this.register(new ReachWebSearchTool());
    this.register(new ReachWebReadTool());
    this.register(new ReachGithubResearchTool());
    this.register(new ReachDoctorTool());

    // Orca Worktree Orchestrator tools
    this.register(new OrcaWorktreeCreateTool());
    this.register(new OrcaWorktreeListTool());
    this.register(new OrcaWorktreeDiffTool());
    this.register(new OrcaWorktreeCleanupTool());

    // Deferred tools (activated on-demand)
    this.register(new SubagentTool());
    this.register(new RepomixTool());
    this.register(new SemanticSearchTool());
    this.register(new WebFetchTool());
  }

  register(tool: ToolDefinition<any, any>): void {
    this.tools.set(tool.name, tool);
  }

  activateDeferredTool(name: string): boolean {
    if (this.tools.has(name)) {
      this.activeDeferredTools.add(name);
      return true;
    }
    return false;
  }

  get(name: string): ToolDefinition<any, any> | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition<any, any>[] {
    return Array.from(this.tools.values());
  }

  getActiveTools(): ToolDefinition<any, any>[] {
    return Array.from(this.tools.values()).filter(
      (t) => !t.isDeferred || this.activeDeferredTools.has(t.name)
    );
  }

  getDeferredTools(): ToolDefinition<any, any>[] {
    return Array.from(this.tools.values()).filter((t) => t.isDeferred);
  }
}
