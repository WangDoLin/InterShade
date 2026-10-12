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

export class AgentReachRouter {
  private static readonly JINA_READER_PREFIX = 'https://r.jina.ai/';

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
}
