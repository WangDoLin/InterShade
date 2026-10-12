import { z } from 'zod';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';
import { SkillRegistry } from '../../services/skills/SkillRegistry.js';

export class SkillActivateTool extends BaseTool<
  { name: string },
  string
> {
  readonly name = 'skill_activate';
  readonly description = 'Activate an approved Agent Skill into the current context after validating cryptographic integrity and security policies.';
  readonly isReadOnly = false;

  readonly inputSchema = z.object({
    name: z.string().describe('Exact name of the skill to activate (e.g. typescript-nodejs-analyzer, test-automation-vitest)'),
  });

  async execute(
    args: { name: string },
    context: ToolExecutionContext
  ): Promise<string> {
    const registry = new SkillRegistry(context.cwd);
    const result = registry.activateSkill(args.name, true);

    if (!result.success) {
      return `[SKILL ACTIVATION REJECTED]: Failed to activate skill '${args.name}'. Reason: ${result.error || 'Unknown policy violation'}`;
    }

    const lines: string[] = [
      `[SKILL ACTIVATED]: Successfully activated '${result.skillName}' (Tier: ${result.tier})`,
      `Security Audit Status: ${result.auditReport?.passed ? 'PASSED (0 Critical/High issues)' : 'FAILED'}`,
      'Skill Instructions:',
      result.instructions,
    ];

    return lines.join('\n');
  }
}
