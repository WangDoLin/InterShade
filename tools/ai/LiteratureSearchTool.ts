import { z } from 'zod';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';
import { exec } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export interface LiteratureSearchArgs {
  source: 'openalex' | 'arxiv' | 'biorxiv';
  query: string;
  action?: 'search' | 'resolve' | 'get' | 'sota_architecture';
  entityType?: 'works' | 'authors' | 'institutions' | 'topics';
  filter?: string;
  sortBy?: string;
  maxResults?: number;
}

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

/**
 * LiteratureSearchTool connects InterShade to scientific databases (OpenAlex, arXiv, bioRxiv)
 * to retrieve peer-reviewed research, cutting-edge architectures, mathematical formulations,
 * and baseline benchmark scores.
 */
export class LiteratureSearchTool extends BaseTool<LiteratureSearchArgs, string> {
  readonly name = 'literature_search';
  readonly description =
    'Search OpenAlex, arXiv, and bioRxiv for SOTA AI architectures, loss formulations, author/topic resolution, and benchmarks.';
  readonly isReadOnly = true;
  readonly isDestructive = false;
  readonly requiresPermission = false;
  readonly isDeferred = false;

  readonly inputSchema = z.object({
    source: z
      .enum(['openalex', 'arxiv', 'biorxiv'])
      .describe('Literature source: "openalex" (peer-reviewed & citations), "arxiv" (AI preprints), or "biorxiv" (biological AI)'),
    query: z.string().describe('Search query, concept, entity name, DOI, or ID (e.g. "transformer architecture", "AlphaFold 3", "W2741809807")'),
    action: z
      .enum(['search', 'resolve', 'get', 'sota_architecture'])
      .optional()
      .describe('Action: "search" (default), "resolve" (name to ID candidates), "get" (single ID/DOI), "sota_architecture" (architecture extraction)'),
    entityType: z
      .enum(['works', 'authors', 'institutions', 'topics'])
      .optional()
      .describe('Entity type for OpenAlex queries (default: works)'),
    filter: z.string().optional().describe('OpenAlex filter expression (e.g. "publication_year:>=2023,is_oa:true")'),
    sortBy: z.string().optional().describe('Sort order (e.g. "cited_by_count:desc" or "publication_year:desc")'),
    maxResults: z.number().optional().describe('Maximum papers/entities to return (default: 5)'),
  });

  async execute(args: LiteratureSearchArgs, context: ToolExecutionContext): Promise<string> {
    const limit = Math.min(args.maxResults || DEFAULT_LIMIT, MAX_LIMIT);
    const action = args.action || 'search';

    if (context.onProgress) {
      context.onProgress(`[Literature Search]: Executing "${action}" on ${args.source.toUpperCase()} ("${args.query}")`);
    }

    try {
      if (args.source === 'openalex') {
        return await this.handleOpenAlex(args, limit);
      }
      if (args.source === 'arxiv') {
        return await this.searchArxiv(args.query, limit);
      }
      if (args.source === 'biorxiv') {
        return await this.searchBiorxiv(args.query, limit);
      }
      return `[LITERATURE ERROR]: Unknown source "${args.source}".`;
    } catch (err) {
      return `[LITERATURE EXCEPTION]: ${(err as Error).message}`;
    }
  }

  /**
   * Dispatches OpenAlex operations across CLI and REST fallback
   */
  private async handleOpenAlex(args: LiteratureSearchArgs, limit: number): Promise<string> {
    const action = args.action || 'search';
    const entity = args.entityType || 'works';
    const cliPath = this.getOpenAlexCliPath();

    if (action === 'resolve') {
      return this.resolveOpenAlexEntity(cliPath, entity, args.query, limit);
    }
    if (action === 'get') {
      return this.getOpenAlexEntity(cliPath, entity, args.query);
    }
    if (action === 'sota_architecture') {
      return this.searchSotaArchitecture(cliPath, args.query, limit);
    }

    return this.searchOpenAlex(cliPath, args.query, limit, args.filter, args.sortBy);
  }

  private getOpenAlexCliPath(): string {
    return path.join(
      os.homedir(),
      '.gemini',
      'config',
      'plugins',
      'science',
      'skills',
      'literature_search_openalex',
      'scripts',
      'openalex_cli.py'
    );
  }

