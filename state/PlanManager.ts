import { getDatabase } from './Database.js';

export type PlanStepChangeType = 'new' | 'modified' | 'unchanged' | 'removed';

export interface PlanStep {
  id: string;
  title: string;
  description?: string;
  targetFiles?: string[];
  dependencies?: string[];
  changeType?: PlanStepChangeType;
  status?: 'pending' | 'in_progress' | 'completed';
}

export interface PlanRevision {
  version: number;
  title: string;
  overview?: string;
  steps: PlanStep[];
  acceptanceCriteria: string[];
  changelog: string[];
  timestamp: number;
}

export interface ActivePlan {
  sessionId: string;
  currentVersion: number;
  title: string;
  overview?: string;
  steps: PlanStep[];
  acceptanceCriteria: string[];
  revisions: PlanRevision[];
  createdAt: number;
  updatedAt: number;
}

export interface CreatePlanInput {
  title: string;
  overview?: string;
  steps: Array<Omit<PlanStep, 'changeType'>>;
  acceptanceCriteria?: string[];
}

export interface MergePlanInput {
  title?: string;
  overview?: string;
  steps?: PlanStep[];
  changelog?: string[];
  additionsOrChangesText?: string;
  acceptanceCriteria?: string[];
}

/**
 * PlanManager coordinates stateful architecture and implementation plans,
 * tracking revisions and incrementally merging new requirements and modifications.
 */
export class PlanManager {
  private static planCache: Map<string, ActivePlan> = new Map();

  /**
   * Retrieves active plan for a session.
   */
  static getActivePlan(sessionId: string): ActivePlan | null {
    if (!sessionId) return null;
    if (this.planCache.has(sessionId)) {
      return this.planCache.get(sessionId)!;
    }

    try {
      const db = getDatabase();
      const stmt = db.prepare('SELECT * FROM session_plans WHERE session_id = ?');
      const row = stmt.get(sessionId) as {
        session_id: string;
        current_version: number;
        title: string;
        overview: string | null;
        plan_json: string;
        revisions_json: string;
        created_at: number;
        updated_at: number;
      } | undefined;

      if (!row) {
        return null;
      }

      const plan: ActivePlan = {
        sessionId: row.session_id,
        currentVersion: row.current_version,
        title: row.title,
        overview: row.overview || undefined,
        steps: JSON.parse(row.plan_json),
        acceptanceCriteria: [],
        revisions: JSON.parse(row.revisions_json),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };

      // Extract criteria from the latest revision if available
      const latestRev = plan.revisions[plan.revisions.length - 1];
      if (latestRev && latestRev.acceptanceCriteria) {
        plan.acceptanceCriteria = latestRev.acceptanceCriteria;
      }

      this.planCache.set(sessionId, plan);
      return plan;
    } catch {
      return null;
    }
  }

  /**
   * Persists an active plan to SQLite and memory cache.
   */
  static savePlan(plan: ActivePlan): void {
    this.planCache.set(plan.sessionId, plan);

    try {
      const db = getDatabase();
      const stmt = db.prepare(`
        INSERT INTO session_plans (session_id, current_version, title, overview, plan_json, revisions_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          current_version = excluded.current_version,
          title = excluded.title,
          overview = excluded.overview,
          plan_json = excluded.plan_json,
          revisions_json = excluded.revisions_json,
          updated_at = excluded.updated_at
      `);

      stmt.run(
        plan.sessionId,
        plan.currentVersion,
        plan.title,
        plan.overview || null,
        JSON.stringify(plan.steps),
        JSON.stringify(plan.revisions),
        plan.createdAt,
        plan.updatedAt
      );
    } catch (err) {
      // In-memory cache still holds state if database write fails
    }
  }

  /**
   * Creates a fresh plan (Version 1).
   */
  static createOrReplacePlan(sessionId: string, input: CreatePlanInput): ActivePlan {
    const now = Date.now();
    const initialSteps: PlanStep[] = input.steps.map((s, idx) => ({
      ...s,
      id: s.id || String(idx + 1),
      changeType: 'new',
      status: s.status || 'pending',
    }));

    const initialRevision: PlanRevision = {
      version: 1,
      title: input.title,
      overview: input.overview,
      steps: initialSteps,
      acceptanceCriteria: input.acceptanceCriteria || [],
      changelog: ['Initial plan established (v1)'],
      timestamp: now,
    };

    const plan: ActivePlan = {
      sessionId,
      currentVersion: 1,
      title: input.title,
      overview: input.overview,
      steps: initialSteps,
      acceptanceCriteria: input.acceptanceCriteria || [],
      revisions: [initialRevision],
      createdAt: now,
      updatedAt: now,
    };

    this.savePlan(plan);
    return plan;
  }

