import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SkillRegistry, type SkillSummary } from './SkillRegistry.js';
import { SkillSecurityAuditor } from './SkillSecurityAuditor.js';

export interface CatalogSkillEntry {
  name: string;
  vendor: string;
  description: string;
  tags: string[];
  rawUrl: string;
}

export interface SkillInstallResult {
  success: boolean;
  skillName: string;
  installPath: string;
  message: string;
  auditPassed: boolean;
}

/**
 * Curated index of top engineering skills from VoltAgent / Awesome Agent Skills ecosystem
 */
export const CURATED_SKILL_CATALOG: CatalogSkillEntry[] = [
  {
    name: 'architecture-stress-test',
    vendor: 'intershader',
    description: 'Stress-test proposed software architectures to detect circular dependencies and scaling cliffs.',
    tags: ['architecture', 'review', 'system-design'],
    rawUrl: 'https://raw.githubusercontent.com/WangDoLin/InterShade-Agent/main/skills/architecture-stress-test/SKILL.md',
  },
  {
    name: 'test-driven-acceptance-gate',
    vendor: 'intershader',
    description: 'Enforce acceptance criteria and executable tests before writing implementation code.',
    tags: ['testing', 'tdd', 'verification', 'qa'],
    rawUrl: 'https://raw.githubusercontent.com/WangDoLin/InterShade-Agent/main/skills/test-driven-acceptance-gate/SKILL.md',
  },
  {
    name: 'security-differential-review',
    vendor: 'trailofbits',
    description: 'Security-focused diff and PR review to detect timing attacks, weak cryptography, and permission drift.',
    tags: ['security', 'audit', 'diff-review', 'crypto'],
    rawUrl: 'https://raw.githubusercontent.com/VoltAgent/awesome-agent-skills/main/skills/trailofbits/differential-review/SKILL.md',
  },
  {
    name: 'playwright-e2e-visual-tester',
    vendor: 'testmu-ai',
    description: 'Generate robust Playwright end-to-end tests with console log capture and visual snapshot validation.',
    tags: ['playwright', 'e2e', 'browser', 'automation'],
    rawUrl: 'https://raw.githubusercontent.com/LambdaTest/agent-skills/main/playwright-skill/SKILL.md',
  },
  {
    name: 'documentation-auto-sync',
    vendor: 'intershader',
    description: 'Keep README, API docs, and architectural decision records synchronized with code refactoring.',
    tags: ['documentation', 'sync', 'readme', 'api-docs'],
    rawUrl: 'https://raw.githubusercontent.com/WangDoLin/InterShade-Agent/main/skills/documentation-auto-sync/SKILL.md',
  },
  {
    name: 'database-zero-downtime-migration',
    vendor: 'supabase',
    description: 'Zero-downtime database schema migrations with lock avoidance and backward-compatible columns.',
    tags: ['database', 'sql', 'migration', 'postgres'],
    rawUrl: 'https://raw.githubusercontent.com/VoltAgent/awesome-agent-skills/main/skills/supabase/postgres-best-practices/SKILL.md',
  },
  {
    name: 'production-incident-triage',
    vendor: 'getsentry',
    description: 'End-to-end production incident diagnosis: parse stack traces, correlate traces, and synthesize hotfixes.',
    tags: ['sentry', 'incident-response', 'sre', 'debugging'],
    rawUrl: 'https://raw.githubusercontent.com/VoltAgent/awesome-agent-skills/main/skills/getsentry/sentry-fix-issues/SKILL.md',
  },
  {
    name: 'nextjs-cache-optimizer',
    vendor: 'vercel-labs',
    description: 'Implement modern Next.js caching strategies and optimize Core Web Vitals.',
    tags: ['nextjs', 'react', 'caching', 'performance', 'web-vitals'],
    rawUrl: 'https://raw.githubusercontent.com/VoltAgent/awesome-agent-skills/main/skills/vercel-labs/next-cache-components/SKILL.md',
  },
  {
    name: 'workers-durable-objects',
    vendor: 'cloudflare',
    description: 'Edge serverless coordination with Cloudflare Workers, Durable Objects, and WebSockets.',
    tags: ['cloudflare', 'workers', 'serverless', 'edge', 'durable-objects'],
    rawUrl: 'https://raw.githubusercontent.com/VoltAgent/awesome-agent-skills/main/skills/cloudflare/durable-objects/SKILL.md',
  },
];

export class SkillHubClient {
  private workspaceDir: string;
  private registry: SkillRegistry;

  constructor(workspaceDir: string = process.cwd()) {
    this.workspaceDir = workspaceDir;
    this.registry = new SkillRegistry(workspaceDir);
  }

  /**
   * Search skills across both local registry and curated remote catalog
   */
  search(keyword: string): {
    local: SkillSummary[];
    remote: CatalogSkillEntry[];
  } {
    const term = keyword.toLowerCase().trim();
    const allLocal = this.registry.getSkillCatalog();

    const localMatches = allLocal.filter((s) => {
      const nameMatch = s.name.toLowerCase().includes(term);
      const descMatch = s.description.toLowerCase().includes(term);
      const tagMatch = s.tags?.some((t) => t.toLowerCase().includes(term)) ?? false;
      return nameMatch || descMatch || tagMatch;
    });

    const remoteMatches = CURATED_SKILL_CATALOG.filter((c) => {
      const nameMatch = c.name.toLowerCase().includes(term);
      const descMatch = c.description.toLowerCase().includes(term);
      const tagMatch = c.tags.some((t) => t.toLowerCase().includes(term));
      const notInstalledLocally = !allLocal.some((l) => l.name === c.name);
      return (nameMatch || descMatch || tagMatch) && notInstalledLocally;
    });

    return { local: localMatches, remote: remoteMatches };
  }