  /**
   * Search OpenAlex works with optional filter and sort
   */
  private async searchOpenAlex(
    cli: string,
    query: string,
    limit: number,
    filterExpr?: string,
    sortBy?: string
  ): Promise<string> {
    if (fs.existsSync(cli)) {
      const sort = sortBy || 'cited_by_count:desc';
      const filterPart = filterExpr ? `,${filterExpr}` : '';
      const cmd = `uv run "${cli}" filter works --filter "default.search:${query}${filterPart}" --sort "${sort}" --per-page ${limit} --select id,display_name,publication_year,cited_by_count,doi`;
      const cliRes = await this.runProcess(cmd);
      if (cliRes) return cliRes;
    }

    return this.searchOpenAlexRest(query, limit, filterExpr, sortBy);
  }

  /**
   * Resolves entity name to candidates (Authors, Institutions, Topics)
   */
  private async resolveOpenAlexEntity(cli: string, entity: string, query: string, limit: number): Promise<string> {
    if (fs.existsSync(cli)) {
      const cmd = `uv run "${cli}" resolve ${entity} "${query}" --per-page ${limit}`;
      const res = await this.runProcess(cmd);
      if (res) return res;
    }

    const url = `https://api.openalex.org/autocomplete/${entity}?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'InterShader-Literature-Agent/1.0' } });
    if (!res.ok) return `[OpenAlex Autocomplete Error HTTP ${res.status}]`;
    const data = (await res.json()) as any;
    const results = data.results || [];
    const lines = [`### OpenAlex Resolved Entities (${entity}) for "${query}":`, ''];
    results.slice(0, limit).forEach((r: any, idx: number) => {
      lines.push(`${idx + 1}. **${r.display_name}** (\`${r.id}\`) - *${r.hint || 'No hint'}*`);
    });
    return lines.join('\n');
  }

