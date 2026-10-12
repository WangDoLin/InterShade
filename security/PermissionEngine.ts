import { RuleMatcher, type ParsedRule } from './RuleMatcher.js';
import type { PermissionMode } from '../types/index.js';

export type ExtendedPermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'dontAsk'
  | 'plan'
  | 'auto';

export interface PermissionCheckResult {
  allowed: boolean;
  requiresPrompt: boolean;
  reason: string;
}

export class PermissionEngine {
  private mode: ExtendedPermissionMode;
  private allowRules: ParsedRule[] = [];
  private denyRules: ParsedRule[] = [];

  private static readonly VALID_MODES: ReadonlySet<string> = new Set([
    'default',
    'acceptEdits',
    'bypassPermissions',
    'dontAsk',
    'plan',
    'auto',
  ]);

  constructor(mode: ExtendedPermissionMode = 'default') {
    this.mode = PermissionEngine.VALID_MODES.has(mode) ? mode : 'default';
  }

  setMode(mode: ExtendedPermissionMode): void {
    if (!PermissionEngine.VALID_MODES.has(mode)) {
      throw new Error(`Security Exception: Invalid permission mode "${mode}". Must be one of: ${Array.from(PermissionEngine.VALID_MODES).join(', ')}`);
    }
    this.mode = mode;
  }

  getMode(): ExtendedPermissionMode {
    return this.mode;
  }

  addAllowRule(pattern: string): void {
    this.allowRules.push(RuleMatcher.parseRule(pattern, true));
  }

  addDenyRule(pattern: string): void {
    this.denyRules.push(RuleMatcher.parseRule(pattern, false));
  }

  /**
   * Evaluates if a tool invocation is allowed, needs confirmation, or is denied.
   */
  evaluate(
    toolName: string,
    args: Record<string, unknown>,
    isReadOnly: boolean = false,
    isDestructive: boolean = false
  ): PermissionCheckResult {
    // 1. Check Deny Rules first
    for (const rule of this.denyRules) {
      if (RuleMatcher.matches(rule, toolName, args)) {
        return {
          allowed: false,
          requiresPrompt: false,
          reason: `Blocked by explicit deny rule: "${rule.raw}"`,
        };
      }
    }

    // 2. Check Allow Rules next
    for (const rule of this.allowRules) {
      if (RuleMatcher.matches(rule, toolName, args)) {
        return {
          allowed: true,
          requiresPrompt: false,
          reason: `Approved by explicit allow rule: "${rule.raw}"`,
        };
      }
    }

    // 3. Evaluate by Permission Mode
    switch (this.mode) {
      case 'bypassPermissions':
        return {
          allowed: true,
          requiresPrompt: false,
          reason: 'Bypass mode: All operations auto-allowed.',
        };

      case 'plan':
        if (!isReadOnly) {
          return {
            allowed: false,
            requiresPrompt: false,
            reason: 'Plan Mode active: Mutating operations are strictly forbidden.',
          };
        }
        return {
          allowed: true,
          requiresPrompt: false,
          reason: 'Plan Mode: Read-only tool permitted.',
        };

      case 'acceptEdits':
        if (toolName === 'file_edit' || toolName === 'file_write') {
          return {
            allowed: true,
            requiresPrompt: false,
            reason: 'acceptEdits mode: File modifications auto-approved.',
          };
        }
        if (isDestructive) {
          return {
            allowed: false,
            requiresPrompt: true,
            reason: 'Destructive shell command requires confirmation in acceptEdits mode.',
          };
        }
        return {
          allowed: true,
          requiresPrompt: false,
          reason: 'Standard tool allowed in acceptEdits mode.',
        };

      case 'dontAsk':
        if (isDestructive || (!isReadOnly && this.isSuspiciousCommand(args))) {
          return {
            allowed: false,
            requiresPrompt: false,
            reason: 'dontAsk mode: Unconfirmed potentially dangerous operation auto-denied.',
          };
        }
        return {
          allowed: true,
          requiresPrompt: false,
          reason: 'Operation permitted in dontAsk mode.',
        };

      case 'auto': {
        const risk = this.assessRisk(toolName, args, isReadOnly, isDestructive);
        if (risk === 'high') {
          return {
            allowed: false,
            requiresPrompt: true,
            reason: 'Auto mode: High-risk operation flagged for confirmation.',
          };
        }
        return {
          allowed: true,
          requiresPrompt: false,
          reason: `Auto mode: Risk assessed as ${risk}. Approved.`,
        };
      }

      case 'default':
      default:
        if (isDestructive || this.isSuspiciousCommand(args)) {
          return {
            allowed: false,
            requiresPrompt: true,
            reason: 'Confirmation required for potentially destructive command.',
          };
        }
        return {
          allowed: true,
          requiresPrompt: false,
          reason: 'Standard operation permitted in default mode.',
        };
    }
  }

  private isSuspiciousCommand(args: Record<string, unknown>): boolean {
    const cmd = String(args.command || '');
    if (!cmd) return false;
    const lower = cmd.toLowerCase();
    const dangerousPatterns = [
      'rm -rf',
      'rm -r /',
      'del /f /s /q',
      'format ',
      'drop database',
      'drop table',
      'git reset --hard',
      ':(){ :|:& };:',
    ];
    return dangerousPatterns.some((pattern) => lower.includes(pattern));
  }

  private assessRisk(
    toolName: string,
    args: Record<string, unknown>,
    isReadOnly: boolean,
    isDestructive: boolean
  ): 'low' | 'medium' | 'high' {
    if (isReadOnly) return 'low';
    if (this.isSuspiciousCommand(args)) return 'high';
    if (toolName === 'file_write') {
      const isOverwrite = Boolean(args.overwrite);
      return isOverwrite ? 'high' : 'medium';
    }
    if (isDestructive) return 'high';
    if (toolName === 'run_shell_command') return 'medium';
    return 'low';
  }
}
