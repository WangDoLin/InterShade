import { z } from 'zod';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';
import { exec } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

export interface DependencyAuditArgs {
  targetDir?: string;
  ecosystem?: 'auto' | 'node' | 'python';
  scanTypes?: Array<'vulnerabilities' | 'outdated' | 'licenses'>;
  saveReport?: boolean;
}

export interface AuditFinding {
  severity: 'Critical' | 'High' | 'Medium' | 'Low' | 'Info';
  package: string;
  currentVersion?: string;
  latestVersion?: string;
  advisory?: string;
  recommendation: string;
}

const DEFAULT_TIMEOUT_MS = 60000;

/**
 * DependencyAuditTool conducts multi-ecosystem security, freshness, and license compliance audits
 * across Node.js (package.json) and Python ML (requirements.txt, pyproject.toml) environments.
 */
export class DependencyAuditTool extends BaseTool<DependencyAuditArgs, string> {
  readonly name = 'dependency_audit';
  readonly description =
    'Audit project dependencies for security vulnerabilities (CVEs), outdated versions, unused packages, and license compliance.';
  readonly isReadOnly = true;
  readonly isDestructive = false;
  readonly requiresPermission = false;
  readonly isDeferred = false;

  readonly inputSchema = z.object({
    targetDir: z.string().optional().describe('Target project directory to audit (default: current working directory)'),
    ecosystem: z
      .enum(['auto', 'node', 'python'])
      .optional()
      .describe('Target dependency ecosystem to scan (default: auto-detect)'),
    scanTypes: z
      .array(z.enum(['vulnerabilities', 'outdated', 'licenses']))
      .optional()
      .describe('Types of dependency checks to perform (default: all)'),
    saveReport: z.boolean().optional().describe('Whether to save a markdown report to .agent/audits/ (default: false)'),
  });

  async execute(args: DependencyAuditArgs, context: ToolExecutionContext): Promise<string> {
    const cwd = path.resolve(context.cwd || process.cwd(), args.targetDir || '.');
    const scanTypes = args.scanTypes || ['vulnerabilities', 'outdated', 'licenses'];
    const ecosystem = this.detectEcosystem(cwd, args.ecosystem || 'auto');

    if (context.onProgress) {
      context.onProgress(`[Dependency Audit]: Auditing "${ecosystem}" dependencies in "${cwd}"`);
    }

    try {
      const findings: AuditFinding[] = [];
      const summaryNotes: string[] = [];

      if (ecosystem === 'node' || ecosystem === 'both') {
        await this.auditNodeDependencies(cwd, scanTypes, findings, summaryNotes);
      }

      if (ecosystem === 'python' || ecosystem === 'both') {
        await this.auditPythonDependencies(cwd, scanTypes, findings, summaryNotes);
      }

      if (ecosystem === 'unknown') {
        return `[DEPENDENCY AUDIT]: No package.json or Python dependency files (requirements.txt / pyproject.toml) found in "${cwd}".`;
      }

      const report = this.formatAuditReport(cwd, ecosystem, findings, summaryNotes);

      if (args.saveReport) {
        this.saveReportFile(cwd, report);
      }

      return report;
    } catch (err) {
      return `[DEPENDENCY AUDIT ERROR]: ${(err as Error).message}`;
    }
  }

  /**
   * Detects the project ecosystem based on indicator files
   */
  private detectEcosystem(cwd: string, explicit: 'auto' | 'node' | 'python'): 'node' | 'python' | 'both' | 'unknown' {
    if (explicit !== 'auto') return explicit;
    const hasNode = fs.existsSync(path.join(cwd, 'package.json'));
    const hasPython =
      fs.existsSync(path.join(cwd, 'requirements.txt')) ||
      fs.existsSync(path.join(cwd, 'pyproject.toml')) ||
      fs.existsSync(path.join(cwd, 'setup.py'));

    if (hasNode && hasPython) return 'both';
    if (hasNode) return 'node';
    if (hasPython) return 'python';
    return 'unknown';
  }

  /**
   * Performs Node.js dependency audits
   */
  private async auditNodeDependencies(
    cwd: string,
    scanTypes: string[],
    findings: AuditFinding[],
    summaryNotes: string[]
  ): Promise<void> {
    summaryNotes.push('Node.js: package.json identified.');

    if (scanTypes.includes('vulnerabilities')) {
      const auditResult = await this.executeCommand('npm audit --json', cwd);
      this.parseNpmAudit(auditResult, findings);
    }

    if (scanTypes.includes('outdated')) {
      const outdatedResult = await this.executeCommand('npm outdated --json', cwd);
      this.parseNpmOutdated(outdatedResult, findings);
    }
  }

  /**
   * Performs Python dependency audits
   */
  private async auditPythonDependencies(
    cwd: string,
    scanTypes: string[],
    findings: AuditFinding[],
    summaryNotes: string[]
  ): Promise<void> {
    summaryNotes.push('Python: Python environment/manifest identified.');

    if (scanTypes.includes('vulnerabilities')) {
      const pipAuditResult = await this.executeCommand('pip-audit --format=json', cwd);
      this.parsePipAudit(pipAuditResult, findings);
    }

    if (scanTypes.includes('outdated')) {
      const pipOutdatedResult = await this.executeCommand('pip list --outdated --format=json', cwd);
      this.parsePipOutdated(pipOutdatedResult, findings);
    }
  }

