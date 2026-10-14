import type { SessionConfig, PermissionMode, UnifiedMessage } from '../../types/index.js';
import type { ClaudeAgentRoleType } from '../../services/agent/ClaudeAgentRoles.js';

export type SwarmRole =
  | 'architect'
  | 'backend'
  | 'frontend'
  | 'tester'
  | 'reviewer'
  | 'general';

export type SwarmSessionStatus =
  | 'idle'
  | 'planning'
  | 'running'
  | 'waiting_lease'
  | 'verifying'
  | 'completed'
  | 'failed';

export interface FileLease {
  filePath: string;
  sessionId: string;
  role: SwarmRole | ClaudeAgentRoleType;
  grantedAt: number;
  expiresAt: number;
}

export interface SwarmTask {
  id: string;
  role: SwarmRole | ClaudeAgentRoleType;
  prompt: string;
  assignedScope?: string[];
  status: SwarmSessionStatus;
  progressPercent: number;
  currentTool?: string;
  worktreePath?: string;
  branch?: string;
  leasedFiles: string[];
  resultSummary?: string;
  errorMessage?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface SwarmSessionState {
  sessionId: string;
  role: SwarmRole | ClaudeAgentRoleType;
  task: SwarmTask;
  worktreePath?: string;
  branch?: string;
  permissionMode: PermissionMode;
  totalTokens: number;
}

export interface SwarmProgressEvent {
  swarmId: string;
  tasks: SwarmTask[];
  overallStatus: 'running' | 'completed' | 'partial_failure' | 'failed';
  activeCount: number;
  completedCount: number;
  totalCount: number;
}

export interface SwarmMergeResult {
  success: boolean;
  mergedBranches: string[];
  failedBranches: Array<{ branch: string; reason: string }>;
  verificationPassed: boolean;
  testOutput?: string;
  message: string;
}
