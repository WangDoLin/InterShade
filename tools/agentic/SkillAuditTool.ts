import { z } from 'zod';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';
import { SkillRegistry } from '../../services/skills/SkillRegistry.js';
import { SkillSecurityAuditor } from '../../services/skills/SkillSecurityAuditor.js';

export class SkillAuditTool extends BaseTool<
  { name?: string },
  string
> {
  readonly name = 'skill_audit';
  readonly description = 'Perform a static security audit on registered skills to detect prompt injections, dangerous commands, secret leakage, or capability mismatches.';
  readonly isReadOnly = true;

  readonly inputSchema = z.object({
    name: z.string().optional().describe('Optional name of a specific skill to audit. If omitted, all skills are audited.'),
  });

  async execute(
    args: { name?: string },
    context: ToolExecutionContext
  ): Promise<string> {
    const registry = new SkillRegistry(context.cwd);
    const skills = registry.discoverAllSkills();

    if (skills.length === 0) {
      return 'No skills found across discovery tiers to audit.';
    }

    const targetSkills = args.name
      ? skills.filter((s) => s.metadata.name === args.name)
      : skills;

    if (targetSkills.length === 0) {
      return `Skill '${args.name}' was not found in any discovery tier.`;
    }

    const lines: string[] = [`Skill Security Audit Report (${targetSkills.length} skills scanned)\n`];
    let totalIssues = 0;

    for (const skill of targetSkills) {
      const report = SkillSecurityAuditor.auditSkill(skill);
      const statusIcon = report.passed ? '[PASS]' : '[FAIL]';
      lines.push(`${statusIcon} ${skill.metadata.name} (Tier: ${skill.tier}, Version: ${skill.metadata.version})`);
      lines.push(`  Content SHA-256: ${report.contentSha256}`);
      lines.push(`  Max Severity: ${report.maxSeverity}`);

      if (report.findings.length > 0) {
        totalIssues += report.findings.length;
        lines.push(`  Findings (${report.findings.length}):`);
        for (const finding of report.findings) {
          lines.push(`    - [${finding.severity}] [${finding.category}] ${finding.message} (${finding.location || 'root'})`);
          if (finding.sample) {
            lines.push(`      Sample: "${finding.sample}"`);
          }
        }
      } else {
        lines.push('  Findings: 0 security violations found.');
      }
      lines.push('');
    }

    lines.push(`Summary: Total findings across scanned skills: ${totalIssues}`);
    return lines.join('\n');
  }
}
