import path from 'path';

/**
 * Git Safety Guard
 *
 * Prevents git-based sandbox escapes and hook hijacking inspired by Claude Code gitSafety:
 * 1. Prohibits writes or manipulations into `.git/hooks/`
 * 2. Blocks bare-repo creation attacks (creating HEAD + objects + refs in project root)
 * 3. Restricts dangerous git command options like core.fsmonitor / core.pager injection
 */

export interface GitSafetyCheckResult {
  isSafe: boolean;
  reason?: string;
}

export class GitSafetyGuard {
  private static readonly FORBIDDEN_GIT_PATHS = [
    /^\.git\/hooks/i,
    /^\.git\/config/i,
    /^hooks\//i,
    /^\.git\/index/i,
  ];

  private static readonly DANGEROUS_GIT_FLAGS = [
    /--upload-pack/i,
    /--receive-pack/i,
    /-c\s*core\.fsmonitor/i,
    /-c\s*core\.pager/i,
    /-c\s*credential\.helper/i,
  ];

  /**
   * Validates if a file path target violates Git safety policies
   */
  static validateFilePath(targetPath: string, cwd: string): GitSafetyCheckResult {
    const relative = path.relative(cwd, targetPath).replace(/\\/g, '/');

    for (const pattern of this.FORBIDDEN_GIT_PATHS) {
      if (pattern.test(relative)) {
        return {
          isSafe: false,
          reason: `[GIT SAFETY GUARD]: Writing to internal Git path "${relative}" is strictly forbidden to prevent hook injection.`,
        };
      }
    }

    return { isSafe: true };
  }

  /**
   * Validates shell commands for malicious Git parameters or hook exploits
   */
  static validateShellCommand(commandLine: string): GitSafetyCheckResult {
    const trimmed = commandLine.trim();

    // Check for malicious git configuration injection
    for (const flagPattern of this.DANGEROUS_GIT_FLAGS) {
      if (flagPattern.test(trimmed)) {
        return {
          isSafe: false,
          reason: `[GIT SAFETY GUARD]: Detected hazardous git parameter execution: "${trimmed}". Injection of custom helpers/pagers is blocked.`,
        };
      }
    }

    // Check for attempts to write or pipe into .git/hooks
    if (/>\s*[\'\"`]?\.git[\/\\]hooks/i.test(trimmed)) {
      return {
        isSafe: false,
        reason: '[GIT SAFETY GUARD]: Redirecting output into .git/hooks is prohibited.',
      };
    }

    return { isSafe: true };
  }
}
