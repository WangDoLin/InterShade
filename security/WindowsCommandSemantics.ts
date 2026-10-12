/**
 * Windows Command Semantics Normalizer
 *
 * Modeled after Claude Code's PowerShell commandSemantics.
 * Interprets exit codes for external tools where non-zero does NOT imply failure:
 * - rg / grep: exit 1 = no matches found (not a fatal tool error)
 * - findstr: exit 1 = no matches found
 * - robocopy: 0-7 = successful copy bitfield (8+ = actual failure)
 */

export interface CommandSemanticResult {
  isError: boolean;
  message?: string;
}

export class WindowsCommandSemantics {
  /**
   * Evaluates command line, exit code, stdout, and stderr to determine
   * whether the outcome is a true error or an informational status code.
   */
  static evaluate(
    commandLine: string,
    exitCode: number,
    stdout: string,
    stderr: string
  ): CommandSemanticResult {
    const baseCommand = this.extractBaseCommand(commandLine);

    switch (baseCommand) {
      case 'rg':
      case 'grep':
      case 'findstr': {
        // Exit 0: Matches found
        // Exit 1: No matches found (clean empty result)
        // Exit >= 2: Syntax error or IO error
        if (exitCode === 0) {
          return { isError: false };
        }
        if (exitCode === 1) {
          return {
            isError: false,
            message: stdout.trim() || 'No matches found.',
          };
        }
        return {
          isError: true,
          message: stderr.trim() || `Search tool exited with error code ${exitCode}`,
        };
      }

      case 'robocopy': {
        // Robocopy uses a bitmask exit code:
        // 0: No files copied (already in sync)
        // 1: Files copied successfully
        // 2: Extra files/directories present
        // 4: Mismatched files/directories present
        // 8+: Copy failures (fatal)
        if (exitCode < 8) {
          const detail =
            exitCode === 0
              ? 'No files needed copying (already in sync).'
              : 'Files copied successfully.';
          return { isError: false, message: detail };
        }
        return {
          isError: true,
          message: `Robocopy failed with error bitmask ${exitCode}.`,
        };
      }

      default: {
        return {
          isError: exitCode !== 0,
          message:
            exitCode !== 0
              ? stderr.trim() || `Command failed with exit code ${exitCode}`
              : undefined,
        };
      }
    }
  }

  private static extractBaseCommand(commandLine: string): string {
    const trimmed = commandLine.trim();
    // Split first segment before spaces, pipes, or redirects
    const match = trimmed.match(/^[&.]?\s*([a-zA-Z0-9_\-\.]+)/);
    if (!match) return '';
    const cmd = match[1].toLowerCase();
    return cmd.endsWith('.exe') ? cmd.slice(0, -4) : cmd;
  }
}
