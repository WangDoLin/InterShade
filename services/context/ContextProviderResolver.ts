import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { FtsMemoryService } from '../memory/FtsMemoryService.js';

export interface ResolvedContext {
  cleanedPrompt: string;
  injectedContext: string;
  appliedShortcuts: string[];
}

/**
 * ContextProviderResolver parses inline @ directives in user prompts:
 * - @diff: Injects current working tree git diff
 * - @git: Injects branch name & working status
 * - @memories: Injects top durable memories from SQLite FTS5
 * - @file:<path>: Injects the content of a specific file
 */
export class ContextProviderResolver {
  static resolve(prompt: string, cwd: string, projectId: string): ResolvedContext {
    let cleanedPrompt = prompt;
    const appliedShortcuts: string[] = [];
    const contextSections: string[] = [];

    // 1. Resolve @diff
    if (/@diff\b/i.test(cleanedPrompt)) {
      appliedShortcuts.push('@diff');
      cleanedPrompt = cleanedPrompt.replace(/@diff\b/gi, '').trim();
      try {
        const diff = execSync('git diff HEAD', {
          cwd,
          encoding: 'utf-8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();

        if (diff) {
          const lines = diff.split('\n');
          const preview = lines.length > 120
            ? `${lines.slice(0, 100).join('\n')}\n... [${lines.length - 100} lines truncated for brevity]`
            : diff;
          contextSections.push(`### Working Tree Git Diff (@diff):\n\`\`\`diff\n${preview}\n\`\`\``);
        } else {
          contextSections.push('### Working Tree Git Diff (@diff):\n(No modified tracked files detected)');
        }
      } catch {
        contextSections.push('### Working Tree Git Diff (@diff):\n(Unable to read git diff)');
      }
    }

    // 2. Resolve @git / @status
    if (/(@git|@status)\b/i.test(cleanedPrompt)) {
      appliedShortcuts.push('@git');
      cleanedPrompt = cleanedPrompt.replace(/(@git|@status)\b/gi, '').trim();
      try {
        const status = execSync('git status --short', {
          cwd,
          encoding: 'utf-8',
          timeout: 3000,
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        const branch = execSync('git branch --show-current', {
          cwd,
          encoding: 'utf-8',
          timeout: 2000,
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();

        contextSections.push(`### Git Status (@git):\n- Active Branch: \`${branch || 'detached'}\`\n\`\`\`\n${status || 'Clean working tree'}\n\`\`\``);
      } catch {
        contextSections.push('### Git Status (@git):\n(Git repository not initialized)');
      }
    }

    // 3. Resolve @memories
    if (/@memories\b/i.test(cleanedPrompt)) {
      appliedShortcuts.push('@memories');
      cleanedPrompt = cleanedPrompt.replace(/@memories\b/gi, '').trim();
      const memories = FtsMemoryService.formatMemoriesForContext(projectId);
      if (memories) {
        contextSections.push(`### Project Durable Memories (@memories):\n${memories}`);
      }
    }

    // 4. Resolve @file:<path> or @<filename>
    const fileMatches = cleanedPrompt.match(/@file:([^\s]+)/gi) || [];
    for (const match of fileMatches) {
      const relPath = match.replace(/@file:/i, '').trim();
      appliedShortcuts.push(`@file:${relPath}`);
      cleanedPrompt = cleanedPrompt.replace(match, '').trim();

      const absPath = path.isAbsolute(relPath) ? relPath : path.join(cwd, relPath);
      try {
        if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
          const content = fs.readFileSync(absPath, 'utf-8');
          const lines = content.split('\n');
          const preview = lines.length > 150
            ? `${lines.slice(0, 120).join('\n')}\n... [${lines.length - 120} lines omitted]`
            : content;
          contextSections.push(`### Attached File: \`${relPath}\` (@file):\n\`\`\`\n${preview}\n\`\`\``);
        }
      } catch {
        // ignore unreadable files
      }
    }

    cleanedPrompt = cleanedPrompt.replace(/\s+/g, ' ').trim();
    const injectedContext = contextSections.join('\n\n');

    return {
      cleanedPrompt: cleanedPrompt || prompt,
      injectedContext,
      appliedShortcuts,
    };
  }
}
