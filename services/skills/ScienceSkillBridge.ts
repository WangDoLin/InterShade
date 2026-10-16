import { execSync, spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

export interface ScienceScriptExecutionOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  useOsMesa?: boolean; // Required for headless PyMOL
}

export interface ScienceScriptExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  outputArtifacts: string[];
}

/**
 * ScienceSkillBridge manages execution of scientific computation scripts (e.g., PyMOL,
 * bio-informatics, chemistry pipelines) using PEP 723 inline dependency headers and `uv run`.
 * Inspired by modern science-skills plugins and headless OSMesa software rendering.
 */
export class ScienceSkillBridge {
  private static cachedUvPath: string | null = null;

  /**
   * Resolve absolute path to scripts folder for an installed science skill.
   */
  static getSkillScriptsDir(skillName: string): string {
    const skillDir = path.join(os.homedir(), '.gemini', 'config', 'plugins', 'science', 'skills', skillName, 'scripts');
    if (fs.existsSync(skillDir)) {
      return skillDir;
    }
    return '';
  }

  /**
   * Check whether `uv` package manager is installed and accessible.
   */
  static isUvAvailable(): boolean {
    if (this.cachedUvPath !== null) {
      return this.cachedUvPath.length > 0;
    }

    try {
      const output = execSync('uv --version', {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 5000,
      });
      this.cachedUvPath = output.trim();
      return true;
    } catch {
      this.cachedUvPath = '';
      return false;
    }
  }

  /**
   * Execute a scientific Python script using `uv run` or fallback python.
   * Automatically configures OSMesa headless rendering environment variables when requested.
   */
  static async runScript(
    scriptPath: string,
    args: string[] = [],
    options: ScienceScriptExecutionOptions = {}
  ): Promise<ScienceScriptExecutionResult> {
    const cwd = options.cwd || process.cwd();
    const timeout = options.timeoutMs || 60000;

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...options.env,
    };

    // If OSMesa headless rendering is requested (standard for PyMOL on headless servers)
    if (options.useOsMesa) {
      env.PYOPENGL_PLATFORM = 'osmesa';
    }

    const isUv = this.isUvAvailable();
    const binary = isUv ? 'uv' : (process.platform === 'win32' ? 'python' : 'python3');
    const commandArgs = isUv ? ['run', scriptPath, ...args] : [scriptPath, ...args];

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';

      const child = spawn(binary, commandArgs, {
        cwd,
        env,
        stdio: 'pipe',
        timeout,
      });

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (err) => {
        resolve({
          success: false,
          stdout,
          stderr: `${stderr}\n${err.message}`,
          exitCode: 1,
          outputArtifacts: [],
        });
      });

      child.on('close', (code) => {
        // Collect any generated .pse, .png, or .pdb files in cwd
        const outputArtifacts: string[] = [];
        try {
          const files = fs.readdirSync(cwd);
          for (const file of files) {
            const ext = path.extname(file).toLowerCase();
            if (['.png', '.pse', '.pdb', '.cif', '.svg'].includes(ext)) {
              outputArtifacts.push(path.join(cwd, file));
            }
          }
        } catch {
          // ignore scan error
        }

        resolve({
          success: code === 0,
          stdout,
          stderr,
          exitCode: code,
          outputArtifacts,
        });
      });
    });
  }
}
