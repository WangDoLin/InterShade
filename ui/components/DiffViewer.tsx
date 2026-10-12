import React from 'react';
import { Box, Text } from 'ink';
import { THEME } from '../theme.js';

export interface DiffViewerProps {
  diff: string;
  maxLines?: number;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({ diff, maxLines = 30 }) => {
  if (!diff) return null;

  const lines = diff.split('\n');
  const displayLines = lines.slice(0, maxLines);
  const remaining = lines.length - maxLines;

  return (
    <Box
      flexDirection="column"
      marginY={1}
      paddingX={1}
      borderStyle="single"
      borderColor={THEME.colors.border}
    >
      <Text bold color={THEME.colors.accent}>
        Git Diff Preview:
      </Text>
      {displayLines.map((line, idx) => {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          return (
            <Text key={idx} color={THEME.colors.ok}>
              {line}
            </Text>
          );
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          return (
            <Text key={idx} color={THEME.colors.error}>
              {line}
            </Text>
          );
        } else if (line.startsWith('@@')) {
          return (
            <Text key={idx} color={THEME.colors.interCyan}>
              {line}
            </Text>
          );
        }
        return (
          <Text key={idx} color={THEME.colors.muted}>
            {line}
          </Text>
        );
      })}
      {remaining > 0 && (
        <Text color={THEME.colors.muted} italic>
          ... ({remaining} lines hidden)
        </Text>
      )}
    </Box>
  );
};