  /**
   * Resolve skill target download URL from name, vendor/name, or raw URL
   */
  private resolveSkillDownloadUrl(identifier: string): { name: string; url: string } {
    if (identifier.startsWith('http://') || identifier.startsWith('https://')) {
      const name = path.basename(path.dirname(identifier)) || 'custom-skill';
      return { name, url: identifier };
    }

    const matched = CURATED_SKILL_CATALOG.find(
      (c) => c.name.toLowerCase() === identifier.toLowerCase() ||
             `${c.vendor}/${c.name}`.toLowerCase() === identifier.toLowerCase()
    );

    if (matched) {
      return { name: matched.name, url: matched.rawUrl };
    }

    // Fallback: GitHub raw URL for vendor/skill pattern
    if (identifier.includes('/')) {
      const [vendor, skill] = identifier.split('/');
      return {
        name: skill,
        url: `https://raw.githubusercontent.com/VoltAgent/awesome-agent-skills/main/skills/${vendor}/${skill}/SKILL.md`,
      };
    }

    throw new Error(`Skill '${identifier}' not found in catalog. Specify full GitHub URL or vendor/name.`);
  }

  /**
   * Install a skill from remote source into workspace or user tier
   */
  async install(identifier: string, isGlobal: boolean = false): Promise<SkillInstallResult> {
    const { name, url } = this.resolveSkillDownloadUrl(identifier);
    const targetBaseDir = isGlobal
      ? path.join(os.homedir(), '.intershader', 'skills', name)
      : path.join(this.workspaceDir, '.intershader', 'skills', name);

    const rawContent = await this.fetchSkillContent(url);
    const { frontmatter } = SkillRegistry.parseFrontmatter(rawContent);
    const skillName = frontmatter.name || name;

    const targetFile = path.join(targetBaseDir, 'SKILL.md');
    fs.mkdirSync(targetBaseDir, { recursive: true });
    fs.writeFileSync(targetFile, rawContent, 'utf8');

    // Run security audit on newly installed skill
    const installedPackage = this.registry.getSkill(skillName) || {
      metadata: {
        name: skillName,
        description: frontmatter.description || '',
        license: frontmatter.license || 'Apache-2.0',
        version: frontmatter.version || '1.0.0',
        upstreamUrl: url,
        commitSha: '',
        capabilities: {
          scriptExecution: Boolean(frontmatter.capabilities?.scriptExecution),
          networkAccess: Boolean(frontmatter.capabilities?.networkAccess),
          filesystemWrite: Boolean(frontmatter.capabilities?.filesystemWrite),
        },
        tags: frontmatter.tags || [],
      },
      content: rawContent,
      rawFileContent: rawContent,
      skillDir: targetBaseDir,
      tier: isGlobal ? 'user' : 'workspace',
      contentSha256: '',
      treeSha256: '',
      assetFiles: ['SKILL.md'],
    };

    const audit = SkillSecurityAuditor.auditSkill(installedPackage);
    const isSafe = audit.passed && audit.findings.every((f) => f.severity !== 'CRITICAL');

    if (!isSafe) {
      fs.rmSync(targetBaseDir, { recursive: true, force: true });
      throw new Error(`Installation aborted: Skill failed security audit with critical issues: ${audit.findings.map((f) => f.message).join('; ')}`);
    }

    return {
      success: true,
      skillName,
      installPath: targetFile,
      message: `Skill '${skillName}' successfully installed (${isGlobal ? 'user tier' : 'workspace tier'}). Security Audit: ${audit.passed ? 'PASSED (Clean)' : 'WARNING (Findings noted)'}.`,
      auditPassed: audit.passed,
    };
  }

  /**
   * Fetch raw skill markdown content with timeout and status check
   */
  private async fetchSkillContent(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'InterShader-Agent-SkillHub/1.0' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Failed to download skill from ${url}: HTTP ${response.status} ${response.statusText}`);
    }

    return await response.text();
  }

  /**
   * Uninstall an existing workspace or user skill
   */
  uninstall(skillName: string): { success: boolean; message: string } {
    const workspacePath = path.join(this.workspaceDir, '.intershader', 'skills', skillName);
    const userPath = path.join(os.homedir(), '.intershader', 'skills', skillName);

    if (fs.existsSync(workspacePath)) {
      fs.rmSync(workspacePath, { recursive: true, force: true });
      return { success: true, message: `Skill '${skillName}' removed from workspace tier.` };
    }

    if (fs.existsSync(userPath)) {
      fs.rmSync(userPath, { recursive: true, force: true });
      return { success: true, message: `Skill '${skillName}' removed from user tier.` };
    }

    return { success: false, message: `Skill '${skillName}' not found in workspace or user tier.` };
  }
}
