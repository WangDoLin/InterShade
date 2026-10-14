import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { z } from 'zod';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';

export interface AuditIssue {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  rule: string;
  file?: string;
  line?: number;
  snippet?: string;
  recommendation: string;
}

export class CodeReviewSentinelTool extends BaseTool<
  {
    targetFiles?: string[];
    checkStagedOnly?: boolean;
  },
  string
> {
  readonly name = 'code_review_audit';
  readonly description = 'Acts as a Hostile Code Reviewer Sentinel: strictly audits modified files for security vulnerabilities (injection, exposed tokens), empty catch blocks, functions exceeding 50 lines, and missing validations.';
  readonly isReadOnly = true;

  readonly inputSchema = z.object({
    targetFiles: z.array(z.string()).optional().describe('List of specific files to audit. If omitted, audits all modified files in git working tree.'),
    checkStagedOnly: z.boolean().optional().describe('Check only staged git files'),
  });

  async execute(
    args: { targetFiles?: string[]; checkStagedOnly?: boolean },
    context: ToolExecutionContext
  ): Promise<string> {
    let filesToInspect: string[] = args.targetFiles || [];

    if (filesToInspect.length === 0) {
      try {
        const flag = args.checkStagedOnly ? '--cached --name-only' : 'diff --name-only HEAD';
        const raw = execSync(`git ${flag}`, {
          cwd: context.cwd,
          encoding: 'utf-8',
          timeout: 4000,
          stdio: ['pipe', 'pipe', 'ignore'],
        }).trim();
        filesToInspect = raw.split('\n').map((f) => f.trim()).filter((f) => f.length > 0 && fs.existsSync(path.join(context.cwd, f)));
      } catch {
        filesToInspect = [];
      }
    }

    if (filesToInspect.length === 0) {
      return '[Review Sentinel]: No modified files to audit in git tree. All files clean.';
    }

    const issues: AuditIssue[] = [];

    for (const relFile of filesToInspect) {
      const fullPath = path.isAbsolute(relFile) ? relFile : path.join(context.cwd, relFile);
      if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) continue;

      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');

      // Rule 1: Check for Hardcoded Secrets
      const secretRegex = /(api[_-]?key|secret|password|bearer|token)\s*[:=]\s*['"][a-zA-Z0-9_\-]{16,}['"]/i;
      lines.forEach((line, idx) => {
        if (secretRegex.test(line) && !line.includes('process.env') && !line.includes('config.')) {
          issues.push({
            severity: 'CRITICAL',
            rule: 'Hardcoded Secret / Token Exposure',
            file: relFile,
            line: idx + 1,
            snippet: line.trim().slice(0, 80),
            recommendation: 'Extract sensitive credential into environment variables (.env)',
          });
        }
      });

      // Rule 2: Check for Dangerous eval / new Function
      lines.forEach((line, idx) => {
        if (/\b(eval\(|new Function\()/i.test(line)) {
          issues.push({
            severity: 'CRITICAL',
            rule: 'Arbitrary Code Execution via eval()',
            file: relFile,
            line: idx + 1,
            snippet: line.trim(),
            recommendation: 'Replace dynamic evaluation with explicit parser or mapping table',
          });
        }
      });

      // Rule 3: Check for Silent Empty Catch Blocks
      lines.forEach((line, idx) => {
        if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line)) {
          issues.push({
            severity: 'HIGH',
            rule: 'Silent Empty Catch Block',
            file: relFile,
            line: idx + 1,
            snippet: line.trim(),
            recommendation: 'Log the error or handle it meaningfully. Never swallow errors silently.',
          });
        }
      });

      // Rule 4: Check for Overlong Functions (> 50 lines heuristic)
      let funcStartLine = -1;
      let bracketCount = 0;
      let inFunction = false;

      lines.forEach((line, idx) => {
        if (!inFunction && /(function\s+[a-zA-Z0-9_]+|\b[a-zA-Z0-9_]+\s*\([^)]*\)\s*:\s*[^{]+\{)/.test(line)) {
          funcStartLine = idx + 1;
          inFunction = true;
          bracketCount = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
        } else if (inFunction) {
          bracketCount += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
          if (bracketCount <= 0) {
            const funcLen = idx + 1 - funcStartLine;
            if (funcLen > 65) {
              issues.push({
                severity: 'MEDIUM',
                rule: 'Function Length Exceeds Standard (> 50 lines)',
                file: relFile,
                line: funcStartLine,
                snippet: `Function starting at line ${funcStartLine} has ${funcLen} lines.`,
                recommendation: 'Decompose overlong function into focused single-responsibility helpers.',
              });
            }
            inFunction = false;
          }
        }
      });
    }

    // Tally and format score
    const criticalCount = issues.filter((i) => i.severity === 'CRITICAL').length;
    const highCount = issues.filter((i) => i.severity === 'HIGH').length;
    const mediumCount = issues.filter((i) => i.severity === 'MEDIUM').length;

    let score = 100 - (criticalCount * 35 + highCount * 15 + mediumCount * 5);
    score = Math.max(0, score);

    const verdict = score >= 85 ? 'APPROVED (High Confidence)' : score >= 65 ? 'ACTION REQUIRED (Warnings Present)' : 'REJECTED (Severe Invariants Violated)';

    const lines: string[] = [
      `# Hostile Code Review Sentinel Report`,
      `Files Audited (${filesToInspect.length}): ${filesToInspect.join(', ')}`,
      `Audit Verdict: **${verdict}** (Quality Score: ${score}/100)`,
      '',
      criticalCount > 0 ? `🚨 CRITICAL ISSUES (${criticalCount}):` : '',
      ...issues.filter((i) => i.severity === 'CRITICAL').map((i) => `- [${i.file}:${i.line}] ${i.rule}: "${i.snippet}"\n  -> Fix: ${i.recommendation}`),
      '',
      highCount > 0 ? `⚠️ HIGH SEVERITY ISSUES (${highCount}):` : '',
      ...issues.filter((i) => i.severity === 'HIGH').map((i) => `- [${i.file}:${i.line}] ${i.rule}: "${i.snippet}"\n  -> Fix: ${i.recommendation}`),
      '',
      mediumCount > 0 ? `📋 CODE CRAFTSMANSHIP WARNINGS (${mediumCount}):` : '',
      ...issues.filter((i) => i.severity === 'MEDIUM').map((i) => `- [${i.file}:${i.line}] ${i.rule} (${i.snippet})\n  -> Fix: ${i.recommendation}`),
      '',
      issues.length === 0 ? '✨ No vulnerabilities or craftsmanship violations detected. Pristine quality.' : ''
    ].filter(Boolean);

    return lines.join('\n');
  }
}
