import { z } from 'zod';
import path from 'node:path';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';
import { SerenaSemanticEngine } from '../../engine/semantic/SerenaSemanticEngine.js';

export class SerenaOutlineTool extends BaseTool<{ filePath: string }, string> {
  readonly name = 'serena_symbol_outline';
  readonly description = 'Get an AST-level symbol outline (classes, functions, interfaces, methods, exports) for a source file without reading all lines.';
  readonly isReadOnly = true;

  readonly inputSchema = z.object({
    filePath: z.string().describe('Relative or absolute file path to analyze'),
  });

  async execute(args: { filePath: string }, context: ToolExecutionContext): Promise<string> {
    const fullPath = path.isAbsolute(args.filePath) ? args.filePath : path.resolve(context.cwd, args.filePath);
    const symbols = SerenaSemanticEngine.getSymbolOutline(fullPath);
    if (symbols.length === 0) {
      return `No symbols found in ${args.filePath}.`;
    }

    const lines: string[] = [`Symbol Outline: ${args.filePath} (${symbols.length} symbols)`];
    for (const s of symbols) {
      const exp = s.isExported ? '[EXPORT] ' : '';
      lines.push(`- ${exp}${s.kind.toUpperCase()} "${s.name}" (lines ${s.startLine}-${s.endLine}, col ${s.character})`);
    }
    return lines.join('\n');
  }
}

export class SerenaDefinitionTool extends BaseTool<{ filePath: string; symbolName: string }, string> {
  readonly name = 'serena_find_definition';
  readonly description = 'Find the declaration and definition location of a symbol in a file or imported modules.';
  readonly isReadOnly = true;

  readonly inputSchema = z.object({
    filePath: z.string().describe('Source file path'),
    symbolName: z.string().describe('Name of the symbol (class, function, variable) to find'),
  });

  async execute(args: { filePath: string; symbolName: string }, context: ToolExecutionContext): Promise<string> {
    const fullPath = path.isAbsolute(args.filePath) ? args.filePath : path.resolve(context.cwd, args.filePath);
    const def = SerenaSemanticEngine.findDefinition(fullPath, args.symbolName);
    if (!def) {
      return `Symbol "${args.symbolName}" definition not found in ${args.filePath}.`;
    }
    return `Definition Found\nSymbol: ${args.symbolName}\nFile:   ${def.file}:${def.line}:${def.character}\nSnippet: ${def.snippet || 'n/a'}`;
  }
}

export class SerenaReferencesTool extends BaseTool<{ symbolName: string; searchDir?: string; maxResults?: number }, string> {
  readonly name = 'serena_find_references';
  readonly description = 'Find all AST identifier references to a symbol across the project workspace.';
  readonly isReadOnly = true;

  readonly inputSchema = z.object({
    symbolName: z.string().describe('Name of the symbol to find references for'),
    searchDir: z.string().optional().describe('Directory to search in (default: current workspace)'),
    maxResults: z.number().optional().describe('Maximum number of occurrences to return (default: 50)'),
  });

  async execute(args: { symbolName: string; searchDir?: string; maxResults?: number }, context: ToolExecutionContext): Promise<string> {
    const targetDir = args.searchDir
      ? path.isAbsolute(args.searchDir)
        ? args.searchDir
        : path.resolve(context.cwd, args.searchDir)
      : context.cwd;

    const refs = SerenaSemanticEngine.findReferences(args.symbolName, targetDir, { maxResults: args.maxResults || 50 });
    if (refs.length === 0) {
      return `No references found for "${args.symbolName}" in ${targetDir}.`;
    }

    const lines: string[] = [`References: "${args.symbolName}" (${refs.length} occurrences)`];
    for (const r of refs) {
      const relPath = path.relative(context.cwd, r.file);
      lines.push(`- ${relPath}:${r.line}:${r.character} -> ${r.snippet || ''}`);
    }
    return lines.join('\n');
  }
}

export class SerenaDiagnosticsTool extends BaseTool<{ filePath: string }, string> {
  readonly name = 'serena_diagnostics';
  readonly description = 'Run TypeScript syntactic and semantic compiler checks on a file to inspect diagnostics and errors.';
  readonly isReadOnly = true;

  readonly inputSchema = z.object({
    filePath: z.string().describe('File path to check'),
  });

  async execute(args: { filePath: string }, context: ToolExecutionContext): Promise<string> {
    const fullPath = path.isAbsolute(args.filePath) ? args.filePath : path.resolve(context.cwd, args.filePath);
    const diags = SerenaSemanticEngine.getDiagnostics(fullPath);
    if (diags.length === 0) {
      return `No errors or warnings found in ${args.filePath}.`;
    }

    const lines: string[] = [`Compiler Diagnostics: ${args.filePath} (${diags.length} issues)`];
    for (const d of diags) {
      lines.push(`[${d.category.toUpperCase()} TS${d.code}] Line ${d.line}:${d.character} - ${d.message}`);
    }
    return lines.join('\n');
  }
}
