import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Box, Static, useApp, useInput } from 'ink';
import { randomUUID } from 'crypto';

import { Header } from './components/Header.js';
import { StatusLine } from './components/StatusLine.js';
import { MessageView } from './components/MessageView.js';
import { ToolProgressBlock } from './components/ToolProgressBlock.js';
import { InteractivePrompt } from './components/InteractivePrompt.js';
import { PermissionPrompt } from './components/PermissionPrompt.js';
import { HistoryInspectionView } from './components/HistoryInspectionView.js';
import { ReturnToBottomBar } from './components/ReturnToBottomBar.js';
import { TerminalMouseManager } from './services/TerminalMouseManager.js';
import { extractPromptTurns, truncatePromptText } from './utils/turnExtractor.js';
import { PlanManager } from '../state/PlanManager.js';
import type { QueryEngine } from '../orchestrator/QueryEngine.js';
import type { UnifiedMessage, PermissionRequest } from '../types/index.js';

import { i18n, t } from '../services/i18n/index.js';
import { SUPPORTED_LOCALES } from '../services/i18n/types.js';
import { CommandRegistry, registerBuiltinCommands } from '../cli/commands/index.js';

const commandRegistry = new CommandRegistry();
registerBuiltinCommands(commandRegistry);

export interface AppProps {
  queryEngine: QueryEngine;
  initialPrompt?: string;
}

