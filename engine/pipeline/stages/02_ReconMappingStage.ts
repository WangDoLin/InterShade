import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import type { PipelineStage, PipelineContext, StageResult, SymbolContext } from '../PipelineStage.js';
import { AstSkeletonExtractor } from '../../../context/AstSkeletonExtractor.js';
import { NativeCodeIntelligence } from '../../../services/lsp/NativeCodeIntelligence.js';

export class ReconMappingStage implements PipelineStage {
  readonly index = 2;
  readonly name = 'Codebase Reconnaissance & Semantic Mapping';
  readonly description = 'Scans target files, extracts AST skeletons, and maps dependencies.';

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const relevantFiles: string[] = [];
    const symbols: SymbolContext[] = [];
    const dependencies: string[] = [];
    const relatedTests: string[] = [];
    let astSummary = '';

    const targets = ctx.scopeSpec?.inScopeFiles || [];

    for (const rel of targets) {
      const fullPath = path.resolve(ctx.cwd, rel);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        relevantFiles.push(rel);
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const skeleton = AstSkeletonExtractor.extract(rel, content);
          astSummary += `\n--- File: ${rel} (${skeleton.language}) ---\n${skeleton.skeletonContent}\n`;

          // 1. Symbol extraction via NativeCodeIntelligence AST parser
          try {
            const lspSymbols = NativeCodeIntelligence.getDocumentSymbols(fullPath, content);
            for (const s of lspSymbols) {
              const mappedKind: 'class' | 'function' | 'method' | 'interface' | 'variable' =
                s.kind === 'class'
                  ? 'class'
                  : s.kind === 'interface'
                  ? 'interface'
                  : s.kind === 'function'
                  ? 'function'
                  : s.kind === 'method'
                  ? 'method'
                  : 'variable';

              symbols.push({
                name: s.name,
                kind: mappedKind,
                file: rel,
                line: s.line,
              });
            }
          } catch {
            // Non-TS/JS fallback
          }

          // 2. Dependency extraction
          const importMatches = content.matchAll(/import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g);
          for (const m of importMatches) {
            if (!dependencies.includes(m[1])) {
              dependencies.push(m[1]);
            }
          }

          // 3. Related test discovery
          const baseName = path.basename(rel, path.extname(rel));
          const candidateTests = [
            path.join(path.dirname(rel), `${baseName}.test.ts`),
            path.join(path.dirname(rel), `${baseName}.spec.ts`),
            path.join(ctx.cwd, 'tests', `test-${baseName.toLowerCase()}.ts`),
            path.join(ctx.cwd, 'tests', `${baseName}.test.ts`)
          ];
          for (const testPath of candidateTests) {
            if (fs.existsSync(testPath) && !relatedTests.includes(testPath)) {
              relatedTests.push(path.relative(ctx.cwd, testPath).replace(/\\/g, '/'));
            }
          }
        } catch {
          // File reading error ignored
        }
      }
    }

    // 4. Git dirty files inspection
    const dirtyGitFiles: string[] = [];
    if (fs.existsSync(path.join(ctx.cwd, '.git'))) {
      try {
        const gitStatus = execSync('git status --porcelain', { cwd: ctx.cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 5000 });
        for (const line of gitStatus.split('\n')) {
          const trimmed = line.trim();
          if (trimmed) {
            const filePath = trimmed.slice(3).trim();
            dirtyGitFiles.push(filePath);
          }
        }
      } catch {
        // Git command error
      }
    }

    ctx.reconManifest = {
      relevantFiles,
      astSummary: astSummary.trim(),
      dependencies,
      symbols,
      relatedTests,
      dirtyGitFiles
    };

    ctx.logs.push(`Scanned ${relevantFiles.length} candidate files in workspace.`);

    return {
      success: true,
      stageName: this.name,
      stageIndex: this.index,
      message: `Reconnaissance mapped ${relevantFiles.length} files.`,
      details: {
        relevantCount: relevantFiles.length,
        symbolsCount: symbols.length,
        dependenciesCount: dependencies.length,
        relatedTestsCount: relatedTests.length,
        dirtyGitCount: dirtyGitFiles.length
      }
    };
  }
}
