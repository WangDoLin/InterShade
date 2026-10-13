import React, { useEffect, useMemo } from 'react';
import { Box, Text } from 'ink';
import type { PromptTurnEntry } from '../../types/index.js';
import { truncatePromptText } from '../utils/turnExtractor.js';
import { TerminalMouseManager } from '../services/TerminalMouseManager.js';
import { THEME } from '../theme.js';
import { t } from '../../services/i18n/index.js';

export interface PromptHistoryBarProps {
  turns: PromptTurnEntry[];
  selectedTurnIndex: number | null;
  onSelectTurn: (turnIndex: number) => void;
  onReturnToBottom?: () => void;
}

const MAX_VISIBLE_TURNS = 5;

/**
 * PromptHistoryBar renders a horizontal row of previous user prompt pills
 * at the top of the CLI interface with click detection and status badges.
 */
export const PromptHistoryBar: React.FC<PromptHistoryBarProps> = ({
  turns,
  selectedTurnIndex,
  onSelectTurn,
  onReturnToBottom,
}) => {
  // If there are many turns, display the most recent turns to fit terminal width
  const visibleTurns = useMemo(() => {
    if (turns.length <= MAX_VISIBLE_TURNS) {
      return turns;
    }
    return turns.slice(turns.length - MAX_VISIBLE_TURNS);
  }, [turns]);

  const hasHiddenPreceding = turns.length > MAX_VISIBLE_TURNS;

  // Register mouse click zones with TerminalMouseManager
  useEffect(() => {
    const mouseMgr = TerminalMouseManager.getInstance();

    // Register each visible turn's approximate column zone
    let colCursor = 18; // Offset after "PROMPT HISTORY: "
    visibleTurns.forEach((turn) => {
      const label = `[#${turn.turnIndex}: ${truncatePromptText(turn.promptText, 16)}]`;
      const zoneId = `prompt-pill-${turn.turnIndex}`;
      const minCol = colCursor;
      const maxCol = colCursor + label.length + 1;

      mouseMgr.registerZone({
        id: zoneId,
        minCol,
        maxCol,
        minRow: 1,
        maxRow: 3,
        onClick: () => onSelectTurn(turn.turnIndex),
      });

      colCursor = maxCol + 1;
    });

    // Cleanup hitboxes on unmount or re-render
    return () => {
      visibleTurns.forEach((turn) => {
        mouseMgr.unregisterZone(`prompt-pill-${turn.turnIndex}`);
      });
    };
  }, [visibleTurns, onSelectTurn]);

  if (turns.length === 0) {
    return (
      <Box flexDirection="row" paddingX={1} marginY={0} borderStyle="single" borderColor={THEME.colors.border}>
        <Text bold color={THEME.colors.primary}>
          {t('promptHistory.title') || 'PROMPT HISTORY'}:{' '}
        </Text>
        <Text color={THEME.colors.muted}>
          {t('promptHistory.empty') || '(No previous prompts yet)'}
        </Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="row"
      alignItems="center"
      justifyContent="space-between"
      paddingX={1}
      marginY={0}
      borderStyle="single"
      borderColor={selectedTurnIndex !== null ? THEME.colors.warn : THEME.colors.border}
    >
      <Box flexDirection="row" gap={1} alignItems="center">
        <Text bold color={THEME.colors.primary}>
          {t('promptHistory.title') || 'PROMPT HISTORY'}:
        </Text>

        {hasHiddenPreceding && (
          <Text color={THEME.colors.muted}>« +{turns.length - MAX_VISIBLE_TURNS} more </Text>
        )}

        {visibleTurns.map((turn) => {
          const isSelected = selectedTurnIndex === turn.turnIndex;
          const isLatest = turn.turnIndex === turns.length;
          const pillText = `[#${turn.turnIndex}: ${truncatePromptText(turn.promptText, 16)}]`;

          if (isSelected) {
            return (
              <Text key={`turn-pill-${turn.turnIndex}`} bold color={THEME.colors.warn} backgroundColor="black">
                {pillText}*
              </Text>
            );
          }

          if (isLatest && selectedTurnIndex === null) {
            return (
              <Text key={`turn-pill-${turn.turnIndex}`} bold color={THEME.colors.ok}>
                {pillText}
              </Text>
            );
          }

          return (
            <Text key={`turn-pill-${turn.turnIndex}`} color={THEME.colors.accent}>
              {pillText}
            </Text>
          );
        })}

        {selectedTurnIndex === null && (
          <Text color={THEME.colors.ok}>({t('promptHistory.active') || 'Active'})</Text>
        )}
      </Box>

      <Box flexDirection="row" gap={1}>
        <Text color={THEME.colors.muted}>
          {selectedTurnIndex !== null
            ? '[Esc / B] Return to Bottom'
            : '[Alt+1..9] Jump to Turn'}
        </Text>
      </Box>
    </Box>
  );
};
