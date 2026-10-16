import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';
import { ScienceSkillBridge } from '../../services/skills/ScienceSkillBridge.js';

export interface AlphaFoldArgs {
  action: 'fetch' | 'analyze_plddt' | 'analyze_pae';
  uniprotId?: string;
  metadataFile?: string;
  paeFile?: string;
  outputDir?: string;
}

export class AlphaFoldTool extends BaseTool<AlphaFoldArgs, string> {
  readonly name = 'alphafold_database';
  readonly description =
    'Query AlphaFold Database for 3D predicted structures (.cif), Predicted Aligned Error (PAE), and pLDDT confidence scores for a given UniProt ID.';
  readonly isReadOnly = false;
  readonly isDestructive = false;
  readonly requiresPermission = false;
  readonly isDeferred = true;

  readonly inputSchema = z.object({
    action: z
      .enum(['fetch', 'analyze_plddt', 'analyze_pae'])
      .describe('Action to execute: fetch (download structure and PAE), analyze_plddt, analyze_pae'),
    uniprotId: z
      .string()
      .optional()
      .describe('UniProt Accession ID (e.g. P04637, P00520)'),
    metadataFile: z
      .string()
      .optional()
      .describe('Path to downloaded -metadata.json file for analyze_plddt action'),
    paeFile: z
      .string()
      .optional()
      .describe('Path to downloaded _predicted_aligned_error.json file for analyze_pae action'),
    outputDir: z
      .string()
      .optional()
      .describe('Output directory to store downloaded structures (defaults to <cwd>/data/alphafold)'),
  });

  async execute(args: AlphaFoldArgs, context: ToolExecutionContext): Promise<string> {
    const scriptsDir = ScienceSkillBridge.getSkillScriptsDir('alphafold_database_fetch_and_analyze');
    if (!scriptsDir) {
      return '[ALPHAFOLD ERROR]: alphafold_database_fetch_and_analyze skill scripts directory not found.';
    }

    const targetOutputDir = args.outputDir || path.resolve(context.cwd, 'data', 'alphafold');
    if (!fs.existsSync(targetOutputDir)) {
      fs.mkdirSync(targetOutputDir, { recursive: true });
    }

    if (context.onProgress) {
      context.onProgress(`[AlphaFold]: Executing action "${args.action}" for UniProt "${args.uniprotId || 'custom'}"`);
    }

    if (args.action === 'fetch') {
      if (!args.uniprotId) {
        return '[ALPHAFOLD ERROR]: uniprotId is required for "fetch" action. Example: P04637';
      }

      const scriptPath = path.join(scriptsDir, 'fetch_structure.py');
      const res = await ScienceSkillBridge.runScript(scriptPath, [args.uniprotId, '-o', targetOutputDir], {
        cwd: context.cwd,
        timeoutMs: 90000,
      });

      if (!res.success) {
        return `[ALPHAFOLD FETCH FAILED]:\n${res.stderr || res.stdout}`;
      }

      return [
        `🧬 [AlphaFold Database: Structure Fetched Successfully]:`,
        `- UniProt ID: ${args.uniprotId}`,
        `- Destination: ${targetOutputDir}`,
        `- Output:\n${res.stdout.trim()}`,
        res.outputArtifacts.length > 0 ? `- Generated Files:\n${res.outputArtifacts.map((f) => `  * ${f}`).join('\n')}` : '',
      ].filter(Boolean).join('\n');
    }

    if (args.action === 'analyze_plddt') {
      const targetMeta = args.metadataFile || (args.uniprotId ? path.join(targetOutputDir, `AF-${args.uniprotId}-F1-metadata.json`) : '');
      if (!targetMeta || !fs.existsSync(targetMeta)) {
        return `[ALPHAFOLD ERROR]: Metadata file not found at: "${targetMeta}". Run action "fetch" first.`;
      }

      const scriptPath = path.join(scriptsDir, 'analyze_plddt.py');
      const res = await ScienceSkillBridge.runScript(scriptPath, [targetMeta], {
        cwd: context.cwd,
        timeoutMs: 45000,
      });

      return [
        `🧬 [AlphaFold pLDDT Confidence Analysis]:`,
        `- Metadata: ${targetMeta}`,
        `- Results:\n${res.stdout || res.stderr}`,
      ].join('\n');
    }

    if (args.action === 'analyze_pae') {
      const targetPae = args.paeFile || (args.uniprotId ? path.join(targetOutputDir, `AF-${args.uniprotId}-F1-predicted_aligned_error_v6.json`) : '');
      if (!targetPae || !fs.existsSync(targetPae)) {
        return `[ALPHAFOLD ERROR]: PAE JSON file not found at: "${targetPae}". Run action "fetch" first.`;
      }

      const scriptPath = path.join(scriptsDir, 'analyze_pae.py');
      const res = await ScienceSkillBridge.runScript(scriptPath, [targetPae], {
        cwd: context.cwd,
        timeoutMs: 60000,
      });

      return [
        `🧬 [AlphaFold PAE & Domain Boundary Analysis]:`,
        `- PAE File: ${targetPae}`,
        `- Results:\n${res.stdout || res.stderr}`,
      ].join('\n');
    }

    return '[ALPHAFOLD ERROR]: Unknown action. Available actions: fetch, analyze_plddt, analyze_pae.';
  }
}
