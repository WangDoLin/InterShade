import fs from 'node:fs';
import path from 'node:path';
import type { PipelineStage, PipelineContext, StageResult } from '../PipelineStage.js';

export class IntentScopeStage implements PipelineStage {
  readonly index = 1;
  readonly name = 'Intent & Scope Boundary Analysis';
  readonly description = 'Analyzes user request to define explicit boundaries, goals, and out-of-bounds files.';

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const prompt = ctx.userPrompt.trim();
    if (!prompt) {
      return {
        success: false,
        stageName: this.name,
        stageIndex: this.index,
        message: 'Empty user prompt provided.'
      };
    }

    const normalizedCwd = path.resolve(ctx.cwd);
    const discoveredFiles: string[] = [];
    const discoveredSymbols: string[] = [];

    // 1. Explicit file extraction via regex matching relative paths
    const fileRegex = /[a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]{2,4}/g;
    const matches = prompt.match(fileRegex) || [];
    for (const m of matches) {
      if (!m.includes('http') && !discoveredFiles.includes(m)) {
        const resolved = path.resolve(ctx.cwd, m);
        // Path escape check (Strict Jail Guard)
        if (!resolved.startsWith(normalizedCwd)) {
          return {
            success: false,
            stageName: this.name,
            stageIndex: this.index,
            message: `Target path "${m}" escapes the workspace boundary.`
          };
        }
        discoveredFiles.push(m);
      }
    }

    // 2. Symbol extraction (PascalCase or camelCase identifiers)
    const symbolRegex = /\b[A-Z][a-zA-Z0-9_]{2,}\b/g;
    const symbolMatches = prompt.match(symbolRegex) || [];
    for (const sym of symbolMatches) {
      if (!discoveredSymbols.includes(sym) && !discoveredFiles.some(f => f.includes(sym))) {
        discoveredSymbols.push(sym);
      }
    }

    // 3. Fallback resolution: If no explicit file was found, locate matching symbol file in workspace
    if (discoveredFiles.length === 0 && discoveredSymbols.length > 0) {
      for (const sym of discoveredSymbols) {
        const candidateExtensions = ['.ts', '.tsx', '.js', '.jsx'];
        for (const ext of candidateExtensions) {
          const directMatch = path.join(ctx.cwd, 'src', `${sym}${ext}`);
          const rootMatch = path.join(ctx.cwd, `${sym}${ext}`);
          if (fs.existsSync(directMatch)) {
            discoveredFiles.push(path.relative(ctx.cwd, directMatch).replace(/\\/g, '/'));
          } else if (fs.existsSync(rootMatch)) {
            discoveredFiles.push(path.relative(ctx.cwd, rootMatch).replace(/\\/g, '/'));
          }
        }
      }
    }

    const forbiddenPaths = ['.env*', '.git/**', 'node_modules/**', 'dist/**'];
    const confidence = discoveredFiles.length > 0 ? 0.95 : discoveredSymbols.length > 0 ? 0.75 : 0.5;

    ctx.scopeSpec = {
      intentSummary: prompt.slice(0, 150),
      inScopeFiles: discoveredFiles,
      outOfBoundsFiles: forbiddenPaths,
      forbiddenPaths,
      targets: {
        files: discoveredFiles,
        directories: [],
        symbols: discoveredSymbols
      },
      allowedOperations: ['modify', 'create', 'delete'],
      acceptanceCriteria: [
        'All automated verification tests pass',
        'Zero regressions introduced into unchanged modules',
        'Strict conformance to bounded target scope'
      ],
      confidence
    };

    // Initialize change budget
    ctx.changeBudget = {
      maxFiles: Math.max(3, discoveredFiles.length + 2),
      maxAddedLines: 60,
      maxDeletedLines: 40
    };

    ctx.logs.push(`Identified target files in scope: ${discoveredFiles.join(', ') || 'Auto-discovery'}`);

    return {
      success: true,
      stageName: this.name,
      stageIndex: this.index,
      message: 'Scope boundaries successfully established.',
      details: {
        inScopeCount: discoveredFiles.length,
        symbolsCount: discoveredSymbols.length,
        confidence
      }
    };
  }
}