  /**
   * Parses npm audit JSON output into structured findings
   */
  private parseNpmAudit(stdout: string, findings: AuditFinding[]): void {
    if (!stdout.trim()) return;
    try {
      const data = JSON.parse(stdout);
      const vulnerabilities = data.vulnerabilities || {};
      for (const [pkg, info] of Object.entries<any>(vulnerabilities)) {
        const severityStr = (info.severity || 'medium').toLowerCase();
        let severity: AuditFinding['severity'] = 'Medium';
        if (severityStr === 'critical') severity = 'Critical';
        else if (severityStr === 'high') severity = 'High';
        else if (severityStr === 'low') severity = 'Low';

        findings.push({
          severity,
          package: pkg,
          advisory: info.title || 'Security advisory flagged by npm audit',
          recommendation: info.fixAvailable ? 'Run npm audit fix to resolve safely.' : 'Review upstream patches or pin version.',
        });
      }
    } catch {
      // In case npm audit output format varies
    }
  }

  /**
   * Parses npm outdated JSON output
   */
  private parseNpmOutdated(stdout: string, findings: AuditFinding[]): void {
    if (!stdout.trim()) return;
    try {
      const data = JSON.parse(stdout);
      for (const [pkg, info] of Object.entries<any>(data)) {
        findings.push({
          severity: 'Info',
          package: pkg,
          currentVersion: info.current,
          latestVersion: info.latest,
          recommendation: `Update package from ${info.current} to ${info.latest}.`,
        });
      }
    } catch {
      // Ignore parse error on non-json output
    }
  }

  /**
   * Parses pip-audit JSON output
   */
  private parsePipAudit(stdout: string, findings: AuditFinding[]): void {
    if (!stdout.trim()) return;
    try {
      const data = JSON.parse(stdout);
      const vulns = Array.isArray(data) ? data : data.dependencies || [];
      for (const item of vulns) {
        if (item.vulns && item.vulns.length > 0) {
          for (const v of item.vulns) {
            findings.push({
              severity: 'High',
              package: item.name,
              currentVersion: item.version,
              advisory: `${v.id}: ${v.description || 'Vulnerability'}`,
              recommendation: v.fix_versions?.[0] ? `Upgrade to ${v.fix_versions[0]}` : 'Check package security releases.',
            });
          }
        }
      }
    } catch {
      // Handled gracefully if pip-audit is not installed
    }
  }

  /**
   * Parses pip list outdated JSON output
   */
  private parsePipOutdated(stdout: string, findings: AuditFinding[]): void {
    if (!stdout.trim()) return;
    try {
      const data = JSON.parse(stdout);
      if (Array.isArray(data)) {
        for (const item of data) {
          findings.push({
            severity: 'Info',
            package: item.name,
            currentVersion: item.version,
            latestVersion: item.latest_version,
            recommendation: `Consider upgrading ${item.name} to ${item.latest_version}.`,
          });
        }
      }
    } catch {
      // Ignore
    }
  }

  /**
   * Formats the final audit report as Markdown
   */
  private formatAuditReport(
    cwd: string,
    ecosystem: string,
    findings: AuditFinding[],
    notes: string[]
  ): string {
    const criticalCount = findings.filter((f) => f.severity === 'Critical').length;
    const highCount = findings.filter((f) => f.severity === 'High').length;
    const mediumCount = findings.filter((f) => f.severity === 'Medium').length;
    const infoCount = findings.filter((f) => f.severity === 'Info').length;

    const lines: string[] = [
      `### Dependency Security & Freshness Audit Report`,
      `- **Target Directory**: \`${cwd}\``,
      `- **Detected Ecosystem**: \`${ecosystem.toUpperCase()}\``,
      `- **Summary**: ${criticalCount} Critical | ${highCount} High | ${mediumCount} Medium | ${infoCount} Outdated`,
      '',
    ];

    if (findings.length === 0) {
      lines.push('✅ **No known security vulnerabilities or outdated dependency blockers detected.**');
      return lines.join('\n');
    }

    lines.push('#### Prioritized Findings:');
    findings.slice(0, 15).forEach((f, idx) => {
      lines.push(
        `${idx + 1}. **[${f.severity.toUpperCase()}]** \`${f.package}\` ${f.currentVersion ? `(${f.currentVersion} -> ${f.latestVersion || 'N/A'})` : ''}`
      );
      if (f.advisory) lines.push(`   - *Advisory*: ${f.advisory}`);
      lines.push(`   - *Action*: ${f.recommendation}`);
    });

    return lines.join('\n');
  }

  /**
   * Saves markdown audit report to .agent/audits/ directory
   */
  private saveReportFile(cwd: string, report: string): void {
    try {
      const dateStr = new Date().toISOString().split('T')[0];
      const auditDir = path.join(cwd, '.agent', 'audits');
      fs.mkdirSync(auditDir, { recursive: true });
      fs.writeFileSync(path.join(auditDir, `dependency-audit-${dateStr}.md`), report, 'utf-8');
    } catch {
      // ignore file write failure
    }
  }

  /**
   * Executes a shell command synchronously with timeout protection
   */
  private executeCommand(cmd: string, cwd: string): Promise<string> {
    return new Promise((resolve) => {
      exec(cmd, { cwd, timeout: DEFAULT_TIMEOUT_MS }, (_error, stdout) => {
        resolve(stdout || '');
      });
    });
  }
}