  /**
   * Combines and merges new requirements, modifications, or additions with the existing plan.
   * Preserves unaffected steps, marks [NEW], [UPDATED], [UNCHANGED], and records revision history.
   */
  static mergePlan(sessionId: string, input: MergePlanInput): ActivePlan {
    const existing = this.getActivePlan(sessionId);

    // If no prior plan exists, establish a new v1 plan
    if (!existing) {
      return this.createOrReplacePlan(sessionId, {
        title: input.title || 'Architectural Implementation Plan',
        overview: input.overview,
        steps: (input.steps || []).map((s, idx) => ({
          id: s.id || String(idx + 1),
          title: s.title,
          description: s.description,
          targetFiles: s.targetFiles,
          dependencies: s.dependencies,
          status: s.status,
        })),
        acceptanceCriteria: input.acceptanceCriteria || [],
      });
    }

    const nextVersion = existing.currentVersion + 1;
    const now = Date.now();
    const changelog: string[] = [];

    if (input.additionsOrChangesText) {
      changelog.push(`User request: "${input.additionsOrChangesText}"`);
    }

    const incomingSteps = input.steps || [];
    const mergedSteps: PlanStep[] = [];
    const existingStepsMap = new Map<string, PlanStep>();
    const existingByNormalizedTitle = new Map<string, PlanStep>();

    for (const step of existing.steps) {
      existingStepsMap.set(step.id, step);
      existingByNormalizedTitle.set(this.normalizeTitle(step.title), step);
    }

    // Determine if incoming steps represent a full replacement list or partial updates
    const hasIncomingSteps = incomingSteps.length > 0;

    if (hasIncomingSteps) {
      const incomingIds = new Set(incomingSteps.map((s) => s.id));
      const processedExistingIds = new Set<string>();

      // 1. Process incoming steps
      for (let i = 0; i < incomingSteps.length; i++) {
        const inc = incomingSteps[i];
        const assignedId = inc.id || String(i + 1);
        const existingById = existingStepsMap.get(assignedId);
        const existingByTitle = existingByNormalizedTitle.get(this.normalizeTitle(inc.title));
        const matchedExisting = existingById || existingByTitle;

        if (matchedExisting) {
          processedExistingIds.add(matchedExisting.id);
          const isModified =
            matchedExisting.title !== inc.title ||
            (inc.description && matchedExisting.description !== inc.description) ||
            JSON.stringify(matchedExisting.targetFiles || []) !== JSON.stringify(inc.targetFiles || []);

          const changeType: PlanStepChangeType = isModified ? 'modified' : 'unchanged';
          const mergedStep: PlanStep = {
            id: assignedId,
            title: inc.title,
            description: inc.description || matchedExisting.description,
            targetFiles: this.mergeLists(matchedExisting.targetFiles, inc.targetFiles),
            dependencies: inc.dependencies || matchedExisting.dependencies,
            status: inc.status || matchedExisting.status || 'pending',
            changeType,
          };

          mergedSteps.push(mergedStep);
          if (changeType === 'modified') {
            changelog.push(`[UPDATED] Step ${assignedId}: ${inc.title}`);
          } else {
            changelog.push(`[UNCHANGED] Step ${assignedId}: ${inc.title}`);
          }
        } else {
          // Brand new step
          const mergedStep: PlanStep = {
            ...inc,
            id: assignedId,
            changeType: 'new',
            status: inc.status || 'pending',
          };
          mergedSteps.push(mergedStep);
          changelog.push(`[NEW] Step ${assignedId}: ${inc.title}`);
        }
      }

      // 2. Retain any existing steps that were not in incoming if incoming was partial
      // If incoming had fewer steps than existing, retain remaining unaffected existing steps
      for (const orig of existing.steps) {
        if (!processedExistingIds.has(orig.id) && !incomingIds.has(orig.id)) {
          mergedSteps.push({
            ...orig,
            changeType: 'unchanged',
          });
          changelog.push(`[UNCHANGED] Step ${orig.id}: ${orig.title}`);
        }
      }
    } else {
      // No structured steps provided in input, retain existing steps and log user delta
      for (const orig of existing.steps) {
        mergedSteps.push({
          ...orig,
          changeType: 'unchanged',
        });
      }
      changelog.push(`[PRESERVED] Maintained ${existing.steps.length} existing steps`);
    }

    // Sort steps numerically if IDs are numeric
    mergedSteps.sort((a, b) => {
      const numA = parseInt(a.id, 10);
      const numB = parseInt(b.id, 10);
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB;
      }
      return a.id.localeCompare(b.id);
    });

