import { z } from 'zod';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';
import { SkillCrystallizer } from '../../services/skills/SkillCrystallizer.js';

export class SkillDiscoveryTool extends BaseTool<
  { intent?: string },
  string
> {
  readonly name = 'skill_discovery';
  readonly description = 'Discover and load reusable skills crystallized from previous successful pipeline executions.';
  readonly isReadOnly = true;

  readonly inputSchema = z.object({
    intent: z.string().optional().describe('Intent or task description to match against existing skills'),
  });

  async execute(
    args: { intent?: string },
    context: ToolExecutionContext
  ): Promise<string> {
    const allSkills = SkillCrystallizer.loadSkills(context.cwd);

    if (allSkills.length === 0) {
      return 'No crystallized skills found in workspace (.intershader/skills). Skills are automatically distilled upon successful task executions.';
    }

    if (args.intent) {
      const matched = SkillCrystallizer.matchSkill(args.intent, context.cwd);
      if (matched) {
        return [
          `Matched proven skill: **${matched.name}** (Confidence: ${Math.round(matched.confidence * 100)}%)`,
          `- Description: ${matched.description}`,
          `- Target patterns: ${matched.targetPatterns.join(', ')}`,
          `- Triggers: ${matched.intentTriggers.join(', ')}`,
          `- Reusable prompt guidance: ${matched.reusablePrompt}`,
          `- Recommended workflow stages: ${matched.workflowStages.join(' -> ')}`
        ].join('\n');
      }
    }

    const lines: string[] = [`Available crystallized skills (${allSkills.length}):\n`];
    for (const skill of allSkills) {
      lines.push(`- **${skill.name}**: ${skill.description} (Targets: ${skill.targetPatterns.join(', ')})`);
    }

    return lines.join('\n');
  }
}
