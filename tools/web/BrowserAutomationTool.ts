import { z } from 'zod';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';
import { AgentReachRouter } from '../../engine/reach/AgentReachRouter.js';

export interface BrowserAutomationArgs {
  action: 'inspect_leaderboard' | 'monitor_dashboard' | 'fetch_page_text';
  url: string;
  selector?: string;
  timeoutMs?: number;
}

/**
 * BrowserAutomationTool provides resilient browser and dashboard inspection for AI workflows:
 * monitoring TensorBoard / WandB runs, evaluating competitive benchmark leaderboards,
 * and extracting complex documentation.
 */
export class BrowserAutomationTool extends BaseTool<BrowserAutomationArgs, string> {
  readonly name = 'browser_automation';
  readonly description =
    'Inspect benchmark leaderboards (Kaggle, Open LLM), monitor training dashboards (TensorBoard, MLflow), and extract web documentation.';
  readonly isReadOnly = true;
  readonly isDestructive = false;
  readonly requiresPermission = false;
  readonly isDeferred = false;

  readonly inputSchema = z.object({
    action: z
      .enum(['inspect_leaderboard', 'monitor_dashboard', 'fetch_page_text'])
      .describe('Browser action: "inspect_leaderboard", "monitor_dashboard", or "fetch_page_text"'),
    url: z.string().url().describe('The URL to navigate to (e.g. "http://localhost:6006" or public leaderboard URL)'),
    selector: z.string().optional().describe('Optional CSS selector or keyword to focus inspection on'),
    timeoutMs: z.number().optional().describe('Maximum navigation timeout in milliseconds (default: 15000ms)'),
  });

  async execute(args: BrowserAutomationArgs, context: ToolExecutionContext): Promise<string> {
    const timeout = args.timeoutMs || 15000;

    if (context.onProgress) {
      context.onProgress(`[Browser Automation]: Executing "${args.action}" on "${args.url}"`);
    }

    try {
      switch (args.action) {
        case 'monitor_dashboard': {
          // Check local or remote ML dashboard (TensorBoard, MLflow, WandB)
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeout);

          const res = await fetch(args.url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'InterShader-ML-Browser/1.0' },
          });
          clearTimeout(timer);

          if (!res.ok) {
            return `[Dashboard Monitor HTTP ${res.status}]: Dashboard at "${args.url}" returned status ${res.status}.`;
          }

          const html = await res.text();
          // Extract key metrics from HTML or JSON responses
          const isTensorboard = html.includes('tensorboard') || html.includes('tf-dashboard');
          const isMlflow = html.includes('mlflow');

          return [
            `### Training Dashboard Monitor: ${args.url}`,
            `- **Status**: Online (HTTP ${res.status})`,
            `- **Detected Type**: ${isTensorboard ? 'TensorBoard' : isMlflow ? 'MLflow' : 'Custom Web Dashboard'}`,
            `- **Payload Size**: ${html.length.toLocaleString()} bytes`,
            html.includes('loss') ? `- **Loss References Found**: Yes` : '',
            html.includes('epoch') ? `- **Epoch Telemetry Found**: Yes` : '',
          ].filter(Boolean).join('\n');
        }

        case 'inspect_leaderboard':
        case 'fetch_page_text': {
          // Use AgentReachRouter with Jina / fetch fallback for resilient extraction
          const readRes = await AgentReachRouter.webRead(args.url);
          let markdown = readRes.markdown;

          if (args.selector) {
            const lines = markdown.split('\n');
            const filtered = lines.filter((line) =>
              line.toLowerCase().includes(args.selector!.toLowerCase())
            );
            if (filtered.length > 0) {
              markdown = filtered.slice(0, 30).join('\n');
            }
          }

          return [
            `### Browser Inspection (${readRes.source.toUpperCase()}) | ${readRes.latencyMs}ms`,
            `URL: ${args.url}`,
            '',
            markdown.slice(0, 4000),
          ].join('\n');
        }

        default:
          return `[Browser Error]: Unsupported action "${args.action}".`;
      }
    } catch (err) {
      return `[Browser Error]: ${(err as Error).message}`;
    }
  }
}
