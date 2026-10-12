import { z } from 'zod';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';
import { NativeCodeIntelligence } from '../../services/lsp/NativeCodeIntelligence.js';
import path from 'node:path';

export class LspTool extends BaseTool<
  {
    action: 'document_symbols' | 'definition' | 'references' | 'type_info';
    filePath: string;
    line?: number;
    character?: number;
  },
  string
> {
  readonly name = 'lsp_code_intelligence';
  readonly description = 'Native Language Server Protocol intelligence. Provides exact symbol definitions, references, types, and document symbols without regex guesswork.';
  readonly isReadOnly = true;

  readonly inputSchema = z.object({
    action: z.enum(['document_symbols', 'definition', 'references', 'type_info']).describe('LSP operation to perform'),
    filePath: z.string().describe('Relative or absolute file path to analyze'),
    line: z.number().optional().describe('1-based line number for position-based actions (definition, references, type_info)'),
    character: z.number().optional().describe('1-based column number (default: 1)'),
  });

  async execute(
    args: {
      action: 'document_symbols' | 'definition' | 'references' | 'type_info';
      filePath: string;
      line?: number;
      character?: number;
    },
    context: ToolExecutionContext
  ): Promise<string> {
    const fullPath = path.isAbsolute(args.filePath)
      ? args.filePath
      : path.resolve(context.cwd, args.filePath);

    const line = args.line || 1;
    const character = args.character || 1;

    switch (args.action) {
      case 'document_symbols': {
        const symbols = NativeCodeIntelligence.getDocumentSymbols(fullPath);
        if (symbols.length === 0) {
          return `No symbols found in ${args.filePath}.`;
        }

        const lines: string[] = [`Document symbols for ${args.filePath} (${symbols.length}):\n`];
        for (const s of symbols) {
          const exp = s.isExported ? 'export ' : '';
          lines.push(`- **${exp}${s.kind} ${s.name}** at line ${s.line}:${s.character}`);
        }
        return lines.join('\n');
      }

      case 'definition': {
        const defs = NativeCodeIntelligence.getDefinition(fullPath, line, character, context.cwd);
        if (defs.length === 0) {
          return `No definition found at ${args.filePath}:${line}:${character}.`;
        }

        const lines: string[] = [`Definitions found (${defs.length}):\n`];
        for (const d of defs) {
          lines.push(`- **${d.file}:${d.line}:${d.character}**`);
          if (d.snippet) lines.push(`  \`${d.snippet}\``);
        }
        return lines.join('\n');
      }

      case 'references': {
        const refs = NativeCodeIntelligence.getReferences(fullPath, line, character, context.cwd);
        if (refs.length === 0) {
          return `No references found for symbol at ${args.filePath}:${line}:${character}.`;
        }

        const lines: string[] = [`References found (${refs.length}):\n`];
        for (const r of refs) {
          lines.push(`- **${r.file}:${r.line}:${r.character}**`);
          if (r.snippet) lines.push(`  \`${r.snippet}\``);
        }
        return lines.join('\n');
      }

      case 'type_info': {
        const typeInfo = NativeCodeIntelligence.getTypeInfo(fullPath, line, character, context.cwd);
        if (!typeInfo) {
          return `No type information available at ${args.filePath}:${line}:${character}.`;
        }

        const lines: string[] = [`Type signature at ${args.filePath}:${line}:${character}:\n`];
        lines.push('```typescript');
        lines.push(typeInfo.signature);
        lines.push('```');
        if (typeInfo.documentation) {
          lines.push(`\n**Documentation**: ${typeInfo.documentation}`);
        }
        return lines.join('\n');
      }
    }
  }
}
