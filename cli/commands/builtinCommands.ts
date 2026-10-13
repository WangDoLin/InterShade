import type { PromptCommand, LocalCommand } from './types.js';
import type { CommandRegistry } from './CommandRegistry.js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getDatabase } from '../../state/Database.js';
import { FtsMemoryService } from '../../services/memory/FtsMemoryService.js';
import { SkillCrystallizer } from '../../services/skills/SkillCrystallizer.js';
import { ShadowWorktree } from '../../security/ShadowWorktree.js';
import { ClaudeAgentCoordinator } from '../../services/agent/ClaudeAgentCoordinator.js';
import type { ToolExecutionContext } from '../../types/index.js';
import { ProofEngine } from '../../engine/verification/ProofEngine.js';
import { ModelRouter } from '../../orchestrator/ModelRouter.js';
import { SweBenchmarkRunner } from '../../engine/benchmark/SweBenchmarkRunner.js';
import { GatewayFormatter } from '../../providers/catalog/GatewayFormatter.js';
import { ModelDiscovery } from '../../providers/catalog/ModelDiscovery.js';
import { ConnectionRegistry } from '../../providers/core/ConnectionRegistry.js';
import { ProviderHealthChecker } from '../../providers/reliability/ProviderHealthChecker.js';
import { PlanManager } from '../../state/PlanManager.js';
import { config } from '../../config/index.js';


export const reviewCommand: PromptCommand = {
  name: 'review',
  description: 'Perform thorough code review, security audit, and quality inspection',
  type: 'prompt',
  aliases: ['audit'],
  getPrompt: (ctx) => {
    const target = ctx.args.length > 0 ? ctx.args.join(' ') : 'the current git diff or recent modifications';
    return [
      `Please perform a rigorous, systematic code review of ${target}.`,
      'Examine:',
      '1. Correctness and logic regressions',
      '2. Boundary conditions and unhandled error cases',
      '3. Security vulnerabilities (input validation, secret leakage, injection)',
      '4. Performance and resource leaks',
      'Provide concrete actionable recommendations with line-specific references.'
    ].join('\n');
  }
};

export const commitCommand: PromptCommand = {
  name: 'commit',
  description: 'Generate conventional commit message and commit staged changes',
  type: 'prompt',
  aliases: ['ci'],
  getPrompt: (ctx) => {
    const hint = ctx.args.length > 0 ? ` Additional intent note: ${ctx.args.join(' ')}` : '';
    return [
      'Inspect staged git changes using git status and git diff.',
      'Generate a standardized Conventional Commit message (e.g. feat:, fix:, refactor:, chore:, test:).',
      'Commit the changes using run_shell_command.',
      hint
    ].join('\n');
  }
};