    // Merge acceptance criteria
    const mergedCriteria = this.mergeLists(
      existing.acceptanceCriteria,
      input.acceptanceCriteria
    );

    if (input.changelog && input.changelog.length > 0) {
      changelog.push(...input.changelog);
    }

    const revision: PlanRevision = {
      version: nextVersion,
      title: input.title || existing.title,
      overview: input.overview || existing.overview,
      steps: mergedSteps,
      acceptanceCriteria: mergedCriteria,
      changelog,
      timestamp: now,
    };

    const updatedPlan: ActivePlan = {
      sessionId,
      currentVersion: nextVersion,
      title: input.title || existing.title,
      overview: input.overview || existing.overview,
      steps: mergedSteps,
      acceptanceCriteria: mergedCriteria,
      revisions: [...existing.revisions, revision],
      createdAt: existing.createdAt,
      updatedAt: now,
    };

    this.savePlan(updatedPlan);
    return updatedPlan;
  }

  /**
   * Resets active plan for a session.
   */
  static clearPlan(sessionId: string): void {
    this.planCache.delete(sessionId);
    try {
      const db = getDatabase();
      db.prepare('DELETE FROM session_plans WHERE session_id = ?').run(sessionId);
    } catch {
      // Ignored
    }
  }

  /**
   * Formats the active plan into structured markdown.
   */
  static formatPlanMarkdown(
    plan: ActivePlan,
    options?: { showChangelog?: boolean }
  ): string {
    const lines: string[] = [];
    lines.push(`# Architecture Plan: ${plan.title} (v${plan.currentVersion})`);
    lines.push('');

    if (plan.overview) {
      lines.push(`**Overview**: ${plan.overview}`);
      lines.push('');
    }

    const latestRev = plan.revisions[plan.revisions.length - 1];
    if (options?.showChangelog && latestRev && latestRev.changelog && latestRev.changelog.length > 0) {
      lines.push(`### Plan Changelog (v${plan.currentVersion}${plan.currentVersion > 1 ? ` vs v${plan.currentVersion - 1}` : ''}):`);
      for (const item of latestRev.changelog) {
        lines.push(`- ${item}`);
      }
      lines.push('');
    }

    lines.push('### Implementation Steps:');
    for (const step of plan.steps) {
      const tag = step.changeType
        ? step.changeType === 'new'
          ? '[NEW] '
          : step.changeType === 'modified'
          ? '[UPDATED] '
          : '[UNCHANGED] '
        : '';

      const statusTag = step.status === 'completed' ? ' [Completed]' : '';
      lines.push(`${step.id}. ${tag}**${step.title}**${statusTag}`);
      if (step.description) {
        lines.push(`   - Details: ${step.description}`);
      }
      if (step.targetFiles && step.targetFiles.length > 0) {
        lines.push(`   - Target Files: ${step.targetFiles.map((f) => `\`${f}\``).join(', ')}`);
      }
      if (step.dependencies && step.dependencies.length > 0) {
        lines.push(`   - Dependencies: ${step.dependencies.join(', ')}`);
      }
    }
    lines.push('');

    if (plan.acceptanceCriteria && plan.acceptanceCriteria.length > 0) {
      lines.push('### Verification & Acceptance Criteria:');
      for (const crit of plan.acceptanceCriteria) {
        lines.push(`- [ ] ${crit}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Parses natural language or markdown plan output from an assistant response.
   */
  static extractPlanFromText(
    text: string
  ): { title?: string; overview?: string; steps: PlanStep[]; acceptanceCriteria?: string[] } | null {
    if (!text || text.length < 50) return null;

    const lines = text.split('\n');
    let title: string | undefined;
    let overview: string | undefined;
    const steps: PlanStep[] = [];
    const acceptanceCriteria: string[] = [];

    let currentSection: 'header' | 'steps' | 'criteria' | 'none' = 'none';
    let currentStep: Partial<PlanStep> | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Detect Title
      const titleMatch = line.match(/^#+\s*(?:Architecture Plan|Implementation Plan|Plan|Kế hoạch(?:\s+triển\s+khai)?):\s*(.+)$/i);
      if (titleMatch) {
        title = titleMatch[1].replace(/\(v\d+\)/i, '').trim();
        currentSection = 'header';
        continue;
      }

      // Detect Steps section
      if (/^#+\s*(?:Implementation Steps|Steps|Các bước|Kế hoạch thực hiện)/i.test(line)) {
        if (currentStep && currentStep.title) {
          steps.push(currentStep as PlanStep);
          currentStep = null;
        }
        currentSection = 'steps';
        continue;
      }

      // Detect Criteria section
      if (/^#+\s*(?:Verification|Acceptance Criteria|Tiêu chí|Kiểm tra)/i.test(line)) {
        if (currentStep && currentStep.title) {
          steps.push(currentStep as PlanStep);
          currentStep = null;
        }
        currentSection = 'criteria';
        continue;
      }

      if (currentSection === 'criteria') {
        const critMatch = line.match(/^(?:-\s*\[[ xX]?\]|-\s*|\*\s*|\d+\.\s*)(.+)$/);
        if (critMatch && critMatch[1].trim()) {
          acceptanceCriteria.push(critMatch[1].trim());
        }
        continue;
      }

      // Step detection: e.g. "1. [NEW] Setup DB", "Step 1: Setup DB", "Bước 1: Setup DB"
      const stepMatch =
        line.match(/^(?:###\s*)?(?:Step|Bước|Task|T)?\s*(\d+)[:.]\s*(?:\[(?:NEW|UPDATED|UNCHANGED)\]\s*)?\*?\*?([^*\n]+)\*?\*?$/i) ||
        line.match(/^(\d+)\.\s+(?:\[(?:NEW|UPDATED|UNCHANGED)\]\s+)?\*?\*?([^*\n]+)\*?\*?$/i);

      if (stepMatch && currentSection !== 'criteria') {
        if (currentStep && currentStep.title) {
          steps.push(currentStep as PlanStep);
        }
        currentStep = {
          id: stepMatch[1],
          title: stepMatch[2].trim(),
          targetFiles: [],
          dependencies: [],
          status: 'pending',
        };
        currentSection = 'steps';
        continue;
      }

      // Indented step details
      if (currentStep && (line.startsWith('-') || line.startsWith('*'))) {
        const fileMatch = line.match(/[-*]\s*(?:Target Files?|Files?|Tệp tin?):\s*(.+)$/i);
        if (fileMatch) {
          const files = fileMatch[1]
            .split(/[,;\s]+/)
            .map((f) => f.replace(/[`'"]/g, '').trim())
            .filter((f) => f.includes('.') || f.includes('/'));
          currentStep.targetFiles = files;
          continue;
        }

        const descMatch = line.match(/[-*]\s*(?:Details?|Description|Mô tả|Chi tiết):\s*(.+)$/i);
        if (descMatch) {
          currentStep.description = descMatch[1].trim();
          continue;
        }

        const depMatch = line.match(/[-*]\s*(?:Dependencies?|Phụ thuộc):\s*(.+)$/i);
        if (depMatch) {
          currentStep.dependencies = depMatch[1].split(/[,;\s]+/).map((d) => d.trim()).filter(Boolean);
          continue;
        }

        if (!currentStep.description) {
          currentStep.description = line.replace(/^[-*]\s*/, '').trim();
        }
      }
    }

    if (currentStep && currentStep.title) {
      steps.push(currentStep as PlanStep);
    }

    if (steps.length < 2) {
      return null;
    }

    return {
      title: title || 'Architectural Implementation Plan',
      overview,
      steps,
      acceptanceCriteria,
    };
  }

  private static normalizeTitle(title: string): string {
    return title.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private static mergeLists(a?: string[], b?: string[]): string[] {
    const set = new Set<string>();
    if (a) a.forEach((item) => set.add(item.trim()));
    if (b) b.forEach((item) => set.add(item.trim()));
    return Array.from(set).filter((item) => item.length > 0);
  }
}
