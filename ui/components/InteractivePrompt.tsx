import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { TerminalTextInput } from './TerminalTextInput.js';
import { t } from '../../services/i18n/index.js';
import type { SlashCommand } from '../../cli/commands/types.js';
import { CommandAutocomplete } from './CommandAutocomplete.js';
import { THEME } from '../theme.js';

export interface InteractivePromptProps {
  onSubmit: (value: string) => void;
  onAbort?: () => void;
  onClearQueue?: () => void;
  disabled?: boolean;
  isBusy?: boolean;
  queuedPrompt?: string | null;
  focus?: boolean;
  availableCommands?: SlashCommand[];
}

export const InteractivePrompt: React.FC<InteractivePromptProps> = ({
  onSubmit,
  onAbort,
  onClearQueue,
  disabled = false,
  isBusy = false,
  queuedPrompt = null,
  focus,
  availableCommands = [],
}) => {
  const [value, setValue] = useState('');

  const handleSubmit = (text: string) => {
    if (disabled || !text.trim()) return;
    const trimmed = text.trim();
    setValue('');
    onSubmit(trimmed);
  };

  // Up arrow: load queued prompt back into input for editing
  const handleUpArrow = () => {
    if (!value && queuedPrompt) {
      setValue(queuedPrompt);
      if (onClearQueue) {
        onClearQueue();
      }
    }
  };

  // Escape: delete queued prompt if input is empty, otherwise trigger onAbort
  const handleEscape = () => {
    if (!value && queuedPrompt && onClearQueue) {
      onClearQueue();
      return;
    }
    if (onAbort) {
      onAbort();
    }
  };

  const borderColor = queuedPrompt
    ? 'yellow'
    : isBusy
    ? 'cyan'
    : THEME.colors.border;

  return (
    <Box flexDirection="column" marginY={0}>
      {/* Autocomplete suggestion popup when user types '/' */}
      <CommandAutocomplete input={value} commands={availableCommands} />

      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={borderColor}
        paddingX={1}
        marginTop={0}
      >
        <Box flexDirection="row" alignItems="center">
          <Text bold color={isBusy ? 'cyan' : THEME.colors.accent}>
            {THEME.brand.promptSymbol}{' '}
          </Text>
          <TerminalTextInput
            value={value}
            onChange={setValue}
            onSubmit={handleSubmit}
            onAbort={onAbort}
            onEscape={handleEscape}
            onUpArrow={handleUpArrow}
            focus={focus !== undefined ? focus : !disabled}
            placeholder={
              isBusy
                ? queuedPrompt
                  ? t('prompt.queuedReplace')
                  : t('prompt.busyPlaceholder')
                : disabled
                ? t('prompt.submitting')
                : t('prompt.placeholder')
            }
          />
        </Box>

        {queuedPrompt && (
          <Box marginTop={0}>
            <Text color="yellow">
              [Queued next]: &quot;{queuedPrompt.length > 60 ? `${queuedPrompt.slice(0, 57)}...` : queuedPrompt}&quot;
            </Text>
          </Box>
        )}

        <Box marginTop={0}>
          <Text color={THEME.colors.muted}>
            {isBusy
              ? queuedPrompt
                ? '[Up Arrow] Edit queue │ [Esc] Delete queue │ [Enter] Replace │ [Ctrl+C] Stop agent'
                : '[Enter] Queue next │ [Esc / Ctrl+C] Stop agent │ [/help] Commands'
              : '[Enter] Submit │ [/help] Commands │ [/plan] Plan Mode │ [/model] Model │ [Ctrl+C] Exit'}
          </Text>
        </Box>
      </Box>
    </Box>
  );
};
