import { z } from 'zod';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';

export interface HuggingFaceHubArgs {
  action: 'search_models' | 'model_info' | 'search_datasets' | 'dataset_info' | 'fetch_config';
  query?: string;
  repoId?: string;
  filePath?: string;
  limit?: number;
  task?: string;
}

/**
 * HuggingFaceHubTool provides intelligence for searching, inspecting, and retrieving
 * state-of-the-art models, architectures, configs, and datasets from Hugging Face Hub.
 */
export class HuggingFaceHubTool extends BaseTool<HuggingFaceHubArgs, string> {
  readonly name = 'huggingface_hub';
  readonly description =
    'Search and inspect machine learning models, datasets, model cards, and architecture configs on Hugging Face Hub.';
  readonly isReadOnly = true;
  readonly isDestructive = false;
  readonly requiresPermission = false;
  readonly isDeferred = false;

  readonly inputSchema = z.object({
    action: z
      .enum(['search_models', 'model_info', 'search_datasets', 'dataset_info', 'fetch_config'])
      .describe('Action: search_models, model_info, search_datasets, dataset_info, or fetch_config'),
    query: z.string().optional().describe('Search keyword or task (e.g. "llama-3", "biomedical", "tabular")'),
    repoId: z.string().optional().describe('HuggingFace repository ID (e.g. "meta-llama/Llama-3-8B", "facebook/esm2_t33_650M_UR50D")'),
    filePath: z.string().optional().describe('File path in repo for fetch_config (e.g. "config.json", "tokenizer_config.json")'),
    limit: z.number().optional().describe('Maximum number of items to return (default: 5)'),
    task: z.string().optional().describe('Pipeline task tag (e.g. "text-generation", "feature-extraction", "image-classification")'),
  });