export const App: React.FC<AppProps> = ({ queryEngine, initialPrompt }) => {
  const { exit } = useApp();
  const [messages, setMessages] = useState<UnifiedMessage[]>(queryEngine.getMessages());
  const [sessionState, setSessionState] = useState(queryEngine.getSessionState());
  const [contextTokens, setContextTokens] = useState<number>(queryEngine.getContextTokens());
  const [currentToolName, setCurrentToolName] = useState<string | null>(null);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [queuedPrompt, setQueuedPrompt] = useState<string | null>(null);
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(null);
  const [viewingTurnIndex, setViewingTurnIndex] = useState<number | null>(null);

  useEffect(() => {
    const mouseMgr = TerminalMouseManager.getInstance();
    mouseMgr.enable();
    return () => {
      mouseMgr.disable();
    };
  }, []);

  const promptTurns = useMemo(() => extractPromptTurns(messages), [messages]);

  const selectedTurn = useMemo(() => {
    if (viewingTurnIndex === null) return null;
    return promptTurns.find((t) => t.turnIndex === viewingTurnIndex) || null;
  }, [promptTurns, viewingTurnIndex]);

  const handleSelectTurn = useCallback((turnIndex: number) => {
    setViewingTurnIndex(turnIndex);
  }, []);

  const handleReturnToBottom = useCallback(() => {
    setViewingTurnIndex(null);
  }, []);


  const isBusyRef = useRef(isBusy);
  isBusyRef.current = isBusy;
  const queuedPromptRef = useRef<string | null>(null);
  const handleUserSubmitRef = useRef<(p: string) => Promise<void>>(async () => {});
  const lastAbortTimeRef = useRef(0);

  const handleAbort = useCallback(() => {
    const now = Date.now();
    if (now - lastAbortTimeRef.current < 250) {
      return; // Debounce rapid multi-source triggers
    }
    lastAbortTimeRef.current = now;

    const isRunning = isBusyRef.current || queryEngine.getIsRunning();

    if (isRunning) {
      // Abort in-flight agent task while preserving the InterShader session
      if (queuedPromptRef.current) {
        queuedPromptRef.current = null;
        setQueuedPrompt(null);
      }
      if (pendingPermission) {
        pendingPermission.respond(false, false);
        setPendingPermission(null);
      }

      setIsBusy(false);
      isBusyRef.current = false;
      setCurrentToolName(null);
      setProgressText(null);

      queryEngine.abort();

      setMessages([...queryEngine.getMessages()]);
      setContextTokens(queryEngine.getContextTokens());
    } else {
      // Agent is idle: Exit the InterShader CLI session cleanly
      exit();
    }
  }, [queryEngine, exit, pendingPermission]);

  // Global key interception: Ctrl+C (abort/exit) & Alt+1..9 (rewind to turn)
  useInput((input, key) => {
    if (key.ctrl && (input === 'c' || input === 'C')) {
      handleAbort();
      return;
    }

    // Alt + 1..9 jumps to prompt turn (Antigravity CLI style)
    if (key.meta && /^[1-9]$/.test(input)) {
      const targetTurn = parseInt(input, 10);
      if (targetTurn <= promptTurns.length) {
        setViewingTurnIndex(targetTurn);
      }
    }
  });


  // Global process-level SIGINT listener (handles OS signals, terminal break events)
  useEffect(() => {
    const onSigInt = () => {
      handleAbort();
    };
    process.on('SIGINT', onSigInt);
    return () => {
      process.off('SIGINT', onSigInt);
    };
  }, [handleAbort]);


  const handleClearQueue = useCallback(() => {
    queuedPromptRef.current = null;
    setQueuedPrompt(null);
  }, []);

  const handleError = useCallback((err?: unknown) => {
    setIsBusy(false);
    isBusyRef.current = false;
    if (queuedPromptRef.current) {
      queuedPromptRef.current = null;
      setQueuedPrompt(null);
    }
    setCurrentToolName(null);
    setProgressText(null);
    setPendingPermission(null);
    const currentMsgs = queryEngine.getMessages();
    const lastMsg = currentMsgs[currentMsgs.length - 1];
    if (!lastMsg || lastMsg.role !== 'assistant' || !lastMsg.content) {
      const rawDetail = err instanceof Error ? err.message : String(err || 'Request failed');
      const cleanDetail = rawDetail.length > 250 ? `${rawDetail.slice(0, 247)}...` : rawDetail;
      const fallbackMsg: UnifiedMessage = {
        id: randomUUID(),
        role: 'assistant',
        content: `[Error]: ${cleanDetail}`,
        timestamp: Date.now(),
      };
      setMessages([...currentMsgs, fallbackMsg]);
      setContextTokens(queryEngine.getContextTokens());
    } else {
      setMessages([...currentMsgs]);
      setContextTokens(queryEngine.getContextTokens());
    }
  }, [queryEngine]);

  useEffect(() => {
    // 35ms UI render throttler (~28 FPS) to prevent terminal cursor stutter and 100% CPU on high-frequency stream chunks
    let lastRenderTime = 0;
    let pendingProgressText: string | null = null;
    let throttleTimer: NodeJS.Timeout | null = null;

    const flushProgress = () => {
      if (pendingProgressText !== null) {
        setProgressText(pendingProgressText);
      }
      setContextTokens(queryEngine.getContextTokens());
      lastRenderTime = Date.now();
      throttleTimer = null;
    };

    const scheduleProgressUpdate = (cleanText?: string) => {
      if (cleanText !== undefined) {
        pendingProgressText = cleanText;
      }
      const now = Date.now();
      const elapsed = now - lastRenderTime;
      if (elapsed >= 35) {
        if (throttleTimer) {
          clearTimeout(throttleTimer);
          throttleTimer = null;
        }
        flushProgress();
      } else if (!throttleTimer) {
        throttleTimer = setTimeout(flushProgress, 35 - elapsed);
      }
    };

    // Listen to QueryEngine events
    const handleText = (delta?: string) => {
      if (delta) {
        const clean = delta.replace(/\r/g, '').replace(/\s+/g, ' ').trim();
        if (clean) {
          scheduleProgressUpdate(clean.length > 70 ? `${clean.slice(-67)}...` : clean);
          return;
        }
      }
      scheduleProgressUpdate();
    };

    const handleThought = (delta?: string) => {
      if (delta) {
        const clean = delta.replace(/\r/g, '').replace(/\s+/g, ' ').trim();
        if (clean) {
          scheduleProgressUpdate(clean.length > 70 ? `${clean.slice(0, 67)}...` : clean);
        }
      }
    };

    const handleToolStart = (name: string) => {
      if (throttleTimer) {
        clearTimeout(throttleTimer);
        throttleTimer = null;
      }
      setCurrentToolName(name);
      setProgressText(null);
      setMessages([...queryEngine.getMessages()]);
      setContextTokens(queryEngine.getContextTokens());
    };

    const handleToolProgress = (progress: string) => {
      scheduleProgressUpdate(progress);
    };

    const handleToolDone = () => {
      if (throttleTimer) {
        clearTimeout(throttleTimer);
        throttleTimer = null;
      }
      setCurrentToolName(null);
      setProgressText(null);
      setMessages([...queryEngine.getMessages()]);
      setContextTokens(queryEngine.getContextTokens());
    };

    const handleUsage = () => {
      setSessionState({ ...queryEngine.getSessionState() });
      setContextTokens(queryEngine.getContextTokens());
    };

    const handleDone = () => {
      if (throttleTimer) {
        clearTimeout(throttleTimer);
        throttleTimer = null;
      }
      setIsBusy(false);
      isBusyRef.current = false;
      setCurrentToolName(null);
      setProgressText(null);
      setPendingPermission(null);
      setMessages([...queryEngine.getMessages()]);
      setSessionState({ ...queryEngine.getSessionState() });
      setContextTokens(queryEngine.getContextTokens());

      if (queuedPromptRef.current) {
        const next = queuedPromptRef.current;
        queuedPromptRef.current = null;
        setQueuedPrompt(null);
        setTimeout(() => {
          handleUserSubmitRef.current(next);
        }, 100);
      }
    };

    const handlePermissionRequest = (req: PermissionRequest) => {
      setPendingPermission(req);
    };

    const handleSessionReset = (newSession: any) => {
      setSessionState({ ...newSession });
      setMessages([...queryEngine.getMessages()]);
      setContextTokens(queryEngine.getContextTokens());
    };

    const handleUserMessage = () => {
      setMessages([...queryEngine.getMessages()]);
      setContextTokens(queryEngine.getContextTokens());
    };

    const handleSyntheticMessage = () => {
      setMessages([...queryEngine.getMessages()]);
      setContextTokens(queryEngine.getContextTokens());
    };

    queryEngine.on('text', handleText);
    queryEngine.on('thought', handleThought);
    queryEngine.on('user_message', handleUserMessage);
    queryEngine.on('message', handleSyntheticMessage);
    queryEngine.on('tool_start', handleToolStart);
    queryEngine.on('tool_progress', handleToolProgress);
    queryEngine.on('tool_done', handleToolDone);
    queryEngine.on('usage', handleUsage);
    queryEngine.on('done', handleDone);
    queryEngine.on('error', handleError);
    queryEngine.on('permission_request', handlePermissionRequest);
    queryEngine.on('session_reset', handleSessionReset);

    // If initial prompt was passed from CLI
    if (initialPrompt && !isBusy) {
      handleUserSubmit(initialPrompt);
    }

    return () => {
      queryEngine.removeAllListeners();
    };
  }, [queryEngine, handleError]);

  const handleUserSubmit = async (prompt: string) => {
    if (prompt === '/exit' || prompt === '/quit') {
      if (isBusyRef.current) {
        queryEngine.abort();
      }
      exit();
      return;
    }

    if (prompt === '/unqueue' || prompt === '/clear-queue' || prompt === '/dq') {
      if (queuedPromptRef.current) {
        queuedPromptRef.current = null;
        setQueuedPrompt(null);
        const noticeMsg: UnifiedMessage = {
          id: randomUUID(),
          role: 'assistant',
          content: '[Queue]: Cleared queued prompt.',
          timestamp: Date.now(),
        };
        queryEngine.appendSyntheticMessage(noticeMsg);
        setMessages([...queryEngine.getMessages()]);
      } else {
        const noticeMsg: UnifiedMessage = {
          id: randomUUID(),
          role: 'assistant',
          content: '[Queue]: No prompt is currently queued.',
          timestamp: Date.now(),
        };
        queryEngine.appendSyntheticMessage(noticeMsg);
        setMessages([...queryEngine.getMessages()]);
      }
      return;
    }

    if (isBusyRef.current) {
      const trimmed = prompt.trim();
      if (trimmed) {
        queuedPromptRef.current = trimmed;
        setQueuedPrompt(trimmed);
      }
      return;
    }

    if (prompt === '/clear') {
      queryEngine.clearMessages();
      setMessages([]);
      setContextTokens(queryEngine.getContextTokens());
      process.stdout.write('\x1b[2J\x1b[H\x1b[3J');
      return;
    }

    if (
      prompt === '/new' ||
      prompt.startsWith('/new ') ||
      prompt === '/reset' ||
      prompt.startsWith('/reset ') ||
      prompt === '/delete' ||
      prompt.startsWith('/delete ') ||
      prompt === '/delete-session' ||
      prompt.startsWith('/delete-session ') ||
      prompt === '/drop' ||
      prompt.startsWith('/drop ')
    ) {
      const parts = prompt.split(' ');
      const cmdName = parts[0];
      const args = parts.slice(1);
      const isDeleteRequested =
        cmdName === '/delete' ||
        cmdName === '/delete-session' ||
        cmdName === '/drop' ||
        args.includes('--delete') ||
        args.includes('-d');

      const oldSessionId = sessionState.id;
      const newSession = queryEngine.resetSession({ deleteCurrent: isDeleteRequested });

      setMessages([]);
      setSessionState(newSession);
      setContextTokens(queryEngine.getContextTokens());
      setCurrentToolName(null);
      setProgressText(null);
      setPendingPermission(null);

      // Clean terminal screen and scrollback for the fresh conversation
      process.stdout.write('\x1b[2J\x1b[H\x1b[3J');

      const notice = isDeleteRequested
        ? t('slash.deletedSession', [oldSessionId.slice(0, 8), newSession.id.slice(0, 8)])
        : t('slash.newSession', [newSession.id.slice(0, 8)]);

      const noticeMsg: UnifiedMessage = {
        id: randomUUID(),
        role: 'assistant',
        content: notice,
        timestamp: Date.now(),
      };
      setMessages([noticeMsg]);
      return;
    }

    if (prompt.startsWith('/lang')) {
      const userCmdMsg: UnifiedMessage = {
        id: randomUUID(),
        role: 'user',
        content: prompt,
        timestamp: Date.now(),
      };
      queryEngine.appendSyntheticMessage(userCmdMsg);

      const parts = prompt.split(' ');
      const targetLang = parts[1];
      if (!targetLang) {
        const current = i18n.getLocale();
        const infoMsg: UnifiedMessage = {
          id: randomUUID(),
          role: 'assistant',
          content: `${t('header.lang')}: ${current}. Available: ${SUPPORTED_LOCALES.join(', ')}`,
          timestamp: Date.now() + 1,
        };
        queryEngine.appendSyntheticMessage(infoMsg);
        setMessages([...queryEngine.getMessages()]);
        return;
      }

      const success = i18n.setLocale(targetLang);
      const noticeText = success
        ? t('slash.langChanged', [i18n.getLocale()])
        : t('slash.langInvalid', [targetLang, SUPPORTED_LOCALES.join(', ')]);

      const noticeMsg: UnifiedMessage = {
        id: randomUUID(),
        role: 'assistant',
        content: noticeText,
        timestamp: Date.now() + 1,
      };
      queryEngine.appendSyntheticMessage(noticeMsg);
      setMessages([...queryEngine.getMessages()]);
      setSessionState({ ...queryEngine.getSessionState() });
      setContextTokens(queryEngine.getContextTokens());
      return;
    }

    if (prompt === '/plan' || prompt.startsWith('/plan ')) {
      const userCmdMsg: UnifiedMessage = {
        id: randomUUID(),
        role: 'user',
        content: prompt,
        timestamp: Date.now(),
      };
      queryEngine.appendSyntheticMessage(userCmdMsg);

      const targetPath = prompt.replace(/^\/plan\s*/, '').trim();
      const sub = targetPath.toLowerCase();

      if (sub === 'view' || sub === 'show') {
        const plan = PlanManager.getActivePlan(sessionState.id);
        const content = plan
          ? PlanManager.formatPlanMarkdown(plan, { showChangelog: true })
          : '[PLAN NOTICE]: No active plan has been established for this session yet. Type your planning request or /plan to start.';
        const planMsg: UnifiedMessage = {
          id: randomUUID(),
          role: 'assistant',
          content,
          timestamp: Date.now() + 1,
        };
        queryEngine.appendSyntheticMessage(planMsg);
        setMessages([...queryEngine.getMessages()]);
        return;
      }

      if (sub === 'reset' || sub === 'clear') {
        PlanManager.clearPlan(sessionState.id);
        const resetMsg: UnifiedMessage = {
          id: randomUUID(),
          role: 'assistant',
          content: '[PLAN RESET]: Active plan cleared from session memory. Ready to establish a new plan.',
          timestamp: Date.now() + 1,
        };
        queryEngine.appendSyntheticMessage(resetMsg);
        setMessages([...queryEngine.getMessages()]);
        return;
      }

      const currentMode = sessionState.permissionMode;
      const nextMode = currentMode === 'plan' && !targetPath ? 'default' : 'plan';
      queryEngine.setPermissionMode(nextMode);

      let noticeText = nextMode === 'plan' ? t('slash.planModeOn') : t('slash.planModeOff');
      if (targetPath) {
        noticeText += `\nTarget Scope: ${targetPath}\nReady for planning. Describe what features or fixes you want to investigate.`;
      }
      const activePlan = PlanManager.getActivePlan(sessionState.id);
      if (activePlan && nextMode === 'plan') {
        noticeText += `\n\nActive Plan (v${activePlan.currentVersion}): "${activePlan.title}" with ${activePlan.steps.length} steps. Any updates will merge with this plan.`;
      }

      const noticeMsg: UnifiedMessage = {
        id: randomUUID(),
        role: 'assistant',
        content: noticeText,
        timestamp: Date.now() + 1,
      };
      queryEngine.appendSyntheticMessage(noticeMsg);
      setMessages([...queryEngine.getMessages()]);
      setSessionState({ ...sessionState, permissionMode: nextMode });
      return;
    }

    // Check CommandRegistry for registered slash commands (PromptCommand, LocalCommand)
    const parsedCmd = commandRegistry.parseInput(prompt);
    if (parsedCmd) {
      const cmd = commandRegistry.get(parsedCmd.commandName);
      if (cmd) {
        const userCmdMsg: UnifiedMessage = {
          id: randomUUID(),
          role: 'user',
          content: prompt,
          timestamp: Date.now(),
        };
        queryEngine.appendSyntheticMessage(userCmdMsg);

        const cmdCtx = {
          cwd: sessionState.cwd,
          sessionState: sessionState as unknown as Record<string, unknown>,
          args: parsedCmd.args,
        };

        if (cmd.type === 'local') {
          const res = await cmd.execute(cmdCtx);
          const localMsg: UnifiedMessage = {
            id: randomUUID(),
            role: 'assistant',
            content: res,
            timestamp: Date.now() + 1,
          };
          queryEngine.appendSyntheticMessage(localMsg);
          setMessages([...queryEngine.getMessages()]);

          // Synchronize sessionState and QueryEngine with model/provider/maxTurns/permissionMode changes
          const updatedState = { ...sessionState, ...(cmdCtx.sessionState as unknown as typeof sessionState) };
          setSessionState(updatedState);
          if (updatedState.permissionMode && updatedState.permissionMode !== sessionState.permissionMode) {
            queryEngine.setPermissionMode(updatedState.permissionMode);
          }
          if (updatedState.provider && updatedState.model) {
            queryEngine.updateSessionModel(updatedState.provider, updatedState.model);
          }
          if ((cmdCtx.sessionState as Record<string, unknown>).maxTurns !== undefined) {
            queryEngine.updateMaxTurns((cmdCtx.sessionState as Record<string, unknown>).maxTurns as number);
          }
          return;
        }

        if (cmd.type === 'prompt') {
          const expandedPrompt = await cmd.getPrompt(cmdCtx);
          setIsBusy(true);
          isBusyRef.current = true;
          try {
            await queryEngine.executeUserPrompt(expandedPrompt);
          } catch {
            // Handled in event listeners
          } finally {
            setIsBusy(false);
            isBusyRef.current = false;
          }
          return;
        }
      }
    }

    // History Inspection Navigation Slash Commands
    if (prompt.startsWith('/inspect') || prompt.startsWith('/turn')) {
      const parts = prompt.trim().split(/\s+/);
      const targetTurn = parseInt(parts[1], 10);
      if (!isNaN(targetTurn) && targetTurn >= 1 && targetTurn <= promptTurns.length) {
        setViewingTurnIndex(targetTurn);
        return;
      }
    }

    if (prompt === '/history') {
      const historySummary =
        promptTurns.length === 0
          ? 'No previous prompt turns in this session yet.'
          : [
              'Session Prompt History:',
              ...promptTurns.map(
                (t) =>
                  `  Turn #${t.turnIndex}: "${truncatePromptText(t.promptText, 50)}" (Alt+${t.turnIndex} or /turn ${t.turnIndex})`
              ),
              '',
              'Use /turn <number> or Alt+1..9 to inspect any past turn, /return to return to bottom.',
            ].join('\n');
      const historyMsg: UnifiedMessage = {
        id: randomUUID(),
        role: 'assistant',
        content: historySummary,
        timestamp: Date.now(),
      };
      queryEngine.appendSyntheticMessage(historyMsg);
      setMessages([...queryEngine.getMessages()]);
      return;
    }

    if (prompt === '/return' || prompt === '/bottom') {
      setViewingTurnIndex(null);
      return;
    }

    if (prompt === '/help') {
      const userCmdMsg: UnifiedMessage = {
        id: randomUUID(),
        role: 'user',
        content: prompt,
        timestamp: Date.now(),
      };
      queryEngine.appendSyntheticMessage(userCmdMsg);

      const allCommands = commandRegistry.list();
      const codeQualityNames = ['doctor', 'review', 'commit', 'diff', 'rewind', 'init', 'export'];
      const intelligenceNames = ['model', 'mode', 'turns', 'compact', 'status', 'stats', 'cost', 'memory', 'skills', 'worktree', 'gateway', 'sessions'];

      const codeQualityCmds = allCommands.filter((c) => codeQualityNames.includes(c.name));
      const intelligenceCmds = allCommands.filter((c) => intelligenceNames.includes(c.name));

      const helpMsg: UnifiedMessage = {
        id: randomUUID(),
        role: 'assistant',
        content: [
          'InterShader Slash Commands',
          '',
          '[System & Session Controls]',
          '  /plan [path|view|reset] - Toggle Plan Mode, inspect active plan, or reset',
          '  /history     - View prompt history turns and shortcuts',
          '  /turn <id>   - Inspect historical prompt turn in rewind viewport',
          '  /return      - Return to latest bottom prompt input',
          '  /lang <id>   - Switch UI language (en, vi, ja, zh, es, fr, de, ko, ru)',
          '  /unqueue     - Delete/clear currently queued prompt',
          '  /clear       - Clear chat screen',
          '  /exit, /quit - Exit terminal',
          '',
          '[Code Quality & Versioning]',

          ...codeQualityCmds.map((c) => `  /${c.name.padEnd(12)} - ${c.description}`),
          '',
          '[Intelligence & Sandboxing]',
          ...intelligenceCmds.map((c) => `  /${c.name.padEnd(12)} - ${c.description}`),
        ].join('\n'),
        timestamp: Date.now() + 1,
      };
      queryEngine.appendSyntheticMessage(helpMsg);
      setMessages([...queryEngine.getMessages()]);
      return;
    }

    if (process.stdout.isTTY) {
      try {
        const shortPrompt = truncatePromptText(prompt, 35);
        process.stdout.write(`\x1b]0;InterShader [Turn #${promptTurns.length + 1}]: ${shortPrompt}\x07`);
      } catch {
        // Ignore if stdout is closed
      }
    }

    setIsBusy(true);
    isBusyRef.current = true;
    try {
      await queryEngine.executeUserPrompt(prompt);
    } catch (err: unknown) {
      handleError(err);
    } finally {
      setIsBusy(false);
      isBusyRef.current = false;
    }
  };

  handleUserSubmitRef.current = handleUserSubmit;

  const totalTokens = sessionState.totalInputTokens + sessionState.totalOutputTokens;

  // Filter out system messages from display
  const visibleMessages = useMemo(
    () => messages.filter((m) => m.role !== 'system'),
    [messages]
  );

  type StaticItem =
    | { type: 'header'; id: string }
    | {
        type: 'message';
        id: string;
        message: UnifiedMessage;
        previousPrompt?: string;
        turnIndex?: number;
      };

  // All conversation messages in visibleMessages are completed turns.
  // Rendering them directly via <Static> guarantees they are printed once in full to stdout,
  // scroll naturally without truncation, and never overflow the dynamic terminal area.
  const staticItems: StaticItem[] = useMemo(() => {
    const items: StaticItem[] = [{ type: 'header', id: 'session-header' }];
    let userTurnCounter = 0;
    for (const msg of visibleMessages) {
      if (msg.role === 'user') {
        userTurnCounter++;
        const prevTurn = promptTurns.find((t) => t.turnIndex === userTurnCounter - 1);
        items.push({
          type: 'message',
          id: msg.id,
          message: msg,
          previousPrompt: prevTurn?.promptText,
          turnIndex: userTurnCounter,
        });
      } else {
        items.push({ type: 'message', id: msg.id, message: msg });
      }
    }
    return items;
  }, [visibleMessages, promptTurns]);

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Completed messages and header rendered once permanently via Static */}
      <Static items={staticItems}>
        {(item: StaticItem) => {
          if (item.type === 'header') {
            return (
              <Header
                key={item.id}
                model={sessionState.model}
                provider={sessionState.provider}
                cwd={sessionState.cwd}
                permissionMode={sessionState.permissionMode}
                totalTokens={totalTokens}
              />
            );
          }
          return (
            <MessageView
              key={item.id}
              message={item.message}
              previousPrompt={item.previousPrompt}
              turnIndex={item.turnIndex}
            />
          );
        }}
      </Static>

      {selectedTurn ? (
        <>
          <HistoryInspectionView
            turn={selectedTurn}
            totalTurns={promptTurns.length}
            onReturnToBottom={handleReturnToBottom}
            onSelectTurn={handleSelectTurn}
          />
          <ReturnToBottomBar
            onReturnToBottom={handleReturnToBottom}
            activeTurnIndex={selectedTurn.turnIndex}
          />
        </>
      ) : (
        <>
          <ToolProgressBlock
            currentToolName={currentToolName}
            progressText={progressText}
            isStreamingText={isBusy && !currentToolName}
          />

          <StatusLine
            model={sessionState.model}
            provider={sessionState.provider}
            cwd={sessionState.cwd}
            permissionMode={sessionState.permissionMode}
            totalInputTokens={sessionState.totalInputTokens}
            totalOutputTokens={sessionState.totalOutputTokens}
            contextTokens={contextTokens}
            totalCostUsd={sessionState.totalCostUsd}
            isBusy={isBusy}
          />

          {pendingPermission ? (
            <PermissionPrompt
              toolName={pendingPermission.toolName}
              args={pendingPermission.args}
              reason={pendingPermission.reason}
              onRespond={(approved, remember) => {
                pendingPermission.respond(approved, remember);
                setPendingPermission(null);
              }}
            />
          ) : (
            <InteractivePrompt
              onSubmit={handleUserSubmit}
              onAbort={handleAbort}
              onClearQueue={handleClearQueue}
              isBusy={isBusy}
              queuedPrompt={queuedPrompt}
              disabled={false}
              focus={!pendingPermission}
              availableCommands={commandRegistry.list()}
            />
          )}
        </>
      )}
    </Box>

  );
};
