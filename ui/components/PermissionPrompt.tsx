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
  const argsFormatted = commandText ?? JSON.stringify(args, null, 2);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={THEME.colors.warn}
      paddingX={1}
      marginY={1}
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

      <Box flexDirection="column" marginY={1}>
        {commandText ? (
          <Box flexDirection="row">
            <Text bold color={THEME.colors.accent}>
              Command:
            </Text>
            <Text color={THEME.colors.text}> {commandText}</Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            <Text bold color={THEME.colors.accent}>
              Arguments:
            </Text>
            <Text color={THEME.colors.text}>{argsFormatted}</Text>
          </Box>
        )}

        <Box flexDirection="row" marginTop={1}>
          <Text bold color={THEME.colors.statusBad}>
            Reason:
          </Text>
          <Text color={THEME.colors.muted}> {reason}</Text>
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
