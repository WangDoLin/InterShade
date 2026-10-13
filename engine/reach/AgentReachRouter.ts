import { NetworkGuard } from '../../providers/security/NetworkGuard.js';
import { SecretSanitizer } from '../../providers/security/SecretSanitizer.js';

export interface WebReadResult {
  url: string;
  markdown: string;
  source: 'jina-reader' | 'direct-fallback' | 'error';
  latencyMs: number;
  httpStatus?: number;
}

export interface GithubResearchResult {
  repo: string;
  resource: 'readme' | 'issue' | 'file';
  path?: string;
  content: string;
  success: boolean;
  httpStatus?: number;
}

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResult {
  query: string;
  results: WebSearchResultItem[];
  rawMarkdown?: string;
  source: 'jina-search' | 'duckduckgo-fallback' | 'error';
  latencyMs: number;
  httpStatus?: number;
}

export class AgentReachRouter {
  private static readonly JINA_READER_PREFIX = 'https://r.jina.ai/';
  private static readonly JINA_SEARCH_PREFIX = 'https://s.jina.ai/';

  /**
   * Convert any public web page, blog, issue, or doc into clean LLM-ready Markdown
   * using Jina Reader protocol with automatic fallback to safe direct fetch.
   */
  static async webRead(
    targetUrl: string,
    options: {
      timeoutMs?: number;
      isLocalAllowed?: boolean;
    } = {}
  ): Promise<WebReadResult> {
    const timeoutMs = options.timeoutMs ?? 10000;
    const isLocalAllowed = Boolean(options.isLocalAllowed);
    const startTime = Date.now();

    // 1. Primary Route: Jina Reader protocol
    const jinaTarget = `${AgentReachRouter.JINA_READER_PREFIX}${encodeURI(targetUrl)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await NetworkGuard.safeFetch(
        jinaTarget,
        {
          method: 'GET',
          headers: {
            'Accept': 'text/markdown, text/plain, */*',
            'User-Agent': 'InterShader-Agent-Reach/1.0',
          },
          signal: controller.signal,
        },
        { isLocalAllowed }
      );

      clearTimeout(timer);

      if (response.ok) {
        const rawText = await response.text();
        const sanitized = SecretSanitizer.sanitize(rawText);
        return {
          url: targetUrl,
          markdown: sanitized,
          source: 'jina-reader',
          latencyMs: Date.now() - startTime,
          httpStatus: response.status,
        };
      }
    } catch {
      clearTimeout(timer);
      // Primary route failed or timed out; proceed to fallback route
    }

    // 2. Fallback Route: Direct safe fetch with HTML stripping
    const fallbackController = new AbortController();
    const fallbackTimer = setTimeout(() => fallbackController.abort(), timeoutMs);

    try {
      const directResponse = await NetworkGuard.safeFetch(
        targetUrl,
        {
          method: 'GET',
          headers: {
            'User-Agent': 'InterShader-Agent-Reach/1.0 (Fallback)',
          },
          signal: fallbackController.signal,
        },
        { isLocalAllowed }
      );

      clearTimeout(fallbackTimer);

      if (directResponse.ok) {
        const rawContent = await directResponse.text();
        // Convert basic HTML to clean markdown text
        const cleaned = rawContent
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        return {
          url: targetUrl,
          markdown: SecretSanitizer.sanitize(cleaned),
          source: 'direct-fallback',
          latencyMs: Date.now() - startTime,
          httpStatus: directResponse.status,
        };
      }

      return {
        url: targetUrl,
        markdown: `Failed to fetch URL (HTTP ${directResponse.status}): ${directResponse.statusText}`,
        source: 'error',
        latencyMs: Date.now() - startTime,
        httpStatus: directResponse.status,
      };
    } catch (err: unknown) {
      clearTimeout(fallbackTimer);
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        url: targetUrl,
        markdown: SecretSanitizer.sanitize(`Fetch error: ${errMsg}`),
        source: 'error',
        latencyMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Directly inspect GitHub repositories, READMEs, or specific code files without cloning
   */
  static async githubResearch(
    repoPath: string,
    resource: 'readme' | 'issue' | 'file',
    filePath?: string,
    options: { timeoutMs?: number; branch?: string } = {}
  ): Promise<GithubResearchResult> {
    const cleanRepo = repoPath.replace(/^https?:\/\/github\.com\//, '').replace(/\/+$/, '');
    const branch = options.branch || 'main';
    const timeoutMs = options.timeoutMs ?? 10000;

    let targetUrl: string;
    if (resource === 'readme') {
      targetUrl = `https://raw.githubusercontent.com/${cleanRepo}/${branch}/README.md`;
    } else if (resource === 'file') {
      const p = filePath ? filePath.replace(/^\/+/, '') : 'package.json';
      targetUrl = `https://raw.githubusercontent.com/${cleanRepo}/${branch}/${p}`;
    } else {
      targetUrl = `https://api.github.com/repos/${cleanRepo}/issues`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await NetworkGuard.safeFetch(
        targetUrl,
        {
          headers: {
            'User-Agent': 'InterShader-Agent-Reach/1.0',
            'Accept': 'text/plain, application/json, */*',
          },
          signal: controller.signal,
        },
        { isLocalAllowed: false }
      );

      clearTimeout(timer);

      if (response.ok) {
        const text = await response.text();
        return {
          repo: cleanRepo,
          resource,
          path: filePath,
          content: SecretSanitizer.sanitize(text),
          success: true,
          httpStatus: response.status,
        };
      }

      // If main branch fails for readme, try master branch fallback
      if (resource === 'readme' && branch === 'main') {
        return AgentReachRouter.githubResearch(repoPath, resource, filePath, {
          ...options,
          branch: 'master',
        });
      }

      return {
        repo: cleanRepo,
        resource,
        path: filePath,
        content: `GitHub resource not found (HTTP ${response.status})`,
        success: false,
        httpStatus: response.status,
      };
    } catch (err: unknown) {
      clearTimeout(timer);
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        repo: cleanRepo,
        resource,
        path: filePath,
        content: SecretSanitizer.sanitize(`GitHub request error: ${errMsg}`),
        success: false,
      };
    }
  }

  /**
   * Search the public web for documentation, libraries, guides, or error solutions
   * with Jina Search as primary protocol and DuckDuckGo HTML as fallback.
   */
  static async webSearch(
    query: string,
    options: { maxResults?: number; timeoutMs?: number; isLocalAllowed?: boolean } = {}
  ): Promise<WebSearchResult> {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      return {
        query: '',
        results: [],
        source: 'error',
        latencyMs: 0,
        rawMarkdown: 'Search query cannot be empty.',
      };
    }

    const maxResults = options.maxResults ?? 5;
    const timeoutMs = options.timeoutMs ?? 10000;
    const isLocalAllowed = Boolean(options.isLocalAllowed);
    const startTime = Date.now();

    // 1. Primary Route: Jina Search Protocol
    const jinaRes = await AgentReachRouter.searchJina(cleanQuery, maxResults, timeoutMs, isLocalAllowed);
    if (jinaRes && jinaRes.results.length > 0) {
      return {
        query: cleanQuery,
        results: jinaRes.results,
        rawMarkdown: SecretSanitizer.sanitize(jinaRes.raw),
        source: 'jina-search',
        latencyMs: Date.now() - startTime,
        httpStatus: jinaRes.status,
      };
    }

    // 2. Fallback Route: DuckDuckGo HTML Search
    const ddgRes = await AgentReachRouter.searchDuckDuckGo(cleanQuery, maxResults, timeoutMs, isLocalAllowed);
    if (ddgRes && ddgRes.results.length > 0) {
      return {
        query: cleanQuery,
        results: ddgRes.results,
        source: 'duckduckgo-fallback',
        latencyMs: Date.now() - startTime,
        httpStatus: ddgRes.status,
      };
    }

    return {
      query: cleanQuery,
      results: [],
      source: 'error',
      latencyMs: Date.now() - startTime,
      rawMarkdown: SecretSanitizer.sanitize(`No search results returned for "${cleanQuery}".`),
    };
  }

  private static async searchJina(
    query: string,
    maxResults: number,
    timeoutMs: number,
    isLocalAllowed: boolean
  ): Promise<{ results: WebSearchResultItem[]; raw: string; status: number } | null> {
    const targetUrl = `${AgentReachRouter.JINA_SEARCH_PREFIX}${encodeURIComponent(query)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await NetworkGuard.safeFetch(
        targetUrl,
        {
          headers: {
            'Accept': 'application/json, text/markdown, */*',
            'User-Agent': 'InterShader-Agent-Reach/1.0',
          },
          signal: controller.signal,
        },
        { isLocalAllowed }
      );
      clearTimeout(timer);

      if (!response.ok) return null;
      const rawText = await response.text();
      const results = AgentReachRouter.parseJinaResponse(rawText, maxResults);
      return { results, raw: rawText, status: response.status };
    } catch {
      clearTimeout(timer);
      return null;
    }
  }

  private static parseJinaResponse(rawText: string, maxResults: number): WebSearchResultItem[] {
    const items: WebSearchResultItem[] = [];

    // Attempt JSON parsing if Jina returned a JSON array
    try {
      const json = JSON.parse(rawText);
      const list = Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
      for (const item of list) {
        if (item.url && (item.title || item.description)) {
          items.push({
            title: item.title || item.url,
            url: item.url,
            snippet: (item.description || item.content || '').slice(0, 300).trim(),
          });
          if (items.length >= maxResults) return items;
        }
      }
    } catch {
      // Markdown fallback format parsing
    }

    // Parse Markdown blocks: Title and URL Source patterns
    const regex = /(?:\[\d+\]\s*)?Title:\s*([^\n]+)\s*\n+(?:\[\d+\]\s*)?URL Source:\s*(https?:\/\/[^\s\n]+)(?:\s*\n+(?:\[\d+\]\s*)?Markdown Content:\s*([^\n]+))?/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(rawText)) !== null) {
      items.push({
        title: match[1].trim(),
        url: match[2].trim(),
        snippet: (match[3] || '').slice(0, 300).trim(),
      });
      if (items.length >= maxResults) break;
    }

    // Additional fallback: Markdown links [Title](https://...)
    if (items.length === 0) {
      const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
      while ((match = linkRegex.exec(rawText)) !== null) {
        if (!match[2].includes('jina.ai')) {
          items.push({
            title: match[1].trim(),
            url: match[2].trim(),
            snippet: '',
          });
          if (items.length >= maxResults) break;
        }
      }
    }

    return items;
  }

  private static async searchDuckDuckGo(
    query: string,
    maxResults: number,
    timeoutMs: number,
    isLocalAllowed: boolean
  ): Promise<{ results: WebSearchResultItem[]; status: number } | null> {
    const targetUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await NetworkGuard.safeFetch(
        targetUrl,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 InterShader/1.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          signal: controller.signal,
        },
        { isLocalAllowed }
      );
      clearTimeout(timer);

      if (!response.ok) return null;
      const html = await response.text();
      const results = AgentReachRouter.parseDuckDuckGoHtml(html, maxResults);
      return { results, status: response.status };
    } catch {
      clearTimeout(timer);
      return null;
    }
  }

  private static decodeHtmlEntities(str: string): string {
    return str
      .replace(/&#x27;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private static parseDuckDuckGoHtml(html: string, maxResults: number): WebSearchResultItem[] {
    const items: WebSearchResultItem[] = [];
    const titleRegex =
      /<a[^>]*\bclass="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>|<a[^>]*href="([^"]+)"[^>]*\bclass="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    const titles: Array<{ url: string; title: string }> = [];
    let match: RegExpExecArray | null;

    while ((match = titleRegex.exec(html)) !== null) {
      let rawHref = match[1] || match[3] || '';
      if (rawHref.includes('uddg=')) {
        const extracted = rawHref.split('uddg=')[1]?.split(/&amp;|&/)[0];
        if (extracted) rawHref = decodeURIComponent(extracted);
      }
      if (rawHref.startsWith('//')) {
        rawHref = `https:${rawHref}`;
      }
      // Skip promotional ads
      if (rawHref.includes('duckduckgo.com/y.js') || rawHref.includes('ad_domain=')) {
        continue;
      }
      const rawTitle = match[2] || match[4] || '';
      const cleanTitle = AgentReachRouter.decodeHtmlEntities(rawTitle);
      titles.push({ url: rawHref, title: cleanTitle });
      if (titles.length >= maxResults) break;
    }

    const snippetRegex = /<a[^>]*\bclass="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippets: string[] = [];
    while ((match = snippetRegex.exec(html)) !== null) {
      snippets.push(AgentReachRouter.decodeHtmlEntities(match[1]));
      if (snippets.length >= maxResults) break;
    }

    for (let i = 0; i < titles.length; i++) {
      items.push({
        title: titles[i].title,
        url: titles[i].url,
        snippet: snippets[i] || '',
      });
    }

    return items;
  }
}
