import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PipelineContext } from '../../engine/pipeline/PipelineStage.js';
import { FtsMemoryService } from '../memory/FtsMemoryService.js';
import { TrajectoryRecorder } from '../memory/TrajectoryRecorder.js';

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  intentTriggers: string[];
  targetPatterns: string[];
  requiredTools: string[];
  workflowStages: string[];
  reusablePrompt: string;
  confidence: number;
  createdAt: number;
  usageCount: number;
}

export class SkillCrystallizer {
  /**
   * Automatically crystallize a successful 10-stage pipeline run into a reusable skill
   */
  static crystallizeFromPipeline(ctx: PipelineContext): SkillDefinition | null {
    if (ctx.pipelineStatus !== 'SUCCESS') {
      return null;
    }

    const intent = ctx.scopeSpec?.intentSummary || ctx.userPrompt.slice(0, 80);
    const skillName = this.generateSkillName(intent);
    const targetPatterns = Array.from(
      new Set(
        ctx.appliedPatches.map((p) => {
          const ext = path.extname(p.targetFile);
          return ext ? `*${ext}` : path.basename(p.targetFile);
        })
      )
    );

    const triggers = intent
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 8);

    const skill: SkillDefinition = {
      id: randomUUID(),
      name: skillName,
      description: `Automated skill distilled from successful execution: ${intent}`,
      intentTriggers: triggers,
      targetPatterns,
      requiredTools: ['file_read', 'file_edit', 'grep_search'],
      workflowStages: [
        'IntentScope',
        'ReconMapping',
        'RedRepro',
        'RootCause',
        'MinimalPlan',
        'PatchGen',
        'ApplySavepoint',
        'GreenVerify',
        'AdversarialAudit',
        'CleanupSynthesis',
      ],
      reusablePrompt: `Apply proven solution pattern for: ${intent}. Target files pattern: ${targetPatterns.join(', ')}.`,
      confidence: ctx.scopeSpec?.confidence || 0.95,
      createdAt: Date.now(),
      usageCount: 1,
    };

    // 1. Save skill file to `.intershader/skills/<skill-name>.json`
    const skillsDir = path.join(ctx.cwd, '.intershader', 'skills');
    if (!fs.existsSync(skillsDir)) {
      fs.mkdirSync(skillsDir, { recursive: true });
    }

    const skillFilePath = path.join(skillsDir, `${skillName}.json`);
    fs.writeFileSync(skillFilePath, JSON.stringify(skill, null, 2), 'utf-8');
    ctx.logs.push(`Crystallized autonomous skill saved to ${skillFilePath}`);

    // 2. Index into FTS5 memories table for BM25 semantic retrieval
    FtsMemoryService.recordMemory({
      projectId: path.basename(ctx.cwd),
      sessionId: ctx.appliedSavepointId,
      type: 'skill',
      title: `Skill: ${skill.name}`,
      content: `${skill.description} Triggers: ${triggers.join(', ')}. Target patterns: ${targetPatterns.join(', ')}.`,
    });

    // 3. Record full execution trajectory
    TrajectoryRecorder.recordTrajectory({
      sessionId: ctx.appliedSavepointId || 'session-default',
      taskId: skill.id,
      intent,
      prompt: ctx.userPrompt,
      stagesExecuted: skill.workflowStages,
      changedFiles: ctx.appliedPatches.map((p) => p.targetFile),
      status: 'SUCCESS',
      diffStat: ctx.finalDiff,
      reproEvidence: ctx.reproductionVerifiedGreen ? 'Reproduction test verified GREEN' : '',
    });

    return skill;
  }

  /**
   * Generate clean kebab-case name from intent summary
   */
  private static generateSkillName(intent: string): string {
    const sanitized = intent
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 4)
      .join('-');

    return sanitized || `skill-${Date.now().toString(36)}`;
  }

  /**
   * Load all existing skills from the workspace
   */
  static loadSkills(workspaceDir: string): SkillDefinition[] {
    const skillsDir = path.join(workspaceDir, '.intershader', 'skills');
    if (!fs.existsSync(skillsDir)) {
      return [];
    }

    const files = fs.readdirSync(skillsDir).filter((f) => f.endsWith('.json'));
    const skills: SkillDefinition[] = [];

    for (const f of files) {
      try {
        const content = fs.readFileSync(path.join(skillsDir, f), 'utf-8');
        skills.push(JSON.parse(content));
      } catch {
        // Ignore unreadable skill files
      }
    }

    return skills;
  }

  /**
   * Match an incoming user intent against crystallized skills
   */
  static matchSkill(intent: string, workspaceDir: string): SkillDefinition | null {
    const skills = this.loadSkills(workspaceDir);
    if (skills.length === 0) {
      return null;
    }

    const lowerIntent = intent.toLowerCase();
    let bestMatch: SkillDefinition | null = null;
    let maxMatches = 0;

    for (const skill of skills) {
      let matches = 0;
      for (const trigger of skill.intentTriggers) {
        if (lowerIntent.includes(trigger.toLowerCase())) {
          matches++;
        }
      }

      if (matches > maxMatches && matches >= 1) {
        maxMatches = matches;
        bestMatch = skill;
      }
    }

    return bestMatch;
  }
}