  /**
   * Retrieves single work or entity details by ID or DOI
   */
  private async getOpenAlexEntity(cli: string, entity: string, id: string): Promise<string> {
    if (fs.existsSync(cli)) {
      const cmd = `uv run "${cli}" get ${entity} "${id}" --select id,display_name,publication_year,cited_by_count,doi,concepts`;
      const res = await this.runProcess(cmd);
      if (res) return res;
    }

    const cleanId = id.replace('https://doi.org/', 'https://openalex.org/doi:');
    const url = `https://api.openalex.org/${entity}/${encodeURIComponent(cleanId)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'InterShader-Literature-Agent/1.0' } });
    if (!res.ok) return `[OpenAlex Get Error HTTP ${res.status}]: Entity "${id}" not found.`;
    const data = (await res.json()) as any;
    return [
      `### OpenAlex Entity Details: ${data.display_name || data.title}`,
      `- **ID**: \`${data.id}\``,
      `- **DOI**: ${data.doi || 'N/A'}`,
      `- **Year**: ${data.publication_year || 'N/A'}`,
      `- **Citations**: ${(data.cited_by_count || 0).toLocaleString()}`,
      data.concepts ? `- **Key Concepts**: ${data.concepts.slice(0, 5).map((c: any) => c.display_name).join(', ')}` : '',
    ].filter(Boolean).join('\n');
  }

  /**
   * SOTA Architecture extraction combining search and baseline recommendations
   */
  private async searchSotaArchitecture(cli: string, query: string, limit: number): Promise<string> {
    const rawSearch = await this.searchOpenAlex(cli, `${query} neural network architecture benchmark`, limit);
    return [
      `### SOTA Literature Grounding: "${query}"`,
      `- **Objective**: Extract peer-reviewed architectures, loss functions, and benchmark baselines for model building.`,
      '',
      rawSearch,
      '',
      `#### Recommended Model Grounding for PyTorch Scaffolding:`,
      `1. **Backbone**: Consider Transformer or State-Space (Mamba) variant based on sequence length.`,
      `2. **Loss Formulation**: Utilize robust multi-task loss with Cosine Annealing scheduler.`,
      `3. **Sanity Gate**: Confirm 1-batch overfit convergence before scaling.`,
    ].join('\n');
  }

  /**
   * Direct OpenAlex REST API fallback
   */
  private async searchOpenAlexRest(query: string, limit: number, filterExpr?: string, sortBy?: string): Promise<string> {
    const params = new URLSearchParams({ search: query, 'per-page': String(limit) });
    if (filterExpr) params.set('filter', filterExpr);
    if (sortBy) params.set('sort', sortBy);

    const url = `https://api.openalex.org/works?${params.toString()}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'InterShader-Literature-Agent/1.0' } });
    if (!res.ok) return `[OpenAlex REST Error HTTP ${res.status}]: ${await res.text()}`;
    const data = (await res.json()) as any;
    const results = data.results || [];
    if (results.length === 0) return `No papers found on OpenAlex for "${query}".`;

    const lines: string[] = [`### OpenAlex Scholarly Results for "${query}" (Top ${results.length})`, ''];
    results.forEach((item: any, idx: number) => {
      const title = item.title || item.display_name || 'Untitled';
      const year = item.publication_year || 'N/A';
      const cited = item.cited_by_count || 0;
      const doi = item.doi || item.id;
      lines.push(`${idx + 1}. **[${title}](${doi})** (${year}) | Citations: ${cited.toLocaleString()}`);
    });
    return lines.join('\n');
  }

  private async searchArxiv(query: string, limit: number): Promise<string> {
    const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${limit}&sortBy=relevance&sortOrder=descending`;
    const res = await fetch(url, { headers: { 'User-Agent': 'InterShader-ML-Agent/1.0' } });
    if (!res.ok) return `[arXiv Error HTTP ${res.status}]: Failed to fetch results.`;
    const xml = await res.text();

    const entries: Array<{ title: string; summary: string; id: string; published: string }> = [];
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let match: RegExpExecArray | null;

    while ((match = entryRegex.exec(xml)) !== null && entries.length < limit) {
      const block = match[1];
      const titleMatch = /<title>([\s\S]*?)<\/title>/.exec(block);
      const summaryMatch = /<summary>([\s\S]*?)<\/summary>/.exec(block);
      const idMatch = /<id>([\s\S]*?)<\/id>/.exec(block);
      const publishedMatch = /<published>([\s\S]*?)<\/published>/.exec(block);

      if (titleMatch && idMatch) {
        entries.push({
          title: titleMatch[1].replace(/\s+/g, ' ').trim(),
          summary: summaryMatch ? summaryMatch[1].replace(/\s+/g, ' ').trim() : '',
          id: idMatch[1].trim(),
          published: publishedMatch ? publishedMatch[1].slice(0, 10) : '',
        });
      }
    }

    if (entries.length === 0) return `No papers found on arXiv for "${query}".`;
    const lines: string[] = [`### arXiv Preprints for "${query}" (Top ${entries.length})`, ''];
    entries.forEach((e, idx) => {
      lines.push(`${idx + 1}. **[${e.title}](${e.id})** (${e.published})`);
      if (e.summary) lines.push(`   *Summary*: ${e.summary.slice(0, 240)}...`);
    });
    return lines.join('\n');
  }

  private async searchBiorxiv(query: string, limit: number): Promise<string> {
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query + ' (SRC:PPR OR SRC:MED)')}&format=json&pageSize=${limit}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'InterShader-ML-Agent/1.0' } });
    if (!res.ok) return `[bioRxiv/EuropePMC Error HTTP ${res.status}]: Failed to fetch literature.`;
    const data = (await res.json()) as any;
    const items = data.resultList?.result || [];
    if (items.length === 0) return `No preprints found on bioRxiv/EuropePMC for "${query}".`;

    const lines: string[] = [`### bioRxiv / Europe PMC Preprints for "${query}" (Top ${items.length})`, ''];
    items.forEach((item: any, idx: number) => {
      const doi = item.doi ? `https://doi.org/${item.doi}` : `https://europepmc.org/article/${item.source}/${item.id}`;
      lines.push(`${idx + 1}. **[${item.title || 'Untitled'}](${doi})** (${item.pubYear || 'N/A'}) | Authors: ${item.authorString || 'Unknown'}`);
    });
    return lines.join('\n');
  }

  private runProcess(cmd: string): Promise<string | null> {
    return new Promise((resolve) => {
      exec(cmd, { timeout: 30000 }, (error, stdout) => {
        if (error || !stdout.trim()) resolve(null);
        else resolve(stdout.trim());
      });
    });
  }
}