  async execute(args: HuggingFaceHubArgs, context: ToolExecutionContext): Promise<string> {
    const limit = Math.min(args.limit || 5, 20);

    if (context.onProgress) {
      context.onProgress(`[HuggingFace Hub]: Executing "${args.action}" on "${args.repoId || args.query || 'hub'}"`);
    }

    try {
      switch (args.action) {
        case 'search_models': {
          if (!args.query && !args.task) {
            return '[HF ERROR]: "query" or "task" is required for search_models.';
          }
          const params = new URLSearchParams({
            limit: String(limit),
            full: 'false',
            direction: '-1',
            sort: 'downloads',
          });
          if (args.query) params.set('search', args.query);
          if (args.task) params.set('filter', args.task);

          const url = `https://huggingface.co/api/models?${params.toString()}`;
          const res = await fetch(url, { headers: { 'User-Agent': 'InterShader-ML-Agent/1.0' } });
          if (!res.ok) {
            return `[HF ERROR]: Failed to search models (HTTP ${res.status}): ${await res.text()}`;
          }
          const data = (await res.json()) as Array<{
            id: string;
            downloads?: number;
            likes?: number;
            pipeline_tag?: string;
            private?: boolean;
          }>;

          if (!data || data.length === 0) {
            return `No HuggingFace models found for query: "${args.query || args.task}".`;
          }

          const lines: string[] = [
            `### Hugging Face Models for "${args.query || args.task}" (Top ${data.length})`,
            '',
          ];
          data.forEach((m, idx) => {
            lines.push(
              `${idx + 1}. **[${m.id}](https://huggingface.co/${m.id})** | Pipeline: \`${m.pipeline_tag || 'custom'}\` | Downloads: ${(m.downloads || 0).toLocaleString()} | Likes: ${m.likes || 0}`
            );
          });
          return lines.join('\n');
        }

        case 'model_info': {
          if (!args.repoId) {
            return '[HF ERROR]: "repoId" is required for model_info (e.g. "facebook/esm2_t33_650M_UR50D").';
          }
          const url = `https://huggingface.co/api/models/${encodeURIComponent(args.repoId)}`;
          const res = await fetch(url, { headers: { 'User-Agent': 'InterShader-ML-Agent/1.0' } });
          if (!res.ok) {
            return `[HF ERROR]: Model "${args.repoId}" not found or inaccessible (HTTP ${res.status}).`;
          }
          const info = (await res.json()) as any;
          return [
            `### Model Details: ${info.id}`,
            `- **Pipeline Tag**: ${info.pipeline_tag || 'N/A'}`,
            `- **Library**: ${info.library_name || 'pytorch'}`,
            `- **Downloads**: ${(info.downloads || 0).toLocaleString()}`,
            `- **Likes**: ${info.likes || 0}`,
            `- **Tags**: ${(info.tags || []).slice(0, 10).join(', ')}`,
            `- **Hub URL**: https://huggingface.co/${info.id}`,
            info.description ? `\n**Description**:\n${info.description.slice(0, 500)}...` : '',
          ].filter(Boolean).join('\n');
        }

        case 'search_datasets': {
          if (!args.query) {
            return '[HF ERROR]: "query" is required for search_datasets.';
          }
          const params = new URLSearchParams({
            search: args.query,
            limit: String(limit),
            full: 'false',
          });
          const url = `https://huggingface.co/api/datasets?${params.toString()}`;
          const res = await fetch(url, { headers: { 'User-Agent': 'InterShader-ML-Agent/1.0' } });
          if (!res.ok) {
            return `[HF ERROR]: Failed to search datasets (HTTP ${res.status}): ${await res.text()}`;
          }
          const datasets = (await res.json()) as Array<{
            id: string;
            downloads?: number;
            likes?: number;
          }>;
          if (!datasets || datasets.length === 0) {
            return `No HuggingFace datasets found for query: "${args.query}".`;
          }
          const lines: string[] = [
            `### Hugging Face Datasets for "${args.query}" (Top ${datasets.length})`,
            '',
          ];
          datasets.forEach((d, idx) => {
            lines.push(
              `${idx + 1}. **[${d.id}](https://huggingface.co/datasets/${d.id})** | Downloads: ${(d.downloads || 0).toLocaleString()} | Likes: ${d.likes || 0}`
            );
          });
          return lines.join('\n');
        }

        case 'dataset_info': {
          if (!args.repoId) {
            return '[HF ERROR]: "repoId" is required for dataset_info.';
          }
          const url = `https://huggingface.co/api/datasets/${encodeURIComponent(args.repoId)}`;
          const res = await fetch(url, { headers: { 'User-Agent': 'InterShader-ML-Agent/1.0' } });
          if (!res.ok) {
            return `[HF ERROR]: Dataset "${args.repoId}" not found (HTTP ${res.status}).`;
          }
          const info = (await res.json()) as any;
          return [
            `### Dataset Details: ${info.id}`,
            `- **Author**: ${info.author || 'community'}`,
            `- **Downloads**: ${(info.downloads || 0).toLocaleString()}`,
            `- **Likes**: ${info.likes || 0}`,
            `- **Tags**: ${(info.tags || []).slice(0, 10).join(', ')}`,
            `- **Hub URL**: https://huggingface.co/datasets/${info.id}`,
          ].join('\n');
        }

        case 'fetch_config': {
          if (!args.repoId) {
            return '[HF ERROR]: "repoId" is required for fetch_config.';
          }
          const file = args.filePath || 'config.json';
          const url = `https://huggingface.co/${args.repoId}/raw/main/${file}`;
          const res = await fetch(url, { headers: { 'User-Agent': 'InterShader-ML-Agent/1.0' } });
          if (!res.ok) {
            return `[HF ERROR]: Unable to fetch "${file}" from "${args.repoId}" (HTTP ${res.status}).`;
          }
          const content = await res.text();
          return `### Configuration File (${file}) for \`${args.repoId}\`:\n\`\`\`json\n${content.slice(0, 3000)}\n\`\`\``;
        }

        default:
          return `[HF ERROR]: Unsupported action "${(args as any).action}".`;
      }
    } catch (err) {
      return `[HF EXCEPTION]: ${(err as Error).message}`;
    }
  }
}
