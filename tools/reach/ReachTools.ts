import { z } from 'zod';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';
import { AgentReachRouter } from '../../engine/reach/AgentReachRouter.js';
import { ReachHealthDoctor } from '../../engine/reach/ReachHealthDoctor.js';

export class ReachWebReadTool extends BaseTool<{ url: string }, string> {
  readonly name = 'reach_web_read';
  readonly description = 'Fetch any public web page, blog, issue, or doc and convert to clean Markdown using Jina Reader with automatic fallback.';
  readonly isReadOnly = true;

  readonly inputSchema = z.object({
    url: z.string().url().describe('The URL to read and convert to Markdown'),
  });

  async execute(args: { url: string }, _context: ToolExecutionContext): Promise<string> {
    const res = await AgentReachRouter.webRead(args.url);
    const header = `Reach Web Read (${res.source.toUpperCase()}) | ${res.latencyMs}ms\nURL: ${res.url}\n\n`;
    return header + res.markdown;
  }
}

export class ReachGithubResearchTool extends BaseTool<
  { repo: string; resource: 'readme' | 'issue' | 'file'; path?: string },
  string
> {
  readonly name = 'reach_github_research';
  readonly description = 'Inspect GitHub repositories, readmes, issues, or specific code files directly without cloning.';
  readonly isReadOnly = true;

  readonly inputSchema = z.object({
    repo: z.string().describe('Repository in "owner/repo" format or full GitHub URL'),
    resource: z.enum(['readme', 'issue', 'file']).describe('Type of resource to inspect'),
    path: z.string().optional().describe('File path within repository (required when resource is "file")'),
  });

  async execute(
    args: { repo: string; resource: 'readme' | 'issue' | 'file'; path?: string },
    _context: ToolExecutionContext
  ): Promise<string> {
    const res = await AgentReachRouter.githubResearch(args.repo, args.resource, args.path);
    if (!res.success) {
      return `GitHub research failed for ${res.repo}: ${res.content}`;
    }
    return `GitHub Research: ${res.repo} [${res.resource}]\n${res.content}`;
  }
}

export class ReachDoctorTool extends BaseTool<Record<string, never>, string> {
  readonly name = 'reach_doctor';
  readonly description = 'Run diagnostic health checks on internet channels (Web Reader, GitHub API, DNS, Proxy).';
  readonly isReadOnly = true;

  readonly inputSchema = z.object({});

  async execute(_args: Record<string, never>, _context: ToolExecutionContext): Promise<string> {
    const report = await ReachHealthDoctor.diagnose();
    return ReachHealthDoctor.formatReport(report);
  }
}
