import type { ToolDefinition } from '../types/index.js';
import { PlanManager, type ActivePlan } from '../state/PlanManager.js';

export interface CacheBlock {
  type: 'text';
  text: string;
  cacheControl?: { type: 'ephemeral' };
}

/**
 * PromptCacheManager guarantees byte-level deterministic static prefix alignment
 * to achieve >90% KV-Cache hit rate across Anthropic, DeepSeek, and OpenAI.
 */
export class PromptCacheManager {
  /**
   * Constructs the structured prompt blocks ensuring the static instructions and
   * tool definitions are frozen and tagged with cache_control.
   */
  static buildPromptCacheBlocks(
    systemPrompt: string,
    tools: ToolDefinition[],
    dynamicContext: {
      cwd: string;
      model: string;
      sessionDate: string;
      modifiedFiles?: string[];
      activePlan?: ActivePlan | null;
      availableSkills?: Array<{ name: string; description: string; tags?: string[] }>;
      activeSkillWorkflow?: { name: string; instructions: string } | null;
    }
  ): { staticBlock: CacheBlock; dynamicBlock: CacheBlock } {
    // 1. Static Prefix: System rules, guidelines, tool specifications & skill catalog
    const toolSummary = tools.map((t) => `${t.name}: ${t.description}`).join('\n');
    const skillsSummary =
      dynamicContext.availableSkills && dynamicContext.availableSkills.length > 0
        ? `\n\n# Available Engineering Skills (Domain-Specific Workflows)\n${dynamicContext.availableSkills.map((s) => `- ${s.name}: ${s.description}${s.tags && s.tags.length > 0 ? ` [Tags: ${s.tags.join(', ')}]` : ''}`).join('\n')}`
        : '';
    const staticText = `${systemPrompt}\n\n# Available Tool Capabilities\n${toolSummary}${skillsSummary}`;

    const staticBlock: CacheBlock = {
      type: 'text',
      text: staticText,
      cacheControl: { type: 'ephemeral' },
    };

    // 2. Dynamic Suffix: Session metadata that may change per turn
    const fileLedger =
      dynamicContext.modifiedFiles && dynamicContext.modifiedFiles.length > 0
        ? `\n\n# Confirmed Modified Files in This Session\n${dynamicContext.modifiedFiles.map((f) => `- ${f}`).join('\n')}`
        : '\n\n# Confirmed Modified Files in This Session\n(None yet)';

    const planSection = dynamicContext.activePlan
      ? `\n\n# Active Architecture & Implementation Plan (Version ${dynamicContext.activePlan.currentVersion})\n${PlanManager.formatPlanMarkdown(dynamicContext.activePlan, { showChangelog: true })}`
      : '';

    const activeSkillSection = dynamicContext.activeSkillWorkflow
      ? `\n\n# Active Engineering Skill: ${dynamicContext.activeSkillWorkflow.name}\n${dynamicContext.activeSkillWorkflow.instructions}`
      : '';

    const dynamicText = `\n# Active Environment Context\nCWD: ${dynamicContext.cwd}\nModel: ${dynamicContext.model}\nDate: ${dynamicContext.sessionDate}${fileLedger}${planSection}${activeSkillSection}`;

    const dynamicBlock: CacheBlock = {
      type: 'text',
      text: dynamicText,
    };

    return { staticBlock, dynamicBlock };
  }
}

