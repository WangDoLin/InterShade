import React from 'react';
import { Box, Text } from 'ink';
import type { SlashCommand } from '../../cli/commands/types.js';
import { THEME } from '../theme.js';

export interface CommandAutocompleteProps {
  input: string;
  commands: SlashCommand[];
}

export const CommandAutocomplete: React.FC<CommandAutocompleteProps> = ({ input, commands }) => {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/') || trimmed.includes(' ')) {
    return null;
  }

  const query = trimmed.slice(1).toLowerCase();
  const matched = commands
    .filter((c) => {
      if (c.name.toLowerCase().startsWith(query)) return true;
      if (c.aliases?.some((a) => a.toLowerCase().startsWith(query))) return true;
      return false;
    })
    .slice(0, 3);

  if (matched.length === 0) {
    return null;
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={THEME.colors.border}
      paddingX={1}
      marginY={0}
    >
      <Text color={THEME.colors.muted}>
        Commands (matching &quot;/{query}&quot;):
      </Text>
      {matched.map((cmd) => (
        <Box key={cmd.name} gap={1}>
          <Text bold color={THEME.colors.accent}>
            /{cmd.name.padEnd(12)}
          </Text>
          <Text color={THEME.colors.text}>
            - {cmd.description}
          </Text>
        </Box>
      ))}
    </Box>
  );
};
