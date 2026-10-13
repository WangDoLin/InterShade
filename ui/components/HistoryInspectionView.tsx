import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { PromptTurnEntry } from '../../types/index.js';
import { MessageView } from './MessageView.js';
import { truncatePromptText } from '../utils/turnExtractor.js';
import { THEME } from '../theme.js';

export interface HistoryInspectionViewProps {
  turn: PromptTurnEntry;
  totalTurns: number;
  onReturnToBottom: () => void;
  onSelectTurn: (turnIndex: number) => void;
}

const MAX_VISIBLE_MESSAGES = 10;

/**
 * Renders the top banner bar for the inspection viewport.
 */
const InspectionHeader: React.FC<{
  turnIndex: number;
  totalTurns: number;
  promptText: string;
}> = ({ turnIndex, totalTurns, promptText }) => {
  const shortTitle = truncatePromptText(promptText, 35);

  return (
    <Box
      flexDirection="row"
      justifyContent="space-between"
      borderStyle="single"
      borderColor={THEME.colors.warn}
      paddingX={1}
      marginBottom={1}
    >
      <Text bold color={THEME.colors.warn}>
        [INSPECTION MODE: Turn #{turnIndex} / {totalTurns} - &quot;{shortTitle}&quot;]
      </Text>
      <Text color={THEME.colors.muted}>
        [← / →] Switch Turn │ [Esc / B] Return
      </Text>
    </Box>
  );
};

/**
 * Scrollable viewport displaying full execution context of a past turn.
 */
export const HistoryInspectionView: React.FC<HistoryInspectionViewProps> = ({
  turn,
  totalTurns,
  onReturnToBottom,
  onSelectTurn,
}) => {
  const [scrollOffset, setScrollOffset] = useState(0);

  useInput((input, key) => {
    // Return to bottom on Escape, 'b', 'B', or Enter
    if (key.escape || input === 'b' || input === 'B' || key.return) {
      onReturnToBottom();
      return;
    }

    // Previous turn
    if (key.leftArrow && turn.turnIndex > 1) {
      setScrollOffset(0);
      onSelectTurn(turn.turnIndex - 1);
      return;
    }

    // Next turn
    if (key.rightArrow && turn.turnIndex < totalTurns) {
      setScrollOffset(0);
      onSelectTurn(turn.turnIndex + 1);
      return;
    }

    // Scrolling inside long turn message lists
    if (key.upArrow && scrollOffset > 0) {
      setScrollOffset((prev) => Math.max(0, prev - 1));
    }
    if (key.downArrow && scrollOffset + MAX_VISIBLE_MESSAGES < turn.messages.length) {
      setScrollOffset((prev) => prev + 1);
    }
  });

  const visibleMessages = turn.messages.slice(
    scrollOffset,
    scrollOffset + MAX_VISIBLE_MESSAGES
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={THEME.colors.warn}
      padding={1}
      marginY={1}
    >
      <InspectionHeader
        turnIndex={turn.turnIndex}
        totalTurns={totalTurns}
        promptText={turn.promptText}
      />

      <Box flexDirection="column">
        {visibleMessages.map((msg) => (
          <MessageView key={msg.id} message={msg} />
        ))}
      </Box>

      {turn.messages.length > MAX_VISIBLE_MESSAGES && (
        <Box marginTop={1} justifyContent="center">
          <Text color={THEME.colors.muted}>
            (Showing {scrollOffset + 1}-{Math.min(turn.messages.length, scrollOffset + MAX_VISIBLE_MESSAGES)} of {turn.messages.length} items. Use Up/Down arrows to scroll)
          </Text>
        </Box>
      )}
    </Box>
  );
};
