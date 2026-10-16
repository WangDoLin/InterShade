import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';
import { ScienceSkillBridge } from '../../services/skills/ScienceSkillBridge.js';

export interface HumanProteinAtlasArgs {
  action: 'resolve_ensembl_id' | 'get_tissue_expression' | 'get_subcellular_location' | 'get_atlas_entry';
  geneSymbol?: string;
  ensemblId?: string;
  tissues?: string;
  outputFile?: string;
}

export class HumanProteinAtlasTool extends BaseTool<HumanProteinAtlasArgs, string> {
  readonly name = 'human_protein_atlas';
  readonly description =
    'Retrieve semi-quantitative protein expression across human tissues (IHC: High, Medium, Low, Not Detected) and subcellular organelle localization from the Human Protein Atlas (HPA).';
  readonly isReadOnly = true;
  readonly isDestructive = false;
  readonly requiresPermission = false;
  readonly isDeferred = true;

  readonly inputSchema = z.object({
    action: z
      .enum(['resolve_ensembl_id', 'get_tissue_expression', 'get_subcellular_location', 'get_atlas_entry'])
      .describe('Action to execute on Human Protein Atlas'),
    geneSymbol: z
      .string()
      .optional()
      .describe('Gene symbol (e.g. TP53, ERBB2, EGFR) for resolve_ensembl_id or convenience'),
    ensemblId: z
      .string()
      .optional()
      .describe('Ensembl Gene ID (e.g. ENSG00000141510) for tissue and subcellular queries'),
    tissues: z
      .string()
      .optional()
      .describe('Comma-separated list of tissues to filter (e.g. "liver,kidney,cerebral cortex")'),
    outputFile: z
      .string()
      .optional()
      .describe('Output JSON file path (defaults to /tmp/hpa_output.json or local scratch)'),
  });

  async execute(args: HumanProteinAtlasArgs, context: ToolExecutionContext): Promise<string> {
    const scriptsDir = ScienceSkillBridge.getSkillScriptsDir('human_protein_atlas_database');
    if (!scriptsDir) {
      return '[HPA ERROR]: human_protein_atlas_database skill scripts directory not found.';
    }

    const scriptPath = path.join(scriptsDir, 'hpa_cli.py');
    const defaultOutput = args.outputFile || path.resolve(context.cwd, 'data', 'hpa_output.json');
    const outDir = path.dirname(defaultOutput);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    if (context.onProgress) {
      context.onProgress(`[HumanProteinAtlas]: Executing "${args.action}" on "${args.geneSymbol || args.ensemblId || 'query'}"`);
    }

    // 1. Resolve gene symbol to Ensembl ID
    if (args.action === 'resolve_ensembl_id') {
      const symbol = args.geneSymbol || 'TP53';
      const res = await ScienceSkillBridge.runScript(
        scriptPath,
        ['resolve-ensembl-id', symbol, '--output', defaultOutput],
        { cwd: context.cwd, timeoutMs: 30000 }
      );

      if (!res.success) {
        return `[HPA RESOLVE FAILED]:\n${res.stderr || res.stdout}`;
      }

      let parsedContent = res.stdout;
      if (fs.existsSync(defaultOutput)) {
        try {
          parsedContent = fs.readFileSync(defaultOutput, 'utf-8');
        } catch {
          // ignore read error
        }
      }

      return [
        `🧬 [Human Protein Atlas: Ensembl Resolution]:`,
        `- Gene Symbol: ${symbol}`,
        `- Result:\n${parsedContent}`,
      ].join('\n');
    }

    // 2. Tissue expression
    if (args.action === 'get_tissue_expression') {
      const ensembl = args.ensemblId || (args.geneSymbol === 'TP53' ? 'ENSG00000141510' : undefined);
      if (!ensembl) {
        return '[HPA ERROR]: ensemblId is required for get_tissue_expression. Run resolve_ensembl_id first.';
      }

      const scriptArgs = ['get-tissue-expression', ensembl, '--output', defaultOutput];
      if (args.tissues) {
        scriptArgs.push('--tissues', args.tissues);
      }

      const res = await ScienceSkillBridge.runScript(scriptPath, scriptArgs, {
        cwd: context.cwd,
        timeoutMs: 45000,
      });

      return [
        `🧬 [Human Protein Atlas: Tissue Protein Expression]:`,
        `- Ensembl ID: ${ensembl}`,
        `- Tissues: ${args.tissues || 'All standard tissues'}`,
        `- Result:\n${res.stdout || res.stderr}`,
      ].join('\n');
    }

    // 3. Subcellular localization
    if (args.action === 'get_subcellular_location') {
      const ensembl = args.ensemblId || (args.geneSymbol === 'TP53' ? 'ENSG00000141510' : undefined);
      if (!ensembl) {
        return '[HPA ERROR]: ensemblId is required for get_subcellular_location. Run resolve_ensembl_id first.';
      }

      const res = await ScienceSkillBridge.runScript(
        scriptPath,
        ['get-subcellular-location', ensembl, '--output', defaultOutput],
        { cwd: context.cwd, timeoutMs: 30000 }
      );

      return [
        `🧬 [Human Protein Atlas: Subcellular Localization]:`,
        `- Ensembl ID: ${ensembl}`,
        `- Result:\n${res.stdout || res.stderr}`,
      ].join('\n');
    }

    // 4. Full atlas entry
    if (args.action === 'get_atlas_entry') {
      const ensembl = args.ensemblId || (args.geneSymbol === 'TP53' ? 'ENSG00000141510' : undefined);
      if (!ensembl) {
        return '[HPA ERROR]: ensemblId is required for get_atlas_entry. Run resolve_ensembl_id first.';
      }

      const res = await ScienceSkillBridge.runScript(
        scriptPath,
        ['get-atlas-entry', ensembl, '--output', defaultOutput],
        { cwd: context.cwd, timeoutMs: 45000 }
      );

      return [
        `🧬 [Human Protein Atlas: Full Entry Metadata]:`,
        `- Ensembl ID: ${ensembl}`,
        `- Saved Output: ${defaultOutput}`,
        `- Summary:\n${res.stdout || res.stderr}`,
      ].join('\n');
    }

    return '[HPA ERROR]: Unknown action. Available: resolve_ensembl_id, get_tissue_expression, get_subcellular_location, get_atlas_entry.';
  }
}
