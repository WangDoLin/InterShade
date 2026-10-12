import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Box, Static, useApp } from 'ink';
import { randomUUID } from 'crypto';
import { Header } from './components/Header.js';
import { StatusLine } from './components/StatusLine.js';
import { MessageView } from './components/MessageView.js';
import { ToolProgressBlock } from './components/ToolProgressBlock.js';
import { InteractivePrompt } from './components/InteractivePrompt.js';
import { PermissionPrompt } from './components/PermissionPrompt.js';
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

  const isBusyRef = useRef(isBusy);
  isBusyRef.current = isBusy;
  const queuedPromptRef = useRef<string | null>(null);
  const handleUserSubmitRef = useRef<(p: string) => Promise<void>>(async () => {});

  const handleAbort = useCallback(() => {
    if (isBusyRef.current) {
      if (queuedPromptRef.current) {
        queuedPromptRef.current = null;
        setQueuedPrompt(null);
      }
      queryEngine.abort();
    } else {
      exit();
    }
  }, [queryEngine, exit]);

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
    // Listen to QueryEngine events
    const handleText = () => {
      setMessages([...queryEngine.getMessages()]);
      setContextTokens(queryEngine.getContextTokens());
    };

    const handleToolStart = (name: string) => {
      setCurrentToolName(name);
      setProgressText(null);
      setMessages([...queryEngine.getMessages()]);
      setContextTokens(queryEngine.getContextTokens());
    };

    const handleToolProgress = (progress: string) => {
      setProgressText(progress);
    };

    const handleToolDone = () => {
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
      const currentMode = sessionState.permissionMode;
      const nextMode = currentMode === 'plan' && !targetPath ? 'default' : 'plan';
      queryEngine.setPermissionMode(nextMode);

      let noticeText = nextMode === 'plan' ? t('slash.planModeOn') : t('slash.planModeOff');
      if (targetPath) {
        noticeText += `\nTarget Scope: ${targetPath}\nReady for planning. Describe what features or fixes you want to investigate.`;
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
          '  /plan        - Toggle Plan Mode (Read-Only)',
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
    | { type: 'message'; id: string; message: UnifiedMessage };

  // All conversation messages in visibleMessages are completed turns.
  // Rendering them directly via <Static> guarantees they are printed once in full to stdout,
  // scroll naturally without truncation, and never overflow the dynamic terminal area.
  const staticItems: StaticItem[] = useMemo(() => {
    const items: StaticItem[] = [{ type: 'header', id: 'session-header' }];
    for (const msg of visibleMessages) {
      items.push({ type: 'message', id: msg.id, message: msg });
    }
    return items;
  }, [visibleMessages]);

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
          return <MessageView key={item.id} message={item.message} />;
        }}
      </Static>

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
    </Box>
  );
};
