import React from 'react';
import { Box, Text } from 'ink';
import type { UnifiedMessage } from '../../types/index.js';
import { DiffViewer } from './DiffViewer.js';
import { THEME } from '../theme.js';

export interface MessageViewProps {
  message: UnifiedMessage;
}

export const MessageView: React.FC<MessageViewProps> = ({ message }) => {
  if (message.role === 'system') {
    return null;
  }

  if (message.role === 'user') {
    return (
      <Box flexDirection="column" marginY={0} paddingBottom={1}>
        <Text bold color={THEME.colors.accent}>
          {THEME.brand.promptSymbol} You:
        </Text>
        <Box paddingLeft={2}>
          <Text color={THEME.colors.text}>{message.content}</Text>
        </Box>
      </Box>
    );
  }

  if (message.role === 'assistant') {
    const isError =
      message.content.startsWith('[Error]') ||
      message.content.startsWith('[Provider Error]') ||
      message.content.startsWith('[Quota Exceeded') ||
      message.content.startsWith('[Model Unavailable') ||
      message.content.startsWith('[Authentication');

    return (
      <Box flexDirection="column" marginY={0} paddingBottom={1}>
        <Text bold color={isError ? THEME.colors.error : THEME.colors.primary}>
          {THEME.brand.toolSymbol} {THEME.brand.name}:
        </Text>

        {message.thought && (
          <Box paddingLeft={2} marginY={0} flexDirection="column">
            <Text color={THEME.colors.muted} italic>
              │ [Thought]: {message.thought.replace(/\s+/g, ' ').trim().slice(0, 300)}...
            </Text>
          </Box>
        )}

        <Box paddingLeft={2}>
          <Text color={isError ? THEME.colors.error : THEME.colors.text}>{message.content}</Text>
        </Box>
      </Box>
    );
  }

  if (message.role === 'tool' && message.toolResult) {
    const isError = message.toolResult.isError;
    const statusTag = isError ? '[FAIL]' : '[OK]';
    const statusColor = isError ? THEME.colors.error : THEME.colors.ok;
    let parsedDiff: string | null = null;

    try {
      if (message.toolResult.content.startsWith('{')) {
        const parsed = JSON.parse(message.toolResult.content);
        if (parsed.diff) parsedDiff = parsed.diff;
      }
    } catch {
      // not json format
    }

    return (
      <Box flexDirection="column" marginY={0} paddingLeft={2}>
        <Box flexDirection="row">
          <Text color={THEME.colors.muted}>├─ </Text>
          <Text bold color={statusColor}>
            {statusTag}
          </Text>
          <Text color={THEME.colors.muted}>
            {' '}Tool [{message.toolResult.toolName}]
          </Text>
        </Box>

        {parsedDiff ? (
          <Box paddingLeft={2}>
            <DiffViewer diff={parsedDiff} />
          </Box>
        ) : (
          <Box paddingLeft={3}>
            <Text color={THEME.colors.muted}>
              └─ {message.toolResult.content.length > 250
                ? `${message.toolResult.content.slice(0, 250)}... [truncated]`
                : message.toolResult.content}
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  return null;
};
