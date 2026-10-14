import { FtsMemoryService } from './FtsMemoryService.js';

export interface DetectedHabit {
  category: string;
  preference: string;
  directive: string;
}

export class DeveloperHabitService {
  /**
   * Scans user prompt for explicit developer conventions, rules, and preferences.
   * If detected, persists them into SQLite FTS5 Memory for lifelong recall.
   */
  static detectAndPersistHabit(
    userPrompt: string,
    projectId: string,
    sessionId?: string
  ): DetectedHabit | null {
    const text = userPrompt.toLowerCase().trim();

    // 1. Language Preference
    if (text.includes('tiếng việt') || text.includes('tieng viet') || text.includes('vietnamese')) {
      return this.recordHabit(
        projectId,
        sessionId,
        'Language Preference',
        'Developer communicates strictly in Vietnamese. All thoughts, explanations, and commit notes must be in natural Vietnamese.',
        'Vietnamese Language Standard'
      );
    }

    // 2. CSS / Styling Framework Preference
    if (text.includes('không dùng tailwind') || text.includes('no tailwind') || text.includes('vanilla css')) {
      return this.recordHabit(
        projectId,
        sessionId,
        'Frontend Styling Invariant',
        'Do not use Tailwind CSS. Prefer standard Vanilla CSS with custom properties or CSS Modules.',
        'Styling Framework: Vanilla CSS'
      );
    } else if (text.includes('dùng tailwind') || text.includes('use tailwind')) {
      return this.recordHabit(
        projectId,
        sessionId,
        'Frontend Styling Invariant',
        'Developer prefers Tailwind CSS utility classes for styling.',
        'Styling Framework: Tailwind CSS'
      );
    }

    // 3. Testing Library Preference
    if (text.includes('dùng vitest') || text.includes('use vitest')) {
      return this.recordHabit(
        projectId,
        sessionId,
        'Testing Framework Preference',
        'Developer prefers Vitest as the primary test runner over Jest.',
        'Test Framework: Vitest'
      );
    }

    // 4. Port / Environment Invariant
    const portMatch = userPrompt.match(/port\s+(\d{4,5})/i);
    if (portMatch && (text.includes('quy định') || text.includes('luôn') || text.includes('mặc định') || text.includes('always'))) {
      const port = portMatch[1];
      return this.recordHabit(
        projectId,
        sessionId,
        'Server Port Invariant',
        `Always configure development servers to run on port ${port}.`,
        `Fixed Server Port: ${port}`
      );
    }

    return null;
  }

  private static recordHabit(
    projectId: string,
    sessionId: string | undefined,
    category: string,
    directive: string,
    title: string
  ): DetectedHabit {
    // Check if habit already recorded to avoid duplicate flood
    const existing = FtsMemoryService.searchMemories(title, { projectId, limit: 1 });
    if (existing.length === 0) {
      FtsMemoryService.recordMemory({
        projectId,
        sessionId,
        type: 'architecture',
        title: `[PREFERENCE] ${title}`,
        content: directive,
      });
    }

    return {
      category,
      preference: title,
      directive,
    };
  }
}
