import path from 'node:path';

export interface VerifyOnStopOptions {
  enabled?: boolean;
  maxNudges?: number;
}

export interface VerifyCheckDecision {
  shouldBlock: boolean;
  nudgePrompt?: string;
  unverifiedFiles: string[];
  remainingNudges: number;
}

/**
 * File extensions and names considered documentation or non-executable prose
 * that do not require runtime verification before completing a turn.
 * Inspired by Hermes Agent verification_stop.py.
 */
const NON_CODE_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.mdx',
  '.rst',
  '.txt',
  '.text',
  '.log',
  '.csv',
  '.tsv',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.ico',
  '.webp',
  '.lock',
  '.gitignore',
  '.gitattributes',
  '.npmrc',
  '.dockerignore',
  '.editorconfig',
]);

const NON_CODE_FILENAMES = new Set([
  'license',
  'licence',
  'notice',
  'authors',
  'contributors',
  'changelog',
  'codeowners',
  'readme',
]);

/**
 * VerifyOnStopGuard ensures an agent does not finish a turn immediately after
 * editing code without executing fresh verification evidence (compiler diagnostics,
 * unit tests, or typechecking).
 */
export class VerifyOnStopGuard {
  private enabled: boolean;
  private maxNudges: number;
  private nudgeCount: number = 0;
  private verifiedAtTimestamp: number = 0;

  constructor(options: VerifyOnStopOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.maxNudges = options.maxNudges ?? 3;
  }

  /**
   * Determine whether a given file path is non-code/documentation.
   */
  static isNonCodePath(filePath: string): boolean {
    if (!filePath || typeof filePath !== 'string') return true;
    const ext = path.extname(filePath).toLowerCase();
    const base = path.basename(filePath, ext).toLowerCase();

    if (NON_CODE_EXTENSIONS.has(ext)) {
      return true;
    }
    if (NON_CODE_FILENAMES.has(base)) {
      return true;
    }
    return false;
  }

  /**
   * Record that a verification step (typecheck, tests, linter, or compiler diagnostics)
   * was successfully executed.
   */
  recordVerification(timestamp: number = Date.now()): void {
    this.verifiedAtTimestamp = timestamp;
  }

  /**
   * Filter a list of modified files down to only actionable code files.
   */
  filterCodeFiles(modifiedFiles: string[]): string[] {
    return modifiedFiles.filter((filePath) => !VerifyOnStopGuard.isNonCodePath(filePath));
  }

  /**
   * Evaluate whether finishing the turn is permitted or if a verification nudge is required.
   *
   * @param modifiedFiles List of files modified during the turn/session.
   * @param lastModificationTimestamp Timestamp of the most recent file edit.
   */
  evaluate(modifiedFiles: string[], lastModificationTimestamp: number = Date.now()): VerifyCheckDecision {
    if (!this.enabled) {
      return {
        shouldBlock: false,
        unverifiedFiles: [],
        remainingNudges: this.maxNudges - this.nudgeCount,
      };
    }

    const codeFiles = this.filterCodeFiles(modifiedFiles);

    // If no code files were modified or no modification timestamp recorded, verification is not required.
    if (lastModificationTimestamp === 0 || codeFiles.length === 0) {
      return {
        shouldBlock: false,
        unverifiedFiles: [],
        remainingNudges: this.maxNudges - this.nudgeCount,
      };
    }

    // If verification was recorded AFTER the last file modification, it's valid.
    if (this.verifiedAtTimestamp >= lastModificationTimestamp) {
      return {
        shouldBlock: false,
        unverifiedFiles: [],
        remainingNudges: this.maxNudges - this.nudgeCount,
      };
    }

    // If max nudges reached, do not deadlock the session.
    if (this.nudgeCount >= this.maxNudges) {
      return {
        shouldBlock: false,
        unverifiedFiles: codeFiles,
        remainingNudges: 0,
      };
    }

    // Increment nudge count and construct targeted intervention prompt
    this.nudgeCount++;
    const fileListStr = codeFiles.slice(0, 6).map((f) => `- \`${f}\``).join('\n');
    const remaining = this.maxNudges - this.nudgeCount;

    const nudgePrompt = `[VERIFY-ON-STOP GUARD POLICY]:
You modified the following code file(s) in this session:
${fileListStr}
${codeFiles.length > 6 ? `...and ${codeFiles.length - 6} other code files.\n` : ''}
However, you have not executed automated verification (such as running typecheck, unit tests, or compiler diagnostics) to verify that the changes build cleanly and function properly.

Under the "NO EVIDENCE, NO DONE" policy, please run an appropriate verification command (e.g., \`npm test\`, \`npx tsc --noEmit\`, or project test/linter scripts) to confirm your edits before completing the task. (Remaining reminders: ${remaining})`;

    return {
      shouldBlock: true,
      nudgePrompt,
      unverifiedFiles: codeFiles,
      remainingNudges: remaining,
    };
  }

  /**
   * Reset the guard state for a new turn or session.
   */
  reset(): void {
    this.nudgeCount = 0;
  }
}
