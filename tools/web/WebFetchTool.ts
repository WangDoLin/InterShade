import { z } from 'zod';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';

const WebFetchInputSchema = z.object({
  url: z.string().url().describe('The web URL to fetch content from (e.g. "https://docs.github.com")'),
  prompt: z
    .string()
    .optional()
    .describe('Optional search/filter intent to extract only relevant sections from the page'),
  maxChars: z
    .number()
    .optional()
    .describe('Maximum characters of content to return (default: 40000)'),
});

type WebFetchInput = z.infer<typeof WebFetchInputSchema>;

export class WebFetchTool extends BaseTool<WebFetchInput, string> {
  readonly name = 'fetch_web_content';
  readonly description =
    'Fetches web documentation, tutorials, or public APIs from a URL and extracts clean Markdown, with built-in SSRF protection against internal addresses.';
  readonly inputSchema = WebFetchInputSchema;
  readonly isReadOnly = true;
  readonly isDestructive = false;
  readonly requiresPermission = true;
  readonly isDeferred = true;

  async execute(args: WebFetchInput, context: ToolExecutionContext): Promise<string> {
    const rawUrl = args.url.trim();

    // 1. SSRF Protection (Block internal network access)
    const ssrfCheck = this.validateUrlSafety(rawUrl);
    if (!ssrfCheck.isSafe) {
      throw new Error(`Access blocked: ${ssrfCheck.reason}`);
    }

    if (context.onProgress) {
      context.onProgress(`Fetching web content from: ${rawUrl}...`);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(rawUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 InterShader/1.0',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return `[HTTP ERROR ${response.status}]: Failed to fetch "${rawUrl}" - ${response.statusText}`;
      }

      const contentType = response.headers.get('content-type') || '';
      const rawText = await response.text();

      // Convert HTML to clean Markdown
      let markdown = this.htmlToMarkdown(rawText);

      // Filter by prompt keywords if provided
      if (args.prompt) {
        markdown = this.filterByPrompt(markdown, args.prompt);
      }

      const maxChars = args.maxChars || 40000;
      if (markdown.length > maxChars) {
        markdown =
          markdown.slice(0, maxChars) +
          `\n\n... [Content truncated at ${maxChars} characters. Total original: ${rawText.length} bytes]`;
      }

      return (
        `[FETCH SUCCESS: ${rawUrl}]\n` +
        `HTTP ${response.status} | Content-Type: ${contentType} | Extracted: ${markdown.length} chars\n\n` +
        markdown
      );
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error(`Request timed out while fetching "${rawUrl}".`);
      }
      throw new Error(`Failed to fetch web content from "${rawUrl}": ${err.message}`);
    }
  }

  private validateUrlSafety(urlStr: string): { isSafe: boolean; reason?: string } {
    let parsed: URL;
    try {
      parsed = new URL(urlStr);
    } catch {
      return { isSafe: false, reason: 'Invalid URL format.' };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { isSafe: false, reason: 'Only HTTP and HTTPS protocols are permitted.' };
    }

    const host = parsed.hostname.toLowerCase();

    // Check for localhost or cloud metadata addresses
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host === '169.254.169.254' ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      return { isSafe: false, reason: `Access to loopback/metadata host "${host}" is forbidden.` };
    }

    // Check private IPv4 ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
    const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const b1 = parseInt(ipv4Match[1], 10);
      const b2 = parseInt(ipv4Match[2], 10);

      if (b1 === 10) return { isSafe: false, reason: 'Access to private 10.x.x.x range is forbidden.' };
      if (b1 === 172 && b2 >= 16 && b2 <= 31)
        return { isSafe: false, reason: 'Access to private 172.16-31.x.x range is forbidden.' };
      if (b1 === 192 && b2 === 168)
        return { isSafe: false, reason: 'Access to private 192.168.x.x range is forbidden.' };
    }

    return { isSafe: true };
  }

  private htmlToMarkdown(html: string): string {
    let text = html;

    // 1. Remove scripts, styles, noscript, svg, navigation, footer
    text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
    text = text.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '');
    text = text.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '');
    text = text.replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '');
    text = text.replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '');

    // 2. Convert common HTML tags to Markdown
    text = text.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n# $1\n');
    text = text.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n## $1\n');
    text = text.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n### $1\n');
    text = text.replace(/<h[4-6][^>]*>(.*?)<\/h[4-6]>/gi, '\n#### $1\n');
    text = text.replace(/<p[^>]*>(.*?)<\/p>/gi, '\n$1\n');
    text = text.replace(/<li[^>]*>(.*?)<\/li>/gi, '\n- $1');
    text = text.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n');
    text = text.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');
    text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');
    text = text.replace(/<br\s*[\/]?>/gi, '\n');

    // 3. Strip remaining HTML tags
    text = text.replace(/<[^>]+>/g, '');

    // 4. Decode common HTML entities
    text = text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');

    // 5. Collapse excessive whitespace
    text = text.replace(/\n\s*\n\s*\n+/g, '\n\n').trim();

    return text;
  }

  private filterByPrompt(content: string, prompt: string): string {
    const keywords = prompt.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    if (keywords.length === 0) return content;

    const paragraphs = content.split(/\n\n+/);
    const matched = paragraphs.filter(p => {
      const lower = p.toLowerCase();
      return keywords.some(k => lower.includes(k));
    });

    if (matched.length > 0) {
      return matched.join('\n\n');
    }
    return content;
  }
}
