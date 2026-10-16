import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';
import { ScienceSkillBridge } from '../../services/skills/ScienceSkillBridge.js';

export interface EncodeCcresArgs {
  action: 'search_ccres' | 'ccre_details' | 'nearby_genes' | 'biosamples';
  chromosome?: string;
  start?: number;
  end?: number;
  accession?: string;
  outputFile?: string;
}

export class EncodeCcresTool extends BaseTool<EncodeCcresArgs, string> {
  readonly name = 'encode_ccres';
  readonly description =
    'Query the ENCODE Registry of candidate cis-Regulatory Elements (cCREs: Promoters, Enhancers, CTCF insulators) via SCREEN GraphQL API.';
  readonly isReadOnly = true;
  readonly isDestructive = false;
  readonly requiresPermission = false;
  readonly isDeferred = true;

  readonly inputSchema = z.object({
    action: z
      .enum(['search_ccres', 'ccre_details', 'nearby_genes', 'biosamples'])
      .describe('Action to execute on ENCODE Registry'),
    chromosome: z
      .string()
      .optional()
      .describe('Chromosome (e.g. chr11, chr7) for search_ccres'),
    start: z
      .number()
      .optional()
      .describe('Genomic start coordinate (e.g. 5205263) for search_ccres'),
    end: z
      .number()
      .optional()
      .describe('Genomic end coordinate (e.g. 5207263) for search_ccres'),
    accession: z
      .string()
      .optional()
      .describe('cCRE Accession ID (e.g. EH38E2941922) for ccre_details or nearby_genes'),
    outputFile: z
      .string()
      .optional()
      .describe('Output JSON file path'),
  });

  async execute(args: EncodeCcresArgs, context: ToolExecutionContext): Promise<string> {
    const scriptsDir = ScienceSkillBridge.getSkillScriptsDir('encode_ccres_database');
    if (!scriptsDir) {
      return '[ENCODE ERROR]: encode_ccres_database skill scripts directory not found.';
    }

    const scriptPath = path.join(scriptsDir, 'screen_api.py');
    const defaultOutput = args.outputFile || path.resolve(context.cwd, 'data', 'encode_output.json');
    const outDir = path.dirname(defaultOutput);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    if (context.onProgress) {
      context.onProgress(`[ENCODE cCREs]: Executing action "${args.action}" on target "${args.accession || args.chromosome || 'query'}"`);
    }

    // 1. Search cCREs by genomic range
    if (args.action === 'search_ccres') {
      const chr = args.chromosome || 'chr11';
      const start = args.start !== undefined ? String(args.start) : '5205263';
      const end = args.end !== undefined ? String(args.end) : '5207263';

      const res = await ScienceSkillBridge.runScript(
        scriptPath,
        ['search', '--chromosome', chr, '--start', start, '--end', end, '--output', defaultOutput],
        { cwd: context.cwd, timeoutMs: 45000 }
      );

      return [
        `🧬 [ENCODE cCREs: Genomic Search]:`,
        `- Coordinates: ${chr}:${start}-${end}`,
        `- Saved File: ${defaultOutput}`,
        `- Output:\n${res.stdout || res.stderr}`,
      ].join('\n');
    }

    // 2. cCRE Details (Z-scores for DNase, H3K4me3, H3K27ac, CTCF)
    if (args.action === 'ccre_details') {
      if (!args.accession) {
        return '[ENCODE ERROR]: accession is required for ccre_details (e.g. EH38E2941922).';
      }

      const res = await ScienceSkillBridge.runScript(
        scriptPath,
        ['details', args.accession, '--output', defaultOutput],
        { cwd: context.cwd, timeoutMs: 45000 }
      );

      return [
        `🧬 [ENCODE cCREs: Epigenetic Element Details]:`,
        `- Accession: ${args.accession}`,
        `- Saved File: ${defaultOutput}`,
        `- Output:\n${res.stdout || res.stderr}`,
      ].join('\n');
    }

    // 3. Nearby Genes
    if (args.action === 'nearby_genes') {
      if (!args.accession) {
        return '[ENCODE ERROR]: accession is required for nearby_genes (e.g. EH38E1516972).';
      }

      const res = await ScienceSkillBridge.runScript(
        scriptPath,
        ['nearby-genes', args.accession, '--output', defaultOutput],
        { cwd: context.cwd, timeoutMs: 30000 }
      );

      return [
        `🧬 [ENCODE cCREs: Nearby Genes]:`,
        `- Accession: ${args.accession}`,
        `- Saved File: ${defaultOutput}`,
        `- Output:\n${res.stdout || res.stderr}`,
      ].join('\n');
    }

    // 4. Biosamples List (with Type A indicator)
    if (args.action === 'biosamples') {
      const res = await ScienceSkillBridge.runScript(
        scriptPath,
        ['biosamples', '--output', defaultOutput],
        { cwd: context.cwd, timeoutMs: 30000 }
      );

      return [
        `🧬 [ENCODE Biosamples: High-Confidence Epigenetic Targets]:`,
        `- Saved File: ${defaultOutput}`,
        `- Summary:\n${res.stdout || res.stderr}`,
      ].join('\n');
    }

    return '[ENCODE ERROR]: Unknown action. Available: search_ccres, ccre_details, nearby_genes, biosamples.';
  }
}
