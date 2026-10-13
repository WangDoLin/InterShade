import React, { useEffect } from 'react';
import { Box, Text } from 'ink';
import { TerminalMouseManager } from '../services/TerminalMouseManager.js';
import { THEME } from '../theme.js';
import { t } from '../../services/i18n/index.js';

export interface ReturnToBottomBarProps {
  onReturnToBottom: () => void;
  activeTurnIndex?: number;
}

/**
 * ReturnToBottomBar provides an interactive return button at the bottom
 * of the terminal viewport to return from inspection mode to live working mode.
 */
export const ReturnToBottomBar: React.FC<ReturnToBottomBarProps> = ({
  onReturnToBottom,
  activeTurnIndex,
}) => {
  useEffect(() => {
    const mouseMgr = TerminalMouseManager.getInstance();
    const zoneId = 'return-to-bottom-bar';
    const termRows = process.stdout.rows || 24;
    const termCols = process.stdout.columns || 80;

    // Register bottom area as clickable target
    mouseMgr.registerZone({
      id: zoneId,
      minCol: 1,
      maxCol: termCols,
      minRow: Math.max(1, termRows - 3),
      maxRow: termRows,
      onClick: () => onReturnToBottom(),
    });

    return () => {
      mouseMgr.unregisterZone(zoneId);
    };
  }, [onReturnToBottom]);

  const defaultLabel = '▼ Return to Latest [Esc / B / Enter]';
  const label = t('promptHistory.returnToBottom') || defaultLabel;

  return (
    <Box
      flexDirection="row"
      justifyContent="center"
      alignItems="center"
      borderStyle="round"
      borderColor={THEME.colors.primary}
      paddingX={2}
      marginY={1}
    >
      <Text bold color={THEME.colors.primary}>
        {label}
      </Text>
      {activeTurnIndex !== undefined && (
        <Text color={THEME.colors.muted}>
          {' '}(Currently inspecting Turn #{activeTurnIndex})
        </Text>
      )}
    </Box>
  );
};
