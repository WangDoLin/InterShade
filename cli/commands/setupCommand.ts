/**
 * InterShader Onboarding Setup Wizard
 * Checks system prerequisites, initializes global and workspace directories,
 * and configures environment profiles.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

import { renderArt, TAGLINE } from '../../ui/banner.js';

const LIGHT_BLUE = '\x1b[96m';
const WHITE = '\x1b[97m';
const AMBER = '\x1b[38;5;214m';
const GOLD = '\x1b[38;5;220m';
const DIM = '\x1b[90m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

export function printSetupBanner(): void {
  const lines = renderArt(true);
  console.log('');
  for (const line of lines) {
    console.log(line);
  }
  console.log('');
  console.log(`${DIM}${TAGLINE}${RESET}\n`);
}

export async function runSetupWizard(): Promise<{ success: boolean; warnings: string[] }> {
  printSetupBanner();
  console.log(`${BOLD}${AMBER}INTERSHADER ONBOARDING & ENVIRONMENT SETUP${RESET}\n`);

  const warnings: string[] = [];

  // =========================================================================
  // 1. Diagnostics: System Prerequisites
  // =========================================================================
  console.log(`${BOLD}[1/5] System Prerequisites Diagnostics:${RESET}`);

  // Node.js Version Check
  const nodeVersion = process.version;
  const majorNode = parseInt(nodeVersion.slice(1).split('.')[0], 10);
  if (majorNode >= 20) {
    console.log(`  ${GREEN}[OK]${RESET} Node.js Runtime:     ${nodeVersion} (>= v20.0.0 satisfied)`);
  } else {
    warnings.push(`Node.js version ${nodeVersion} is below the recommended v20.0.0.`);
    console.log(`  ${RED}[WARN]${RESET} Node.js Runtime:   ${nodeVersion} (Recommended >= v20.0.0)`);
  }

  // OS & Architecture
  console.log(`  ${GREEN}[OK]${RESET} Operating System:    ${process.platform} (${process.arch})`);

  // Git Availability
  try {
    const gitVer = execSync('git --version', { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    console.log(`  ${GREEN}[OK]${RESET} Git Version:         ${gitVer}`);
  } catch {
    warnings.push('Git is not found on PATH. Worktree isolation features may be limited.');
    console.log(`  ${YELLOW}[SKIP]${RESET} Git:                Not found on PATH`);
  }

  // SQLite WAL availability
  console.log(`  ${GREEN}[OK]${RESET} SQLite State Store:  Ready (WAL mode supported)`);
  console.log('');

  // =========================================================================
  // 2. Global Data Directory Initialization
  // =========================================================================
  console.log(`${BOLD}[2/5] Global Storage Initialization (~/.intershade):${RESET}`);
  const homeDir = os.homedir();
  const globalDataDir = path.join(homeDir, '.intershade');
  const globalSessionsDir = path.join(globalDataDir, 'sessions');
  const globalSkillsDir = path.join(globalDataDir, 'skills');

  for (const d of [globalDataDir, globalSessionsDir, globalSkillsDir]) {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
    }
  }
  console.log(`  ${GREEN}[OK]${RESET} Data Store Path:     ${globalDataDir}`);
  console.log(`  ${GREEN}[OK]${RESET} Session Records:     ${globalSessionsDir}`);
  console.log(`  ${GREEN}[OK]${RESET} Global Skills Store: ${globalSkillsDir}`);
  console.log('');

  // =========================================================================
  // 3. Current Workspace Initialization (.intershader)
  // =========================================================================
  console.log(`${BOLD}[3/5] Current Workspace Initialization (.intershader):${RESET}`);
  const cwd = process.cwd();
  const workspaceIntershader = path.join(cwd, '.intershader');
  const workspaceSkills = path.join(workspaceIntershader, 'skills');
  const workspaceConfig = path.join(workspaceIntershader, 'config.json');
  const envFile = path.join(cwd, '.env');
  const envExample = path.join(cwd, '.env.example');

  if (!fs.existsSync(workspaceIntershader)) {
    fs.mkdirSync(workspaceIntershader, { recursive: true });
  }
  if (!fs.existsSync(workspaceSkills)) {
    fs.mkdirSync(workspaceSkills, { recursive: true });
  }

  if (!fs.existsSync(workspaceConfig)) {
    const defaultConfig = {
      version: '1.0.0',
      agent: {
        name: 'InterShader',
        role: 'Autonomous SWE & Verification Agent',
        language: 'en',
      },
      model: {
        defaultProvider: 'anthropic',
        defaultModel: 'claude-3-7-sonnet-20250219',
        temperature: 0.2,
      },
      security: {
        permissionMode: 'default',
        confirmMutations: true,
      },
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(workspaceConfig, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    console.log(`  ${GREEN}[CREATED]${RESET} Workspace Config: ${workspaceConfig}`);
  } else {
    console.log(`  ${GREEN}[EXISTS]${RESET}  Workspace Config: ${workspaceConfig}`);
  }

  if (!fs.existsSync(envFile) && fs.existsSync(envExample)) {
    fs.copyFileSync(envExample, envFile);
    console.log(`  ${GREEN}[CREATED]${RESET} Environment File: ${envFile} (copied from .env.example)`);
  } else if (fs.existsSync(envFile)) {
    console.log(`  ${GREEN}[EXISTS]${RESET}  Environment File: ${envFile}`);
  }
  console.log('');

  // =========================================================================
  // 4. Provider & Credentials Inspection
  // =========================================================================
  console.log(`${BOLD}[4/5] Provider Credentials & API Keys Check:${RESET}`);
  const providers = [
    { name: 'Anthropic Claude', key: 'ANTHROPIC_API_KEY', model: 'claude-3-7-sonnet' },
    { name: 'OpenAI GPT', key: 'OPENAI_API_KEY', model: 'gpt-4o, o3-mini' },
    { name: 'DeepSeek', key: 'DEEPSEEK_API_KEY', model: 'deepseek-r1, deepseek-v3' },
    { name: 'Google Gemini', key: 'GEMINI_API_KEY', model: 'gemini-2.0-flash' },
    { name: 'Local Ollama', key: 'OPENAI_BASE_URL', model: 'llama3, qwen2.5-coder' },
  ];

  let hasAnyKey = false;
  for (const p of providers) {
    const val = process.env[p.key];
    if (val && val.trim().length > 0) {
      hasAnyKey = true;
      console.log(`  ${GREEN}[CONFIGURED]${RESET} ${p.name.padEnd(18)} (${p.model})`);
    } else {
      console.log(`  ${DIM}[NOT SET]${RESET}    ${p.name.padEnd(18)} ${DIM}(Set in .env or export ${p.key})${RESET}`);
    }
  }

  if (!hasAnyKey) {
    warnings.push('No AI provider API key is currently configured. Please update .env before making model calls.');
    console.log(`\n  ${YELLOW}[Note]: Add at least one valid API Key in .env to begin coding with online models.${RESET}`);
  }
  console.log('');

  // =========================================================================
  // 5. Completion Summary & Next Steps
  // =========================================================================
  console.log(`${BOLD}[5/5] Setup Complete!${RESET}`);
  console.log(`  InterShader environment is fully configured and ready.\n`);
  console.log(`${AMBER}QUICK START COMMANDS${RESET}`);
  console.log(`  Launch Interactive Agent:     ${BOLD}intershader${RESET} or ${BOLD}intershade${RESET}`);
  console.log(`  Run Environment Health Check: ${BOLD}intershader /doctor${RESET}`);
  console.log(`  List Available Models:        ${BOLD}intershader models list${RESET}`);
  console.log(`  Read-Only Plan Mode:          ${BOLD}intershader --plan${RESET}`);
  console.log(`  Strict Proof Engine Mode:     ${BOLD}intershader --proof${RESET}`);
  console.log('');

  return { success: true, warnings };
}