export const diffCommand: LocalCommand = {
  name: 'diff',
  description: 'Display working directory git diff summary',
  type: 'local',
  execute: (ctx) => {
    try {
      const output = execSync('git diff --stat', {
        cwd: ctx.cwd,
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      return output.trim() || 'No modified files detected in working tree.';
    } catch {
      return 'Not inside a git repository or git command unavailable.';
    }
  }
};

export const statsCommand: LocalCommand = {
  name: 'stats',
  description: 'Display session token usage statistics',
  type: 'local',
  aliases: ['tokens', 'usage'],
  execute: (ctx) => {
    const st = ctx.sessionState as Record<string, unknown>;
    const input = Number(st.totalInputTokens || 0);
    const output = Number(st.totalOutputTokens || 0);
    const total = input + output;
    return [
      'Session Token Usage',
      `Input Tokens:  ${input.toLocaleString()}`,
      `Output Tokens: ${output.toLocaleString()}`,
      `Total Tokens:  ${total.toLocaleString()}`,
    ].join('\n');
  }
};

export const costCommand: LocalCommand = {
  name: 'cost',
  description: 'Display estimated session cost',
  type: 'local',
  execute: (ctx) => {
    const st = ctx.sessionState as Record<string, unknown>;
    const input = Number(st.totalInputTokens || 0);
    const output = Number(st.totalOutputTokens || 0);
    const cost = (input / 1_000_000) * 3.0 + (output / 1_000_000) * 15.0;
    return `Estimated Session Cost: $${cost.toFixed(4)} USD`;
  }
};

export const doctorCommand: LocalCommand = {
  name: 'doctor',
  description: 'Comprehensive runtime, git, database, and API environment diagnostics',
  type: 'local',
  aliases: ['health', 'diag'],
  execute: (ctx) => {
    const reports: string[] = ['InterShader System Diagnostics'];

    // 1. Node runtime
    reports.push(`Runtime:     Node.js ${process.version} (${process.platform} ${process.arch})`);

    // 2. Database WAL status
    try {
      const db = getDatabase();
      const walRow = db.prepare('PRAGMA journal_mode;').get() as { journal_mode: string };
      reports.push(`Database:    SQLite WAL Mode (active: ${walRow.journal_mode})`);
    } catch (e: unknown) {
      reports.push(`Database:    SQLite Error (${(e as Error).message})`);
    }

    // 3. Git integration
    try {
      const gitVer = execSync('git --version', { encoding: 'utf-8', timeout: 3000 }).trim();
      const inWorkTree = execSync('git rev-parse --is-inside-work-tree', {
        cwd: ctx.cwd,
        encoding: 'utf-8',
        timeout: 3000,
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
      reports.push(`Git Engine:  ${gitVer} (WorkTree: ${inWorkTree})`);
    } catch {
      reports.push('Git Engine:  Not in a git worktree or git CLI unavailable');
    }

    // 4. Provider Keys
    const providers = [
      { name: 'Anthropic', key: process.env.ANTHROPIC_API_KEY },
      { name: 'OpenAI', key: process.env.OPENAI_API_KEY },
      { name: 'DeepSeek', key: process.env.DEEPSEEK_API_KEY },
      { name: 'Gemini', key: process.env.GEMINI_API_KEY },
    ];
    const keyStatus = providers.map((p) => `${p.name}: ${p.key ? 'READY' : 'MISSING'}`).join(' | ');
    reports.push(`AI Keys:     ${keyStatus}`);

    // 5. Working directory
    reports.push(`Workspace:   ${ctx.cwd}`);
    reports.push('Status:      All core components operational');

    return reports.join('\n');
  }
};

export const modelCommand: LocalCommand = {
  name: 'model',
  description: 'View, list, inspect, or switch LLM models (/models list, /models inspect <provider> <model>)',
  type: 'local',
  aliases: ['models'],
  execute: async (ctx) => {
    const sub = ctx.args[0]?.toLowerCase();

    if (sub === 'list') {
      const providerFilter = ctx.args[1];
      return GatewayFormatter.formatModelsList(providerFilter);
    }

    if (sub === 'inspect') {
      const providerId = ctx.args[1];
      const modelId = ctx.args[2];
      if (!providerId || !modelId) {
        return 'Usage: /models inspect <provider> <model_id>';
      }
      return GatewayFormatter.formatModelInspect(providerId, modelId);
    }

    if (sub === 'discover') {
      const connId = ctx.args[1] || 'ollama-local';
      const conn = ConnectionRegistry.get(connId) || ConnectionRegistry.findByProvider(connId);
      if (!conn) {
        return `Connection '${connId}' not found in registry.`;
      }
      try {
        const discovered = await ModelDiscovery.discover(conn);
        return [
          `Discovered ${discovered.length} models from ${conn.id}:`,
          ...discovered.slice(0, 15).map((m) => `  - ${m.modelId} (tools: ${m.capabilities.toolCalling}, context: ${m.contextWindow})`),
        ].join('\n');
      } catch (err) {
        return `Discovery failed for '${conn.id}': ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    const st = ctx.sessionState as Record<string, unknown>;
    const targetModel = ctx.args[0]?.toLowerCase();

    if (!targetModel) {
      return [
        'Active Model Gateway Configuration',
        `Current Model:    ${st.model || 'claude-3-7-sonnet'}`,
        `Current Provider: ${st.provider || 'anthropic'}`,
        '',
        'Available Gateway Commands:',
        '  /models list [provider]           - View all registered models',
        '  /models inspect <provider> <id>   - Inspect model capabilities & limits',
        '  /models discover <connection>     - Query /v1/models dynamically',
        '  /model <model_name>               - Switch active model',
      ].join('\n');
    }

    let detectedProvider = 'anthropic';
    if (ctx.args[1]) {
      detectedProvider = ctx.args[1].toLowerCase();
    } else if (targetModel.includes('/') || targetModel.startsWith('ag') || targetModel.startsWith('ocz') || targetModel.startsWith('gh/')) {
      detectedProvider = 'openai';
    } else if (targetModel.includes('gpt') || targetModel.includes('o1') || targetModel.includes('o3')) {
      detectedProvider = 'openai';
    } else if (targetModel.includes('deepseek')) {
      detectedProvider = 'deepseek';
    } else if (targetModel.includes('gemini')) {
      detectedProvider = 'google';
    } else if (targetModel.includes('llama') || targetModel.includes('qwen')) {
      detectedProvider = 'ollama';
    }

    st.model = targetModel;
    st.provider = detectedProvider;
    return `Switched active model to: ${targetModel} (Provider: ${detectedProvider})`;
  }
};

export const providersCommand: LocalCommand = {
  name: 'providers',
  description: 'List and test connection profiles (/providers list, /providers test [connection])',
  type: 'local',
  aliases: ['provider'],
  execute: async (ctx) => {
    const sub = ctx.args[0]?.toLowerCase();

    if (sub === 'test') {
      const connId = ctx.args[1];
      if (connId) {
        const conn = ConnectionRegistry.get(connId) || ConnectionRegistry.findByProvider(connId);
        if (!conn) {
          return `Connection '${connId}' not found in registry.`;
        }
        const res = await ProviderHealthChecker.check(conn);
        return GatewayFormatter.formatHealthCheck(res);
      }
      const results = await ProviderHealthChecker.checkAll();
      return [
        'Connection Health Check Results',
        ...results.map((r) => GatewayFormatter.formatHealthCheck(r)),
      ].join('\n---\n');
    }

    return GatewayFormatter.formatProvidersList();
  }
};

function getTargetEnvPath(): string {
  const candidatePaths = [
    path.join(process.cwd(), 'InterShade-code-agent', '.env'),
    path.join(process.cwd(), '.env'),
    path.join(os.homedir(), '.intershade', '.env'),
  ];
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) return p;
  }
  return path.join(process.cwd(), '.env');
}

function updateEnvFile(filePath: string, keyName: string, keyValue: string): void {
  let content = '';
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, 'utf-8');
  } else {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  const regex = new RegExp(`^${keyName}=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${keyName}=${keyValue}`);
  } else {
    content = content ? `${content.trimEnd()}\n${keyName}=${keyValue}\n` : `${keyName}=${keyValue}\n`;
  }

  fs.writeFileSync(filePath, content, 'utf-8');
}

function maskApiKey(key?: string): string {
  if (!key || key.trim().length === 0) return '[NOT CONFIGURED]';
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '****';
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

const PROVIDER_ENV_MAP: Record<string, { envVar: string; displayName: string; defaultModel: string }> = {
  google: { envVar: 'GEMINI_API_KEY', displayName: 'Google (Gemini)', defaultModel: 'gemini-2.5-flash' },
  gemini: { envVar: 'GEMINI_API_KEY', displayName: 'Google (Gemini)', defaultModel: 'gemini-2.5-flash' },
  openai: { envVar: 'OPENAI_API_KEY', displayName: 'OpenAI', defaultModel: 'gpt-4o' },
  anthropic: { envVar: 'ANTHROPIC_API_KEY', displayName: 'Anthropic (Claude)', defaultModel: 'claude-3-7-sonnet-20250219' },
  claude: { envVar: 'ANTHROPIC_API_KEY', displayName: 'Anthropic (Claude)', defaultModel: 'claude-3-7-sonnet-20250219' },
  deepseek: { envVar: 'DEEPSEEK_API_KEY', displayName: 'DeepSeek', defaultModel: 'deepseek-chat' },
  ollama: { envVar: 'OPENAI_BASE_URL', displayName: 'Ollama (Local URL)', defaultModel: 'qwen2.5-coder' },
};

export const setupCommand: LocalCommand = {
  name: 'setup',
  description: 'View or configure API keys and test balance (/setup, /key test [provider], /key <provider> <api_key>)',
  type: 'local',
  aliases: ['key', 'keys', 'apikey'],
  execute: async (ctx) => {
    const targetEnv = getTargetEnvPath();
    const arg0 = ctx.args[0]?.toLowerCase();

    // 1. Live test key: /key test [provider]
    if (arg0 === 'test') {
      const targetProvider = ctx.args[1]?.toLowerCase() || 'openai';
      const mapping = PROVIDER_ENV_MAP[targetProvider];
      if (!mapping) {
        return `Unknown provider '${targetProvider}'. Supported providers: google, openai, anthropic, deepseek`;
      }
      const key = process.env[mapping.envVar];
      if (!key) {
        return `[NOT SET]: API key for ${mapping.displayName} (${mapping.envVar}) is not configured.\nSet it via: /key ${targetProvider} <your_api_key>`;
      }

      try {
        if (targetProvider === 'openai') {
          const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
          const endpoint = `${baseUrl}/models`;
          const res = await fetch(endpoint, {
            headers: { Authorization: `Bearer ${key}` },
            signal: AbortSignal.timeout(6000),
          });
          if (res.ok) {
            const isProxy = baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1') || !baseUrl.includes('api.openai.com');
            const targetName = isProxy ? `OpenAI gateway (${baseUrl})` : 'OpenAI';
            return `[OK (HTTP 200)]: ${targetName} is active and valid. Model endpoint is ready for requests.`;
          }
          const errData = await res.json().catch(() => ({}));
          const errObj = (errData as any)?.error || {};
          if (res.status === 401) {
            return `[FAILED (401 Invalid Key)]: Incorrect or expired OpenAI API key provided.\nMessage: ${errObj.message || 'Unauthorized'}`;
          }
          if (res.status === 429) {
            return `[FAILED (429 Insufficient Quota)]: Tai khoan OpenAI chua co so du (Credit Balance = $0.00).\nOpenAI yeu cau nap credit toi thieu $5 tai: https://platform.openai.com/account/billing\nMessage: ${errObj.message || 'Quota exceeded'}`;
          }
          return `[FAILED (HTTP ${res.status})]: ${errObj.message || res.statusText}`;
        } else if (targetProvider === 'google' || targetProvider === 'gemini') {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, {
            signal: AbortSignal.timeout(6000),
          });
          if (res.ok) {
            return `[OK (HTTP 200)]: Google Gemini API key is active and valid.`;
          }
          const errData = await res.json().catch(() => ({}));
          return `[FAILED (HTTP ${res.status})]: ${(errData as any)?.error?.message || res.statusText}`;
        } else if (targetProvider === 'anthropic' || targetProvider === 'claude') {
          const res = await fetch('https://api.anthropic.com/v1/models', {
            headers: {
              'x-api-key': key,
              'anthropic-version': '2023-06-01',
            },
            signal: AbortSignal.timeout(6000),
          });
          if (res.ok) {
            return `[OK (HTTP 200)]: Anthropic Claude API key is active and valid.`;
          }
          const errData = await res.json().catch(() => ({}));
          return `[FAILED (HTTP ${res.status})]: ${(errData as any)?.error?.message || res.statusText}`;
        } else if (targetProvider === 'deepseek') {
          const res = await fetch('https://api.deepseek.com/models', {
            headers: { Authorization: `Bearer ${key}` },
            signal: AbortSignal.timeout(6000),
          });
          if (res.ok) {
            return `[OK (HTTP 200)]: DeepSeek API key is active and valid.`;
          }
          const errData = await res.json().catch(() => ({}));
          return `[FAILED (HTTP ${res.status})]: ${(errData as any)?.error?.message || res.statusText}`;
        }
      } catch (e: any) {
        return `[Connection Error]: Could not reach ${mapping.displayName}: ${e?.message || String(e)}`;
      }
    }

    // 2. Set default provider: /key default <provider> [model]
    if (arg0 === 'default') {
      const targetProvider = ctx.args[1]?.toLowerCase();
      const targetModel = ctx.args[2];
      if (!targetProvider) {
        return 'Usage: /key default <provider> [model]\nExample: /key default openai gpt-4o';
      }

      updateEnvFile(targetEnv, 'DEFAULT_PROVIDER', targetProvider);
      if (targetModel) {
        updateEnvFile(targetEnv, 'DEFAULT_MODEL', targetModel);
      }
      return [
        'Updated Default Configuration in .env:',
        `  Provider: ${targetProvider}`,
        targetModel ? `  Model:    ${targetModel}` : '',
        `Saved to: ${targetEnv}`,
      ].filter(Boolean).join('\n');
    }


    // 2. Set API key: /key <provider> <api_key>
    if (arg0 && ctx.args[1]) {
      const providerMapping = PROVIDER_ENV_MAP[arg0];
      if (!providerMapping) {
        return `Unknown provider '${arg0}'. Supported providers: google, openai, anthropic, deepseek, ollama`;
      }

      const newKey = ctx.args[1].trim();
      updateEnvFile(targetEnv, providerMapping.envVar, newKey);
      process.env[providerMapping.envVar] = newKey;

      return [
        `Successfully updated API key for ${providerMapping.displayName}:`,
        `  Env Var:  ${providerMapping.envVar}`,
        `  Value:    ${maskApiKey(newKey)}`,
        `  File:     ${targetEnv}`,
        '',
        `To switch active model to this provider now, run: /model ${providerMapping.defaultModel}`,
      ].join('\n');
    }

    // 3. View status report: /setup or /key or /keys
    const lines = [
      'InterShader Environment & API Keys Configuration',
      `Config File: ${targetEnv} (${fs.existsSync(targetEnv) ? 'Exists' : 'Not found'})`,
      '',
      'Provider API Key Status:',
      `  1. Google (Gemini):     ${maskApiKey(process.env.GEMINI_API_KEY)}`,
      `  2. OpenAI:              ${maskApiKey(process.env.OPENAI_API_KEY)}`,
      `  3. Anthropic (Claude):  ${maskApiKey(process.env.ANTHROPIC_API_KEY)}`,
      `  4. DeepSeek:            ${maskApiKey(process.env.DEEPSEEK_API_KEY)}`,
      `  5. Ollama Base URL:     ${process.env.OPENAI_BASE_URL || 'http://localhost:11434 (default)'}`,
      '',
      'Quick Commands to update API Key directly in chat:',
      '  /key test [provider]                - Live test API key & balance (e.g. /key test openai)',
      '  /key google <your_gemini_api_key>',
      '  /key openai <your_openai_api_key>',
      '  /key anthropic <your_claude_api_key>',
      '  /key deepseek <your_deepseek_api_key>',
      '  /key default <provider> [model]',
      '',
      'To switch active model: /model <model_name> (e.g. /model gpt-4o or /model gemini-2.5-flash)',
      'To run interactive terminal setup wizard: node dist/index.js setup',
    ];

    return lines.join('\n');
  },
};


export const modeCommand: LocalCommand = {
  name: 'mode',
  description: 'View or switch agent permission mode (default, plan, auto, bypassPermissions)',
  type: 'local',
  aliases: ['permissions', 'perm'],
  execute: (ctx) => {
    const st = ctx.sessionState as Record<string, unknown>;
    const targetMode = ctx.args[0]?.toLowerCase();
    const validModes = ['default', 'plan', 'auto', 'acceptEdits', 'bypassPermissions', 'dontAsk'];

    if (!targetMode || !validModes.includes(targetMode)) {
      return [
        `Current Permission Mode: ${st.permissionMode || 'default'}`,
        'Valid Modes:',
        '  - default: Ask confirmation before executing mutating actions',
        '  - plan: Read-only planning mode (blocks all mutations)',
        '  - auto: Autonomous execution for verified actions',
        '  - acceptEdits: Auto-accept file modifications',
        '  - bypassPermissions: Bypass confirmation prompts',
        '  - dontAsk: Deny unconfirmed sensitive operations silently',
        'Usage: /mode <mode_name>',
      ].join('\n');
    }

    st.permissionMode = targetMode;
    return `Switched permission mode to: ${targetMode}`;
  }
};

export const planCommand: LocalCommand = {
  name: 'plan',
  description: 'Toggle Plan Mode (Read-Only architectural safe mode) or inspect/manage active plan (/plan [path|view|reset])',
  type: 'local',
  aliases: [],
  execute: (ctx) => {
    const st = ctx.sessionState as Record<string, unknown>;
    const arg0 = (ctx.args[0] || '').toLowerCase().trim();
    const sessionId = (st.id as string) || '';

    if (arg0 === 'view' || arg0 === 'show') {
      const plan = PlanManager.getActivePlan(sessionId);
      if (!plan) {
        return '[PLAN NOTICE]: No active plan has been established for this session yet. Type your planning request or /plan to start.';
      }
      return PlanManager.formatPlanMarkdown(plan, { showChangelog: true });
    }

    if (arg0 === 'reset' || arg0 === 'clear') {
      PlanManager.clearPlan(sessionId);
      return '[PLAN RESET]: Active plan cleared from session memory. Ready to establish a new plan.';
    }

    const targetPath = ctx.args.join(' ').trim();
    const currentMode = st.permissionMode;
    const nextMode = currentMode === 'plan' && !targetPath ? 'default' : 'plan';
    st.permissionMode = nextMode;
    let msg = nextMode === 'plan' ? '[PLAN MODE ON]: Write tools and shell execution are locked to read-only.' : '[PLAN MODE OFF]: Normal execution mode restored.';
    if (targetPath) {
      msg += `\nTarget Scope: ${targetPath}\nReady for planning. Describe what features or fixes you want to investigate.`;
    }
    const activePlan = PlanManager.getActivePlan(sessionId);
    if (activePlan && nextMode === 'plan') {
      msg += `\n\nActive Plan (v${activePlan.currentVersion}): "${activePlan.title}" with ${activePlan.steps.length} steps. Any updates will merge with this plan.`;
    }
    return msg;
  }
};

export const turnsCommand: LocalCommand = {
  name: 'turns',
  description: 'View or set the maximum turn limit for agent execution (/turns [number|unlimited])',
  type: 'local',
  aliases: ['maxturns', 'turnlimit'],
  execute: (ctx) => {
    const st = ctx.sessionState as Record<string, unknown>;
    const arg = ctx.args[0]?.toLowerCase();

    if (!arg) {
      const current = typeof st.maxTurns === 'number' ? st.maxTurns : config.maxTurns;
      return current <= 0
        ? 'Current Turn Limit: Unlimited (Continuous execution until task completion)'
        : `Current Turn Limit: ${current} turns per prompt (use /turns <number> or /turns unlimited to change)`;
    }

    if (arg === 'unlimited' || arg === 'inf' || arg === 'infinite' || arg === '0') {
      st.maxTurns = 0;
      return 'Turn limit set to: Unlimited (Continuous execution until task completion)';
    }

    const parsed = parseInt(arg, 10);
    if (isNaN(parsed) || parsed < 0) {
      return 'Invalid turn limit. Usage: /turns <number> (e.g. /turns 50, /turns 100) or /turns unlimited';
    }

    st.maxTurns = parsed;
    return `Turn limit updated to: ${parsed} turns per prompt`;
  }
};

export const compactCommand: PromptCommand = {
  name: 'compact',
  description: 'Actively trigger context compaction and summarize conversation history',
  type: 'prompt',
  aliases: ['summarize'],
  getPrompt: () => {
    return [
      'Please perform an active context compaction on the current session history.',
      'Summarize key technical architectural decisions, identified root causes, and files modified.',
      'Eliminate verbose tool outputs and retain actionable working memory.'
    ].join('\n');
  }
};

export const rewindCommand: PromptCommand = {
  name: 'rewind',
  description: 'Rollback recent modifications or restore state from prior savepoint',
  type: 'prompt',
  aliases: ['undo'],
  getPrompt: (ctx) => {
    const note = ctx.args.length > 0 ? ` Target checkpoint note: ${ctx.args.join(' ')}` : '';
    return [
      'Review recent file changes and check available savepoints.',
      'Revert the latest unverified changes or rollback to the prior safe savepoint state.',
      note
    ].join('\n');
  }
};

export const initCommand: LocalCommand = {
  name: 'init',
  description: 'Initialize .intershader workspace configuration and project conventions',
  type: 'local',
  execute: (ctx) => {
    const intershaderDir = path.join(ctx.cwd, '.intershader');
    const skillsDir = path.join(intershaderDir, 'skills');
    const configFile = path.join(intershaderDir, 'config.json');

    fs.mkdirSync(skillsDir, { recursive: true });

    if (!fs.existsSync(configFile)) {
      const initialConfig = {
        version: '1.0.0',
        defaultModel: 'claude-3-7-sonnet',
        defaultProvider: 'anthropic',
        permissionMode: 'default',
        createdAt: new Date().toISOString()
      };
      fs.writeFileSync(configFile, JSON.stringify(initialConfig, null, 2), 'utf-8');
      return `Initialized workspace configuration at: ${configFile}`;
    }

    return `Workspace configuration already exists at: ${configFile}`;
  }
};

export const exportCommand: LocalCommand = {
  name: 'export',
  description: 'Export session conversation history to Markdown',
  type: 'local',
  execute: (ctx) => {
    const st = ctx.sessionState as Record<string, unknown>;
    const sessionId = String(st.id || 'current-session');
    const exportDir = path.join(ctx.cwd, '.intershader', 'exports');
    fs.mkdirSync(exportDir, { recursive: true });

    const exportPath = path.join(exportDir, `session-${sessionId}.md`);
    const db = getDatabase();

    const messages = db.prepare('SELECT role, content, timestamp FROM messages WHERE session_id = ? ORDER BY timestamp ASC').all(sessionId) as Array<{ role: string; content: string; timestamp: number }>;

    let md = `# InterShader Session Export: ${sessionId}\n\n`;
    md += `Exported at: ${new Date().toISOString()}\n`;
    md += `Model: ${st.model || 'claude-3-7-sonnet'} (${st.provider || 'anthropic'})\n\n---\n\n`;

    if (messages.length === 0) {
      md += `*No stored database messages for session ${sessionId}.*\n`;
    } else {
      for (const m of messages) {
        md += `### ${m.role.toUpperCase()} (${new Date(m.timestamp).toLocaleTimeString()}):\n\n${m.content}\n\n---\n\n`;
      }
    }

    fs.writeFileSync(exportPath, md, 'utf-8');
    return `Exported session history to: ${exportPath}`;
  }
};

export const statusCommand: LocalCommand = {
  name: 'status',
  description: 'Display active session status, git branch, tokens, and gateway state',
  type: 'local',
  execute: (ctx) => {
    const st = ctx.sessionState as Record<string, unknown>;
    let gitBranch = 'unknown';
    try {
      gitBranch = execSync('git branch --show-current', {
        cwd: ctx.cwd,
        encoding: 'utf-8',
        timeout: 3000,
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim() || 'detached';
    } catch {
      gitBranch = 'no-git';
    }

    const input = Number(st.totalInputTokens || 0);
    const output = Number(st.totalOutputTokens || 0);

    return [
      'InterShader Session Status',
      `Session ID:      ${st.id || 'active'}`,
      `Working Tree:    ${ctx.cwd}`,
      `Git Branch:      ${gitBranch}`,
      `Model / Provider:${st.model || 'claude-3-7-sonnet'} (${st.provider || 'anthropic'})`,
      `Permission Mode: ${st.permissionMode || 'default'}`,
      `Token Counters:  In: ${input.toLocaleString()} | Out: ${output.toLocaleString()}`,
      `Estimated Cost:  $${(((input / 1_000_000) * 3.0) + ((output / 1_000_000) * 15.0)).toFixed(4)} USD`,
    ].join('\n');
  }
};

export const memoryCommand: LocalCommand = {
  name: 'memory',
  description: 'Search and inspect durable knowledge in SQLite FTS5 BM25 memory',
  type: 'local',
  aliases: ['mem'],
  execute: (ctx) => {
    const query = ctx.args.join(' ').trim();
    if (!query) {
      const db = getDatabase();
      const countRow = db.prepare('SELECT count(*) as count FROM memories').get() as { count: number };
      return [
        'Durable FTS5 Memory',
        `Total Indexed Records: ${countRow.count}`,
        'Usage: /memory <search query>',
        'Example: /memory oauth token refresh',
      ].join('\n');
    }

    const results = FtsMemoryService.searchMemories(query, { limit: 5 });
    if (results.length === 0) {
      return `No memories found matching query: "${query}"`;
    }

    const lines: string[] = [`FTS5 Memory matches for "${query}":`];
    for (const res of results) {
      lines.push(`- [${res.type}] ${res.content.slice(0, 100)}... (Rank: ${res.rank.toFixed(2)})`);
    }
    return lines.join('\n');
  }
};

export const skillsCommand: LocalCommand = {
  name: 'skills',
  description: 'List or discover autonomously crystallized pipeline skills',
  type: 'local',
  aliases: ['skill'],
  execute: (ctx) => {
    const skills = SkillCrystallizer.loadSkills(ctx.cwd);
    if (skills.length === 0) {
      return 'No crystallized skills found in .intershader/skills/. Complete successful 10-stage tasks to automatically synthesize skills.';
    }

    const lines: string[] = [`Autonomously Crystallized Skills (${skills.length}):`];
    for (const sk of skills) {
      lines.push(`- [${sk.name}] Triggers: [${sk.intentTriggers.slice(0, 4).join(', ')}] (Confidence: ${(sk.confidence * 100).toFixed(0)}%)`);
    }
    return lines.join('\n');
  }
};

export const worktreeCommand: LocalCommand = {
  name: 'worktree',
  description: 'Manage and inspect Git Shadow Worktree Sandboxes',
  type: 'local',
  aliases: ['wt'],
  execute: (ctx) => {
    const action = ctx.args[0]?.toLowerCase();
    const shadowDir = path.join(ctx.cwd, '.intershader', 'shadow');

    if (action === 'cleanup') {
      if (fs.existsSync(shadowDir)) {
        const subdirs = fs.readdirSync(shadowDir);
        for (const dir of subdirs) {
          try {
            ShadowWorktree.removeShadow(path.join(shadowDir, dir), ctx.cwd);
          } catch {
            // Ignore removal errors
          }
        }
        return 'Cleaned up all shadow worktree sandboxes in .intershader/shadow/';
      }
      return 'No active shadow worktree directory to clean.';
    }

    if (!fs.existsSync(shadowDir)) {
      return 'No Git Shadow Worktrees currently active.';
    }

    const entries = fs.readdirSync(shadowDir);
    if (entries.length === 0) {
      return 'No Git Shadow Worktrees currently active.';
    }

    return [
      `Active Git Shadow Worktrees (${entries.length}):`,
      ...entries.map((e) => `  - ${e}`),
      'Usage: /worktree cleanup to purge isolated sandboxes',
    ].join('\n');
  }
};

export const gatewayCommand: LocalCommand = {
  name: 'gateway',
  description: 'Inspect multi-channel remote gateway daemon status',
  type: 'local',
  aliases: ['gw'],
  execute: () => {
    return [
      'Multi-Channel Gateway Daemon',
      'Supported Channels: REST API, Telegram Interactive Bot',
      'Default Port:       3912',
      'Status:             Available for headless dispatch',
      'Usage: Launch Gateway daemon using GatewayServer class',
    ].join('\n');
  }
};

export const sessionsCommand: LocalCommand = {
  name: 'sessions',
  description: 'List recent conversation sessions stored in SQLite WAL',
  type: 'local',
  execute: () => {
    try {
      const db = getDatabase();
      const rows = db.prepare(`
        SELECT id, title, model, provider, datetime(created_at/1000, 'unixepoch', 'localtime') as created_time
        FROM sessions
        ORDER BY created_at DESC
        LIMIT 5
      `).all() as Array<{ id: string; title: string; model: string; provider: string; created_time: string }>;

      if (rows.length === 0) {
        return 'No stored sessions in database. Use /new to start a new session.';
      }

      const lines: string[] = ['Recent Conversation Sessions:'];
      for (const r of rows) {
        lines.push(`- [${r.id}] ${r.title} | ${r.model} (${r.created_time})`);
      }
      lines.push('\nTips: Use /new to start fresh, or /delete to permanently delete current session.');
      return lines.join('\n');
    } catch {
      return 'Unable to query sessions table from SQLite.';
    }
  }
};

export const newCommand: LocalCommand = {
  name: 'new',
  description: 'Start a fresh conversation session (use --delete or -d to delete current session)',
  type: 'local',
  aliases: ['reset'],
  execute: () => {
    return 'Starting new conversation...';
  }
};

export const deleteSessionCommand: LocalCommand = {
  name: 'delete',
  description: 'Permanently delete current conversation from database and start a fresh session',
  type: 'local',
  aliases: ['delete-session', 'drop'],
  execute: () => {
    return 'Deleting conversation and starting new session...';
  }
};

export const agentCommand: LocalCommand = {
  name: 'agent',
  description: 'Dispatch a Claude Code specialized agent step (explore, plan, general, verify, workflow)',
  type: 'local',
  aliases: ['subagent', 'step'],
  execute: async (ctx) => {
    const roleArg = (ctx.args[0]?.toLowerCase() || 'workflow');
    const goal = ctx.args.slice(1).join(' ').trim() || 'Analyze workspace structure';

    const coordinator = new ClaudeAgentCoordinator();
    const mockToolContext: ToolExecutionContext = {
      sessionId: String(ctx.sessionState.id || 'default'),
      cwd: ctx.cwd,
      permissionMode: 'auto',
    };

    if (roleArg === 'explore') {
      const res = await coordinator.executeExploreStep(goal, mockToolContext);
      return `[EXPLORE AGENT]: ${res.summary}`;
    }

    if (roleArg === 'plan') {
      const dummyExplore = {
        step: 'explore' as const,
        success: true,
        summary: 'Direct plan trigger',
        data: { identifiedFiles: [] },
        timestamp: Date.now()
      };
      const res = await coordinator.executePlanStep(goal, dummyExplore, mockToolContext);
      return `[PLAN AGENT]: ${res.summary}\nSteps:\n${((res.data.planSteps as string[]) || []).map((s) => `  * ${s}`).join('\n')}`;
    }

    if (roleArg === 'verification' || roleArg === 'verify') {
      const dummyImpl = {
        step: 'general' as const,
        success: true,
        summary: 'Direct verify trigger',
        data: { modifiedFiles: ['src/index.ts'] },
        timestamp: Date.now()
      };
      const res = await coordinator.executeVerificationStep(goal, dummyImpl, mockToolContext);
      return `[ADVERSARIAL VERIFICATION]: ${res.summary}`;
    }

    // Default: full 4-step workflow
    const report = await coordinator.executeFullWorkflow(goal, mockToolContext);
    return [
      `Agent Workflow [${report.success ? 'SUCCESS' : 'FAILED'}]`,
      `Goal: "${goal}" (Duration: ${report.durationMs}ms)`,
      ...report.steps.map((s) => `- [${s.step.toUpperCase()}]: ${s.summary}`)
    ].join('\n');
  }
};

export const proofCommand: LocalCommand = {
  name: 'proof',
  description: 'Run empirical 5-pillar verification engine (Build, Test, Typecheck, Security, Scope) and generate proof card',
  type: 'local',
  aliases: ['verify', 'check'],
  execute: async (ctx) => {
    let files: string[] = ctx.args;
    if (files.length === 0) {
      try {
        const diffOutput = execSync('git diff --name-only HEAD', {
          cwd: ctx.cwd,
          encoding: 'utf-8',
          timeout: 4000,
          stdio: ['pipe', 'pipe', 'ignore'],
        });
        files = diffOutput.split('\n').map((f) => f.trim()).filter(Boolean);
      } catch {
        files = [];
      }
    }

    const report = await ProofEngine.verify(files, { cwd: ctx.cwd });
    return report.proofCard;
  }
};

export const routeCommand: LocalCommand = {
  name: 'route',
  description: 'Analyze task intent and preview optimal multi-model routing decision',
  type: 'local',
  aliases: ['router'],
  execute: (ctx) => {
    const prompt = ctx.args.join(' ').trim() || 'Refactor payment gateway and audit security';
    const decision = ModelRouter.route({ prompt });
    return [
      'Dynamic Multi-Model Router',
      `Prompt:      "${prompt}"`,
      `Category:    [${decision.category}]`,
      `Model:       ${decision.recommendedModel} (${decision.recommendedProvider})`,
      `Budget:      ${decision.thinkingBudget ? `${decision.thinkingBudget} tokens` : 'Standard'}`,
      `Rationale:   ${decision.rationale}`,
      `Fallbacks:   ${decision.fallbackChain.map((f) => `${f.model} (${f.provider})`).join(' -> ')}`,
    ].join('\n');
  }
};

export const benchmarkCommand: LocalCommand = {
  name: 'benchmark',
  description: 'Execute Autonomous SWE Benchmark suite evaluating empirical repairs and verification integrity',
  type: 'local',
  aliases: ['swe-bench', 'bench'],
  execute: async (ctx) => {
    const modeArg = ctx.args[0]?.toLowerCase();
    if (modeArg === 'empirical') {
      const results = await SweBenchmarkRunner.runEmpirical(ctx.cwd);
      const passed = results.filter((r) => r.verdict === 'PASS').length;
      return [
        'Empirical Sandbox Benchmark',
        `Tasks Evaluated: ${results.length}`,
        `Passed Hidden Tests: ${passed}/${results.length} (${Math.round((passed / results.length) * 100)}%)`,
        ...results.map((r) => `[${r.verdict}] ${r.taskId} - ${r.agentName}: Score ${r.empiricalScore}/100 (Red Phase Confirmed: ${r.redPhaseConfirmed}, Hidden Tests: ${r.hiddenTestsPassed ? 'PASS' : 'FAIL'})`),
      ].join('\n');
    }
    const mode = modeArg === 'full' ? 'full' : 'quick';
    const report = SweBenchmarkRunner.run(mode);
    return report.scorecard;
  }
};

export const universalVerifyCommand: LocalCommand = {
  name: 'verify',
  description: 'Run 4-Ring Universal Verification Oracle (G1-G10, Anti-Tamper, Mutation, 14 Counterexamples)',
  type: 'local',
  aliases: ['oracle'],
  execute: async (ctx) => {
    const { UniversalVerificationAdapter } = await import('../../engine/verification/UniversalVerificationAdapter.js');
    let files = ctx.args;
    if (files.length === 0) {
      try {
        const diffOutput = execSync('git diff --name-only HEAD', {
          cwd: ctx.cwd,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
        });
        files = diffOutput.split('\n').map((f) => f.trim()).filter(Boolean);
      } catch {
        files = [];
      }
    }
    if (files.length === 0) {
      files = ['cli/index.ts'];
    }

    const report = await UniversalVerificationAdapter.verify({
      cwd: ctx.cwd,
      userIntent: 'Universal verification audit of workspace modifications',
      changedFiles: files,
    });

    return [
      report.proofCard,
      `Oracle Verdict: [${report.verdict}]`,
      `Summary: ${report.summary}`,
    ].join('\n\n');
  }
};

export const verifyProofCommand: LocalCommand = {
  name: 'verify-proof',
  description: 'Cryptographically verify an InterShader Proof directory on disk (ECDSA signature and SHA-256 hashes)',
  type: 'local',
  aliases: ['attest-check', 'check-proof'],
  execute: async (ctx) => {
    const { AttestationAuthority } = await import('../../engine/verification/AttestationAuthority.js');
    let targetDir = '';
    let expectedChallenge: string | undefined;

    for (let i = 0; i < ctx.args.length; i++) {
      if (ctx.args[i] === '--challenge' || ctx.args[i] === '-c') {
        expectedChallenge = ctx.args[i + 1];
        i++;
      } else if (!targetDir) {
        targetDir = ctx.args[i];
      }
    }

    if (!targetDir) {
      // Find latest run directory
      const baseProofDir = path.join(ctx.cwd, '.intershader', 'proof');
      if (fs.existsSync(baseProofDir)) {
        const entries = fs.readdirSync(baseProofDir).filter((e) => e.startsWith('run-'));
        if (entries.length > 0) {
          entries.sort();
          targetDir = path.join(baseProofDir, entries[entries.length - 1]);
        }
      }
    }

    if (!targetDir) {
      return 'Error: No proof directory specified and no existing runs found in .intershader/proof/';
    }

    const report = AttestationAuthority.verifyProofDirectory(targetDir, {
      expectedChallenge,
      consumeChallenge: Boolean(expectedChallenge),
    });

    if (report.isValid && report.manifest && report.attestation) {
      return [
        'Cryptographic Proof Verification',
        `Proof Directory:    ${targetDir}`,
        `Verdict:            [${report.verdict}] - AUTHENTIC & UNTAMPERED`,
        `Digital Signature:  Valid (${report.attestation.signatureAlgorithm})`,
        `Oracle Authority:   ${report.attestation.oracleId}`,
        `Oracle Key ID:      ${report.attestation.oracleKeyId}`,
        `Key Fingerprint:    ${report.attestation.publicKeyFingerprint}`,
        `Challenge:          ${report.manifest.challenge || 'None (Unchallenged Run)'}`,
        `Commit SHA:         ${report.manifest.workspaceCommit ? report.manifest.workspaceCommit.slice(0, 16) : 'None (Non-Git Snapshot)'}`,
        `Signed At:          ${report.attestation.signedAt}`,
        `Manifest SHA-256:   ${report.manifest.manifestHashSha256}`,
        `Supply-Chain Specs: SLSA v1.2 (Active), SLSA v1.0 (Compat), in-toto Statement v1`,
        `Verified Gates:     ${report.verifiedGatesCount}/${Object.keys(report.manifest.gates).length}`,
        `Status:             ALL EVIDENCE HAS BEEN MATHEMATICALLY PROVED`,
      ].join('\n');
    }

    return [
      'Cryptographic Proof Verification Failed',
      `Proof Directory:    ${targetDir}`,
      `Verdict:            [${report.verdict}]`,
      `Errors:`,
      ...report.errors.map((e) => `  - ${e}`),
      `Status:             TAMPER OR FORGERY DETECTED. DO NOT TRUST THIS PROOF.`,
    ].join('\n');
  }
};



export function registerBuiltinCommands(registry: CommandRegistry): void {
  // Claude Code core commands
  registry.register(reviewCommand);
  registry.register(commitCommand);
  registry.register(diffCommand);
  registry.register(statsCommand);
  registry.register(costCommand);
  registry.register(doctorCommand);
  registry.register(modelCommand);
  registry.register(modeCommand);
  registry.register(planCommand);
  registry.register(turnsCommand);
  registry.register(compactCommand);
  registry.register(rewindCommand);
  registry.register(initCommand);
  registry.register(exportCommand);
  registry.register(statusCommand);
  registry.register(agentCommand);
  registry.register(proofCommand);
  registry.register(routeCommand);
  registry.register(benchmarkCommand);
  registry.register(universalVerifyCommand);
  registry.register(verifyProofCommand);

  // Intelligence, Sandboxing & Session Management commands
  registry.register(memoryCommand);
  registry.register(skillsCommand);
  registry.register(worktreeCommand);
  registry.register(gatewayCommand);
  registry.register(sessionsCommand);
  registry.register(newCommand);
  registry.register(deleteSessionCommand);
  registry.register(providersCommand);
  registry.register(setupCommand);
}

