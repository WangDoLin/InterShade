import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';
import { ScienceSkillBridge } from '../../services/skills/ScienceSkillBridge.js';

export interface AlphaGenomeArgs {
  action: 'lookup_gene' | 'resolve_ontology' | 'analyze_variant';
  geneSymbol?: string;
  variant?: string;
  term?: string;
  outputFile?: string;
}

export class AlphaGenomeTool extends BaseTool<AlphaGenomeArgs, string> {
  readonly name = 'alphagenome_analysis';
  readonly description =
    'Analyze genetic variant effects on gene expression, chromatin accessibility, histone marks, and transcription factors via AlphaGenome API & local annotations.';
  readonly isReadOnly = false;
  readonly isDestructive = false;
  readonly requiresPermission = false;
  readonly isDeferred = true;

  readonly inputSchema = z.object({
    action: z
      .enum(['lookup_gene', 'resolve_ontology', 'analyze_variant'])
      .describe('Action to execute: lookup_gene (offline GTF), resolve_ontology (UBERON/CL mapping), analyze_variant'),
    geneSymbol: z
      .string()
      .optional()
      .describe('Gene symbol for lookup (e.g. TP53, BRCA1, ERBB2)'),
    variant: z
      .string()
      .optional()
      .describe('Variant specification in chr:pos:ref>alt format (e.g. chr7:140753336:A>T)'),
    term: z
      .string()
      .optional()
      .describe('Biological tissue or cell-type term to resolve to ontology (e.g. liver, heart, cerebellar cortex)'),
    outputFile: z
      .string()
      .optional()
      .describe('Optional output file path for JSON results'),
  });

  async execute(args: AlphaGenomeArgs, context: ToolExecutionContext): Promise<string> {
    const scriptsDir = ScienceSkillBridge.getSkillScriptsDir('alphagenome_single_variant_analysis');
    if (!scriptsDir) {
      return '[ALPHAGENOME ERROR]: alphagenome_single_variant_analysis skill scripts directory not found.';
    }

    if (context.onProgress) {
      context.onProgress(`[AlphaGenome]: Executing "${args.action}" on target "${args.geneSymbol || args.variant || args.term || 'query'}"`);
    }

    // 1. Gene lookup (offline GTF)
    if (args.action === 'lookup_gene') {
      if (!args.geneSymbol) {
        return '[ALPHAGENOME ERROR]: geneSymbol is required for lookup_gene (e.g. TP53, BRCA1).';
      }

      const scriptPath = path.join(scriptsDir, 'lookup_gene_info.py');
      const scriptArgs = [args.geneSymbol];
      if (args.outputFile) {
        scriptArgs.push('--output', args.outputFile);
      }

      const res = await ScienceSkillBridge.runScript(scriptPath, scriptArgs, {
        cwd: context.cwd,
        timeoutMs: 45000,
      });

      if (!res.success) {
        return `[ALPHAGENOME LOOKUP FAILED]:\n${res.stderr || res.stdout}`;
      }

      return [
        `🧬 [AlphaGenome Gene Lookup]:`,
        `- Symbol: ${args.geneSymbol}`,
        `- Result:\n${res.stdout.trim()}`,
      ].join('\n');
    }

    // 2. Resolve ontology terms (UBERON / CL)
    if (args.action === 'resolve_ontology') {
      if (!args.term) {
        return '[ALPHAGENOME ERROR]: term is required for resolve_ontology (e.g. liver, cerebellar cortex).';
      }

      const scriptPath = path.join(scriptsDir, 'resolve_ontology_terms.py');
      const res = await ScienceSkillBridge.runScript(scriptPath, [args.term], {
        cwd: context.cwd,
        timeoutMs: 30000,
      });

      return [
        `🧬 [AlphaGenome Ontology Mapping]:`,
        `- Biological Term: "${args.term}"`,
        `- Result:\n${res.stdout || res.stderr}`,
      ].join('\n');
    }

    // 3. Analyze variant effects
    if (args.action === 'analyze_variant') {
      if (!args.variant) {
        return '[ALPHAGENOME ERROR]: variant is required for analyze_variant (format chr:pos:ref>alt, e.g. chr7:140753336:A>T).';
      }

      // Check ALPHAGENOME_API_KEY
      if (!process.env.ALPHAGENOME_API_KEY) {
        return [
          `[ALPHAGENOME NOTICE]: ALPHAGENOME_API_KEY is not configured in environment or .env file.`,
          `To run online variant effect scoring via DeepMind AlphaGenome API:`,
          `1. Obtain an API key at https://deepmind.google.com/science/alphagenome/`,
          `2. Add ALPHAGENOME_API_KEY=<your_key> to your ~/.env file.`,
        ].join('\n');
      }

      const scriptPath = path.join(scriptsDir, 'visualize_variant_effects.py');
      const scriptArgs = ['--variant', args.variant];
      if (args.outputFile) {
        scriptArgs.push('--output', args.outputFile);
      }

      const res = await ScienceSkillBridge.runScript(scriptPath, scriptArgs, {
        cwd: context.cwd,
        timeoutMs: 90000,
      });

      return [
        `🧬 [AlphaGenome Variant Effect Analysis]:`,
        `- Variant: ${args.variant}`,
        `- Output:\n${res.stdout || res.stderr}`,
      ].join('\n');
    }

    return '[ALPHAGENOME ERROR]: Unknown action. Available actions: lookup_gene, resolve_ontology, analyze_variant.';
  }
}
