import fs from 'node:fs';
import path from 'node:path';
import { NativeCodeIntelligence, type LspSymbol } from '../lsp/NativeCodeIntelligence.js';

export interface CodeGraphNode {
  readonly filePath: string;
  readonly symbols: LspSymbol[];
  readonly imports: string[];
  importedBy: string[];
  readonly associatedTests: string[];
  readonly callees?: string[];
}

export interface FocusedContextSlice {
  readonly primaryFiles: string[];
  readonly referencedFiles: string[];
  readonly testFiles: string[];
  readonly symbolsInScope: string[];
  readonly totalLines: number;
  readonly formattedContextMarkdown: string;
}

export class ContextGraphEngine {
  /**
   * Build targeted dependency graph and call graph around target files without reading entire repo
   */
  static buildGraphForFiles(files: string[], cwd: string): Map<string, CodeGraphNode> {
    const graph = new Map<string, CodeGraphNode>();

    for (const relFile of files) {
      const absPath = path.resolve(cwd, relFile);
      if (!fs.existsSync(absPath)) continue;

      let content = '';
      try {
        content = fs.readFileSync(absPath, 'utf-8');
      } catch {
        continue;
      }

      // 1. Extract symbols using Native LSP
      const symbols = NativeCodeIntelligence.getDocumentSymbols(absPath, content);

      // 2. Parse imports via regex AST scanner
      const importRegex = /(?:import|from)\s+['"]([^'"]+)['"]/g;
      const imports: string[] = [];
      let match: RegExpExecArray | null;

      while ((match = importRegex.exec(content)) !== null) {
        const importPath = match[1];
        if (importPath.startsWith('.')) {
          const resolvedImport = path.normalize(path.join(path.dirname(relFile), importPath));
          imports.push(resolvedImport);
        }
      }

      // 3. Extract direct calls (callees) via call-expression regex
      const callRegex = /(?:([a-zA-Z0-9_$]+)\.)?([a-zA-Z0-9_$]+)\s*\(/g;
      const callees: string[] = [];
      let callMatch: RegExpExecArray | null;
      while ((callMatch = callRegex.exec(content)) !== null) {
        const calleeName = callMatch[2];
        if (
          !['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'import', 'require'].includes(calleeName) &&
          !callees.includes(calleeName)
        ) {
          callees.push(calleeName);
        }
      }

      // 4. Locate corresponding test files
      const baseName = path.basename(relFile, path.extname(relFile));
      const testCandidates = [
        path.join(path.dirname(relFile), `${baseName}.test.ts`),
        path.join(path.dirname(relFile), `${baseName}.spec.ts`),
        path.join('tests', `${baseName}.test.ts`),
        path.join('tests', `test-${baseName}.ts`),
      ];

      const associatedTests = testCandidates.filter((cand) => fs.existsSync(path.resolve(cwd, cand)));

      graph.set(relFile, {
        filePath: relFile,
        symbols,
        imports,
        importedBy: [],
        associatedTests,
        callees: callees.slice(0, 20),
      });
    }

    // Two-way link: resolve importedBy across all nodes in graph
    for (const [sourceFile, node] of graph.entries()) {
      for (const imp of node.imports) {
        for (const [targetFile, targetNode] of graph.entries()) {
          const targetWithoutExt = targetFile.replace(/\.(ts|js|tsx|jsx)$/, '');
          const impWithoutExt = imp.replace(/\.(ts|js|tsx|jsx)$/, '');
          if (targetFile === imp || targetWithoutExt === impWithoutExt || targetFile.endsWith(imp)) {
            if (!targetNode.importedBy.includes(sourceFile)) {
              targetNode.importedBy.push(sourceFile);
            }
          }
        }
      }
    }

    return graph;
  }

  /**
   * Assemble high-relevance focused context slice strictly pruned to minimal necessity
   */
  static assembleFocusedContext(
    prompt: string,
    candidateFiles: string[],
    cwd: string,
    maxLinesLimit = 800
  ): FocusedContextSlice {
    const graph = this.buildGraphForFiles(candidateFiles, cwd);
    const primaryFiles: string[] = [];
    const referencedFiles: string[] = [];
    const testFiles: string[] = [];
    const symbolsInScope: string[] = [];

    let totalLines = 0;
    const contextSections: string[] = ['### FOCUSED ARCHITECTURAL CONTEXT SLICE'];

    for (const [filePath, node] of graph.entries()) {
      primaryFiles.push(filePath);
      testFiles.push(...node.associatedTests);
      symbolsInScope.push(...node.symbols.map((s) => s.name));

      contextSections.push(`\n#### Target File: \`${filePath}\``);
      if (node.symbols.length > 0) {
        const sigs = node.symbols.slice(0, 10).map((s) => `  - [${s.kind}] ${s.name} (L${s.line})`).join('\n');
        contextSections.push(`Key Symbols:\n${sigs}`);
      }

      if (node.imports.length > 0) {
        referencedFiles.push(...node.imports);
        contextSections.push(`Direct Dependencies: ${node.imports.join(', ')}`);
      }

      if (node.associatedTests.length > 0) {
        contextSections.push(`Associated Verification Tests: ${node.associatedTests.join(', ')}`);
      }

      // Read file content with budget cap
      const fullPath = path.resolve(cwd, filePath);
      try {
        const lines = fs.readFileSync(fullPath, 'utf-8').split('\n');
        totalLines += lines.length;
        if (totalLines <= maxLinesLimit) {
          contextSections.push('```ts\n' + lines.join('\n') + '\n```');
        } else {
          contextSections.push(`*(Content omitted: exceeds focused line limit ${maxLinesLimit})*`);
        }
      } catch {
        // Skip unreadable
      }
    }

    return {
      primaryFiles,
      referencedFiles: Array.from(new Set(referencedFiles)),
      testFiles: Array.from(new Set(testFiles)),
      symbolsInScope,
      totalLines,
      formattedContextMarkdown: contextSections.join('\n'),
    };
  }
}
