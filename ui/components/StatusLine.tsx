import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { exec } from 'child_process';
import { THEME } from '../theme.js';
import { ModelRegistry } from '../../orchestrator/ModelRegistry.js';

const GIT_REFRESH_INTERVAL_MS = 10_000;

export interface StatusLineProps {
  model: string;
  provider: string;
  cwd: string;
  permissionMode: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  contextTokens?: number;
  maxContextTokens?: number;
  totalCostUsd?: number;
  isBusy?: boolean;
}

function getContextBar(pct: number, width: number = 8): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled);
}

export function resolveMaxContext(model: string, explicitMax?: number): number {
  if (explicitMax && explicitMax > 0) return explicitMax;

  const direct = ModelRegistry.get(model);
  if (direct?.contextWindow) return direct.contextWindow;

  // Handle prefixed models like "ocz/gemini-3.8-flash" or "google/gemini-1.5-flash"
  const baseName = model.includes('/') ? model.split('/').pop() || model : model;
  const baseProfile = ModelRegistry.get(baseName);
  if (baseProfile?.contextWindow) return baseProfile.contextWindow;

  const m = model.toLowerCase();
  if (m.includes('gemini-1.5') || m.includes('gemini-2.0') || m.includes('gemini-2.5') || m.includes('gemini-3')) {
    return 1_048_576;
  }
  if (m.includes('claude-3-7') || m.includes('claude-3-5') || m.includes('claude-3')) {
    return 200_000;
  }
  if (m.includes('gpt-4o') || m.includes('o1') || m.includes('o3')) {
    return 128_000;
  }
  if (m.includes('deepseek')) {
    return 64_000;
  }
  return 200_000;
}

/**
 * Fetches git branch and dirty-state asynchronously.
 * Returns a cleanup function to abort in-flight calls.
 */
function fetchGitInfo(cwd: string, callback: (info: string) => void): () => void {
  let cancelled = false;

  exec('git branch --show-current', { cwd, timeout: 3000 }, (errBranch, branchOut) => {
    if (cancelled) return;
    if (errBranch) {
      callback('no-git');
      return;
    }
    const branch = branchOut.trim() || 'detached';

    exec('git status --porcelain', { cwd, timeout: 3000 }, (errStatus, statusOut) => {
      if (cancelled) return;
      if (errStatus) {
        callback(branch);
        return;
      }
      callback(statusOut.trim() ? `${branch}*` : branch);
    });
  });

  return () => { cancelled = true; };
}

export const StatusLine: React.FC<StatusLineProps> = ({
  model,
  provider,
  cwd,
  permissionMode,
  totalInputTokens,
  totalOutputTokens,
  contextTokens,
  maxContextTokens,
  totalCostUsd,
  isBusy = false,
}) => {
  const [gitInfo, setGitInfo] = useState('...');
  const lastCwdRef = useRef(cwd);

  useEffect(() => {
    lastCwdRef.current = cwd;

    // Fetch immediately on mount or cwd change
    let cleanup = fetchGitInfo(cwd, setGitInfo);

    const interval = setInterval(() => {
      cleanup();
      cleanup = fetchGitInfo(lastCwdRef.current, setGitInfo);
    }, GIT_REFRESH_INTERVAL_MS);

    return () => {
      cleanup();
      clearInterval(interval);
    };
  }, [cwd]);

  const totalTokens = totalInputTokens + totalOutputTokens;
  const maxContext = resolveMaxContext(model, maxContextTokens);
  const activeTokens = contextTokens !== undefined ? contextTokens : Math.min(totalInputTokens, maxContext);
  const contextPct = Math.min(100, Math.round((activeTokens / maxContext) * 100));
  const bar = getContextBar(contextPct, 8);
  const cost =
    totalCostUsd !== undefined
      ? totalCostUsd
      : (totalInputTokens / 1_000_000) * 3.0 + (totalOutputTokens / 1_000_000) * 15.0;

  const modeColor =
    permissionMode === 'plan'
      ? THEME.colors.warn
      : permissionMode === 'auto'
      ? THEME.colors.ok
      : permissionMode === 'bypassPermissions'
      ? THEME.colors.error
      : THEME.colors.accent;

  const statusLabel = isBusy ? 'running' : 'idle';
  const statusColor = isBusy ? THEME.colors.warn : THEME.colors.ok;

  return (
    <Box
      flexDirection="row"
      justifyContent="space-between"
      borderStyle="single"
      borderColor={THEME.colors.border}
      paddingX={1}
      marginY={0}
    >
      {/* Left: Status indicator, Model & Context Bar */}
      <Box gap={1} alignItems="center">
        <Text color={THEME.colors.border}>{'\u2500'}</Text>
        <Text bold color={statusColor}>
          [{statusLabel}]
        </Text>
        <Text color={THEME.colors.border}>{'\u2502'}</Text>
        <Text bold color={THEME.colors.text}>
          {model}
        </Text>
        <Text color={THEME.colors.muted}>({provider})</Text>
        <Text color={THEME.colors.border}>{'\u2502'}</Text>
        <Text color={THEME.colors.accent}>
          {totalTokens.toLocaleString()} tok
        </Text>
        <Text color={THEME.colors.border}>{'\u2502'}</Text>
        <Text color={contextPct > 80 ? THEME.colors.warn : THEME.colors.ok}>
          ctx:[{bar}] {contextPct}%
        </Text>
      </Box>

      {/* Right: Mode, Cost & Git info */}
      <Box gap={1} alignItems="center">
        <Text bold color={modeColor}>
          [{permissionMode.toUpperCase()}]
        </Text>
        <Text color={THEME.colors.border}>{'\u2502'}</Text>
        <Text bold color={THEME.colors.ok}>
          ${cost.toFixed(3)}
        </Text>
        <Text color={THEME.colors.border}>{'\u2502'}</Text>
        <Text bold color={THEME.colors.primary}>
          git:({gitInfo})
        </Text>
      </Box>
    </Box>
  );
};
