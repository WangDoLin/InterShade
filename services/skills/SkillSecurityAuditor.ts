import fs from 'node:fs';
import path from 'node:path';
import type { SkillPackage } from './SkillLockfile.js';

export type AuditSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export interface AuditFinding {
  ruleId: string;
  severity: AuditSeverity;
  category: 'PROMPT_INJECTION' | 'COMMAND_EXECUTION' | 'CREDENTIAL_LEAK' | 'PATH_TRAVERSAL' | 'CAPABILITY_MISMATCH';
  message: string;
  location?: string;
  sample?: string;
}

export interface SkillAuditReport {
  skillName: string;
  passed: boolean;
  maxSeverity: AuditSeverity | 'PASS';
  contentSha256: string;
  auditedAt: string;
  findings: AuditFinding[];
}

export class SkillSecurityAuditor {
  private static readonly PROMPT_INJECTION_PATTERNS = [
    {
      regex: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|directions|rules)/i,
      message: 'Detected prompt injection override: attempt to ignore previous instructions',
    },
    {
      regex: /disregard\s+(all\s+)?(system|safety|security)\s+(rules|constraints|instructions)/i,
      message: 'Detected prompt injection override: attempt to disregard system/safety rules',
    },
    {
      regex: /(reveal|print|output|display)\s+(the\s+)?(system\s+prompt|developer\s+prompt|initial\s+prompt)/i,
      message: 'Detected system prompt extraction attempt',
    },
    {
      regex: /you\s+are\s+now\s+(in\s+developer\s+mode|unrestricted|DAN|jailbroken)/i,
      message: 'Detected jailbreak framing pattern',
    },
    {
      regex: /(exfiltrate|send|upload)\s+.*(secret|token|credential|api_key|password)\s+to/i,
      message: 'Detected credential exfiltration instruction',
    },
    {
      regex: /bypass\s+(the\s+)?(permission\s+engine|safety\s+guard|security\s+gate)/i,
      message: 'Detected instruction attempting to bypass InterShader security guards',
    },
  ];

  private static readonly DANGEROUS_COMMAND_PATTERNS = [
    {
      regex: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\b/i,
      message: 'Detected destructive filesystem command (rm -rf)',
    },
    {
      regex: /\b(curl|wget)\b[^|\n\r]+?\|\s*(sh|bash|powershell|cmd)/i,
      message: 'Detected remote code execution pipe pattern (curl | bash)',
    },
    {
      regex: /\b(format\s+[a-zA-Z]:|mkfs(\.[a-z0-9]+)?)\b/i,
      message: 'Detected destructive disk formatting command',
    },
    {
      regex: /\beval\s*\([^)]+\)/i,
      message: 'Detected dynamic code evaluation (eval)',
    },
    {
      regex: /\b(powershell|cmd)\s+(-e|-enc|-encodedcommand)\b/i,
      message: 'Detected encoded command execution flag',
    },
  ];

  private static readonly SECRET_LEAK_PATTERNS = [
    {
      regex: /process\.env\.[A-Z0-9_]*(KEY|SECRET|TOKEN|PASS|CREDENTIAL)/i,
      message: 'Detected reference to environment secret variable',
    },
    {
      regex: /(['"])(ghp_[a-zA-Z0-9]{36}|sk-[a-zA-Z0-9]{32,}|xox[baprs]-[a-zA-Z0-9-]{10,})\1/i,
      message: 'Detected hardcoded API token / credential format',
    },
  ];

  private static readonly PATH_TRAVERSAL_PATTERNS = [
    {
      regex: /(\.\.[/\\]){3,}/,
      message: 'Detected deep relative directory traversal escape',
    },
    {
      regex: /([/\\]etc[/\\]shadow|[/\\]etc[/\\]passwd|C:[/\\]Windows[/\\]System32[/\\]config)/i,
      message: 'Detected access to privileged OS credentials or configuration directory',
    },
  ];

  /**
   * Run full static security audit on a skill package
   */
  static auditSkill(skill: SkillPackage): SkillAuditReport {
    const findings: AuditFinding[] = [];

    // 1. Audit Markdown content for prompt injection
    for (const pattern of this.PROMPT_INJECTION_PATTERNS) {
      const match = pattern.regex.exec(skill.content);
      if (match) {
        findings.push({
          ruleId: 'SEC-SKILL-INJECTION',
          severity: 'CRITICAL',
          category: 'PROMPT_INJECTION',
          message: pattern.message,
          location: 'SKILL.md (instructions)',
          sample: match[0],
        });
      }
    }

    // 2. Audit Markdown content for dangerous commands
    for (const pattern of this.DANGEROUS_COMMAND_PATTERNS) {
      const match = pattern.regex.exec(skill.content);
      if (match) {
        findings.push({
          ruleId: 'SEC-SKILL-DANGEROUS-CMD',
          severity: 'HIGH',
          category: 'COMMAND_EXECUTION',
          message: pattern.message,
          location: 'SKILL.md',
          sample: match[0],
        });
      }
    }

    // 3. Audit for secrets & tokens
    for (const pattern of this.SECRET_LEAK_PATTERNS) {
      const match = pattern.regex.exec(skill.content);
      if (match) {
        findings.push({
          ruleId: 'SEC-SKILL-SECRET-LEAK',
          severity: 'CRITICAL',
          category: 'CREDENTIAL_LEAK',
          message: pattern.message,
          location: 'SKILL.md',
          sample: match[0],
        });
      }
    }

    // 4. Audit path traversal
    for (const pattern of this.PATH_TRAVERSAL_PATTERNS) {
      const match = pattern.regex.exec(skill.content);
      if (match) {
        findings.push({
          ruleId: 'SEC-SKILL-PATH-TRAVERSAL',
          severity: 'HIGH',
          category: 'PATH_TRAVERSAL',
          message: pattern.message,
          location: 'SKILL.md',
          sample: match[0],
        });
      }
    }

    // 5. Capability mismatch: scripts present without scriptExecution capability
    const scriptsDir = path.join(skill.skillDir, 'scripts');
    if (fs.existsSync(scriptsDir)) {
      const files = fs.readdirSync(scriptsDir);
      if (files.length > 0 && !skill.metadata.capabilities.scriptExecution) {
        findings.push({
          ruleId: 'SEC-SKILL-CAP-MISMATCH',
          severity: 'HIGH',
          category: 'CAPABILITY_MISMATCH',
          message: `Skill directory contains executable scripts in 'scripts/' but metadata.capabilities.scriptExecution is false`,
          location: 'scripts/',
        });
      }

      // Scan script file contents
      for (const file of files) {
        const fullPath = path.join(scriptsDir, file);
        if (fs.statSync(fullPath).isFile()) {
          const scriptContent = fs.readFileSync(fullPath, 'utf8');
          for (const pattern of this.DANGEROUS_COMMAND_PATTERNS) {
            const match = pattern.regex.exec(scriptContent);
            if (match) {
              findings.push({
                ruleId: 'SEC-SKILL-SCRIPT-MALICIOUS',
                severity: 'CRITICAL',
                category: 'COMMAND_EXECUTION',
                message: `Script '${file}' contains dangerous command pattern`,
                location: `scripts/${file}`,
                sample: match[0],
              });
            }
          }
        }
      }
    }

    // Compute max severity & passed status
    let maxSeverity: AuditSeverity | 'PASS' = 'PASS';
    const hasCritical = findings.some((f) => f.severity === 'CRITICAL');
    const hasHigh = findings.some((f) => f.severity === 'HIGH');
    const hasMedium = findings.some((f) => f.severity === 'MEDIUM');
    const hasLow = findings.some((f) => f.severity === 'LOW');

    if (hasCritical) maxSeverity = 'CRITICAL';
    else if (hasHigh) maxSeverity = 'HIGH';
    else if (hasMedium) maxSeverity = 'MEDIUM';
    else if (hasLow) maxSeverity = 'LOW';

    // A skill passes if it has 0 CRITICAL and 0 HIGH findings
    const passed = !hasCritical && !hasHigh;

    return {
      skillName: skill.metadata.name,
      passed,
      maxSeverity,
      contentSha256: skill.contentSha256,
      auditedAt: new Date().toISOString(),
      findings,
    };
  }

  /**
   * Quick scan on raw text for prompt injection
   */
  static isPromptInjection(text: string): boolean {
    return this.PROMPT_INJECTION_PATTERNS.some((p) => p.regex.test(text));
  }
}
