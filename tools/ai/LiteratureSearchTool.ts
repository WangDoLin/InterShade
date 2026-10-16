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
  maxResults?: number;
}

/**
 * LiteratureSearchTool connects InterShade to scientific databases (OpenAlex, arXiv, bioRxiv)
 * to retrieve peer-reviewed research, cutting-edge architectures, mathematical formulations,
 * and baseline benchmark scores.
 */
export class LiteratureSearchTool extends BaseTool<LiteratureSearchArgs, string> {
  readonly name = 'literature_search';
  readonly description =
    'Search peer-reviewed papers and preprints on OpenAlex, arXiv, and bioRxiv for SOTA AI architectures, loss formulations, and benchmarks.';
  readonly isReadOnly = true;
  readonly isDestructive = false;
  readonly requiresPermission = false;
  readonly isDeferred = false;

  readonly inputSchema = z.object({
    source: z
      .enum(['openalex', 'arxiv', 'biorxiv'])
      .describe('Literature source: "openalex" (peer-reviewed & citations), "arxiv" (AI preprints), or "biorxiv" (biological AI)'),
    query: z.string().describe('Search query, concept, or author (e.g. "transformer architecture", "AlphaFold 3", "Mamba state space")'),
    maxResults: z.number().optional().describe('Maximum papers to return (default: 5)'),
  });

  async execute(args: LiteratureSearchArgs, context: ToolExecutionContext): Promise<string> {
    const maxResults = Math.min(args.maxResults || 5, 10);

    if (context.onProgress) {
      context.onProgress(`[Literature Search]: Searching "${args.query}" on ${args.source.toUpperCase()}`);
    }

    try {
      if (args.source === 'openalex') {
        return await this.searchOpenAlex(args.query, maxResults);
      } else if (args.source === 'arxiv') {
        return await this.searchArxiv(args.query, maxResults);
      } else if (args.source === 'biorxiv') {
        return await this.searchBiorxiv(args.query, maxResults);
      }
      return `[LITERATURE ERROR]: Unknown source "${args.source}".`;
    } catch (err) {
      return `[LITERATURE EXCEPTION]: ${(err as Error).message}`;
    }
  }

  private async searchOpenAlex(query: string, limit: number): Promise<string> {
    const openalexCli = path.join(
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

    if (!fs.existsSync(openalexCli)) {
      // Fallback to direct OpenAlex REST API if CLI script not present
      const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${limit}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'InterShader-Literature-Agent/1.0' } });
      if (!res.ok) {
        return `[OpenAlex REST Error HTTP ${res.status}]: ${await res.text()}`;
      }
      const data = (await res.json()) as any;
      const results = data.results || [];
      if (results.length === 0) return `No papers found on OpenAlex for "${query}".`;

      const lines: string[] = [`### OpenAlex Scholarly Results for "${query}" (Top ${results.length})`, ''];
      results.forEach((item: any, idx: number) => {
        const title = item.title || item.display_name || 'Untitled';
        const year = item.publication_year || 'Unknown Year';
        const cited = item.cited_by_count || 0;
        const doi = item.doi || (item.ids && item.ids.doi) || item.id;
        lines.push(`${idx + 1}. **[${title}](${doi})** (${year}) | Citations: ${cited.toLocaleString()}`);
      });
      return lines.join('\n');
    }

    return new Promise((resolve) => {
      // Execute via uv run
      const cmd = `uv run "${openalexCli}" filter works --filter default.search:${JSON.stringify(query)} --per-page ${limit} --select id,display_name,publication_year,cited_by_count,doi`;
      exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
        if (error) {
          // Fallback to direct REST API
          this.searchOpenAlexFallback(query, limit).then(resolve);
          return;
        }
        resolve(stdout.trim() || stderr.trim() || 'No results returned from OpenAlex CLI.');
      });
    });
  }

  private async searchOpenAlexFallback(query: string, limit: number): Promise<string> {
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${limit}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'InterShader-Literature-Agent/1.0' } });
    if (!res.ok) return `OpenAlex search failed for "${query}".`;
    const data = (await res.json()) as any;
    const results = data.results || [];
    const lines = [`### OpenAlex Results for "${query}" (Top ${results.length})`, ''];
    results.forEach((item: any, idx: number) => {
      lines.push(`${idx + 1}. **[${item.title || 'Untitled'}](${item.doi || item.id})** (${item.publication_year || 'N/A'}) - Citations: ${item.cited_by_count || 0}`);
    });
    return lines.join('\n');
  }

  private async searchArxiv(query: string, limit: number): Promise<string> {
    const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${limit}&sortBy=relevance&sortOrder=descending`;
    const res = await fetch(url, { headers: { 'User-Agent': 'InterShader-ML-Agent/1.0' } });
    if (!res.ok) {
      return `[arXiv Error HTTP ${res.status}]: Failed to fetch results.`;
    }
    const xml = await res.text();

    // Parse arXiv Atom feed entries using regex
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

    if (entries.length === 0) {
      return `No papers found on arXiv for "${query}".`;
    }

    const lines: string[] = [`### arXiv Preprints for "${query}" (Top ${entries.length})`, ''];
    entries.forEach((e, idx) => {
      lines.push(`${idx + 1}. **[${e.title}](${e.id})** (${e.published})`);
      if (e.summary) {
        lines.push(`   *Summary*: ${e.summary.slice(0, 240)}...`);
      }
      lines.push('');
    });
    return lines.join('\n').trim();
  }

  private async searchBiorxiv(query: string, limit: number): Promise<string> {
    // Search bioRxiv using Europe PMC or direct bioRxiv API
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query + ' (SRC:PPR OR SRC:MED)')}&format=json&pageSize=${limit}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'InterShader-ML-Agent/1.0' } });
    if (!res.ok) {
      return `[bioRxiv/EuropePMC Error HTTP ${res.status}]: Failed to fetch literature.`;
    }
    const data = (await res.json()) as any;
    const items = data.resultList?.result || [];
    if (items.length === 0) {
      return `No preprints found on bioRxiv/EuropePMC for "${query}".`;
    }

    const lines: string[] = [`### bioRxiv / Europe PMC Preprints for "${query}" (Top ${items.length})`, ''];
    items.forEach((item: any, idx: number) => {
      const doi = item.doi ? `https://doi.org/${item.doi}` : `https://europepmc.org/article/${item.source}/${item.id}`;
      lines.push(`${idx + 1}. **[${item.title || 'Untitled'}](${doi})** (${item.pubYear || 'N/A'}) | Authors: ${item.authorString || 'Unknown'}`);
    });
    return lines.join('\n');
  }
}
