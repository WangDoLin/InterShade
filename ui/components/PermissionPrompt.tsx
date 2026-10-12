import React from 'react';
import { Box, Text, useInput } from 'ink';
import { THEME } from '../theme.js';

export interface PermissionPromptProps {
  toolName: string;
  args: Record<string, unknown>;
  reason: string;
  onRespond: (approved: boolean, remember?: boolean) => void;
}

export const PermissionPrompt: React.FC<PermissionPromptProps> = ({
  toolName,
  args,
  reason,
  onRespond,
}) => {
  useInput(
    (input, key) => {
      const lower = input.toLowerCase();
      if (lower === 'y' || key.return) {
        onRespond(true, false);
      } else if (lower === 'n' || key.escape) {
        onRespond(false, false);
      } else if (lower === 'a') {
        onRespond(true, true);
      }
    },
    { isActive: true }
  );

  const commandText = typeof args.command === 'string' ? args.command : null;

  // Compact, bounded argument formatting to guarantee PermissionPrompt never overflows terminal rows
  const renderArguments = () => {
    if (commandText) {
      const cleanCmd = commandText.trim();
      const lines = cleanCmd.split('\n');
      const preview = lines.slice(0, 2).join('\n');
      const more = lines.length > 2 ? ` ... (+${lines.length - 2} lines)` : '';
      return (
        <Box flexDirection="row">
          <Text bold color={THEME.colors.accent}>
            Command:
          </Text>
          <Text color={THEME.colors.text}> {preview.length > 120 ? `${preview.slice(0, 117)}...` : preview}{more}</Text>
        </Box>
      );
    }

    const filePath = (args.filePath || args.path || args.file) as string | undefined;
    const content = (args.content || args.file_content || args.patch) as string | undefined;

    if (filePath && content !== undefined) {
      const contentStr = String(content);
      const contentLines = contentStr.split('\n');
      const previewSnippet = contentLines.slice(0, 2).join('\n');
      return (
        <Box flexDirection="column">
          <Text color={THEME.colors.text}>
            <Text bold color={THEME.colors.accent}>File: </Text>
            {filePath} ({contentLines.length} line(s), {contentStr.length} chars)
          </Text>
          <Text color={THEME.colors.muted}>
            {previewSnippet}
            {contentLines.length > 2 ? `\n... (+${contentLines.length - 2} lines hidden)` : ''}
          </Text>
        </Box>
      );
    }

    // Generic argument sanitizer: truncate massive strings to short summaries
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) {
      if (typeof v === 'string') {
        if (v.length > 80 || v.includes('\n')) {
          sanitized[k] = `${v.slice(0, 60).replace(/\s+/g, ' ')}... (${v.length} chars)`;
        } else {
          sanitized[k] = v;
        }
      } else {
        sanitized[k] = v;
      }
    }

    const jsonLines = JSON.stringify(sanitized, null, 2).split('\n');
    const displayLines = jsonLines.slice(0, 4);
    const hiddenCount = jsonLines.length - 4;

    return (
      <Box flexDirection="column">
        <Text bold color={THEME.colors.accent}>
          Arguments:
        </Text>
        <Text color={THEME.colors.text}>
          {displayLines.join('\n')}
          {hiddenCount > 0 ? `\n... (+${hiddenCount} lines hidden)` : ''}
        </Text>
      </Box>
    );
  };

  const cleanReason = reason.replace(/\s+/g, ' ').slice(0, 100);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={THEME.colors.warn}
      paddingX={1}
      marginY={0}
    >
      <Box flexDirection="row" alignItems="center">
        <Text bold color={THEME.colors.warn}>
          [PERMISSION REQUIRED]
        </Text>
        <Text color={THEME.colors.muted}> Tool: </Text>
        <Text bold color={THEME.colors.text}>
          {toolName}
        </Text>
      </Box>

      <Box flexDirection="column" marginY={0}>
        {renderArguments()}

        <Box flexDirection="row" marginTop={0}>
          <Text bold color={THEME.colors.statusBad}>
            Reason:
          </Text>
          <Text color={THEME.colors.muted}> {cleanReason}</Text>
        </Box>
      </Box>

      <Box flexDirection="row" marginTop={0}>
        <Text bold color={THEME.colors.ok}>
          [Y] Allow once
        </Text>
        <Text color={THEME.colors.muted}> │ </Text>
        <Text bold color={THEME.colors.error}>
          [N] Deny
        </Text>
        <Text color={THEME.colors.muted}> │ </Text>
        <Text bold color={THEME.colors.accent}>
          [A] Always allow in session
        </Text>
      </Box>
    </Box>
  );
};
