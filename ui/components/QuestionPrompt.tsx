import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { THEME } from '../theme.js';

export interface QuestionPromptProps {
  question: string;
  options?: string[];
  allowCustomInput?: boolean;
  onRespond: (answer: string) => void;
}

export const QuestionPrompt: React.FC<QuestionPromptProps> = ({
  question,
  options = [],
  allowCustomInput = true,
  onRespond,
}) => {
  const hasOptions = options.length > 0;
  const customOptionIndex = hasOptions ? options.length : 0;
  const totalItems = hasOptions ? (allowCustomInput ? options.length + 1 : options.length) : 1;

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isTyping, setIsTyping] = useState(!hasOptions);
  const [customText, setCustomText] = useState('');

  useInput(
    (input, key) => {
      if (isTyping) {
        if (key.return) {
          onRespond(customText.trim() || (hasOptions && options[selectedIndex] ? options[selectedIndex] : 'Yes'));
          return;
        }
        if (key.escape) {
          if (hasOptions) {
            setIsTyping(false);
          } else {
            onRespond('');
          }
          return;
        }
        if (key.backspace || key.delete) {
          setCustomText((prev) => prev.slice(0, -1));
          return;
        }
        if (!key.ctrl && !key.meta && input) {
          setCustomText((prev) => prev + input);
        }
        return;
      }

      // Selection mode with options
      if (key.upArrow) {
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : totalItems - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedIndex((prev) => (prev < totalItems - 1 ? prev + 1 : 0));
        return;
      }

      // Number key shortcuts (1..9)
      if (/^[1-9]$/.test(input)) {
        const num = parseInt(input, 10);
        if (num <= options.length) {
          onRespond(options[num - 1]);
          return;
        }
      }

      if (key.return) {
        if (hasOptions && selectedIndex < options.length) {
          onRespond(options[selectedIndex]);
        } else {
          setIsTyping(true);
        }
        return;
      }

      if (key.escape) {
        onRespond('');
      }
    },
    { isActive: true }
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={THEME.colors.primary}
      paddingX={1}
      marginY={1}
    >
      {/* Header */}
      <Box flexDirection="row" gap={1} marginBottom={1}>
        <Text bold color={THEME.colors.primary}>
          ? CLARIFICATION REQUIRED
        </Text>
        <Text color={THEME.colors.muted}>
          (Modeled after Claude Code AskUserQuestion)
        </Text>
      </Box>

      {/* Question */}
      <Box marginBottom={1}>
        <Text bold color={THEME.colors.text}>
          {question}
        </Text>
      </Box>

      {/* Options List */}
      {hasOptions && (
        <Box flexDirection="column" gap={0} marginBottom={1}>
          {options.map((opt, idx) => {
            const isSelected = selectedIndex === idx && !isTyping;
            return (
              <Box key={idx} flexDirection="row" gap={1}>
                <Text color={isSelected ? THEME.colors.primary : THEME.colors.muted}>
                  {isSelected ? '❯' : ' '} [{idx + 1}]
                </Text>
                <Text
                  bold={isSelected}
                  color={isSelected ? THEME.colors.interCyan : THEME.colors.text}
                >
                  {opt}
                </Text>
              </Box>
            );
          })}

          {allowCustomInput && (
            <Box flexDirection="row" gap={1}>
              <Text
                color={
                  selectedIndex === customOptionIndex && !isTyping
                    ? THEME.colors.primary
                    : THEME.colors.muted
                }
              >
                {selectedIndex === customOptionIndex && !isTyping ? '❯' : ' '} [*]
              </Text>
              <Text
                bold={selectedIndex === customOptionIndex}
                color={
                  selectedIndex === customOptionIndex
                    ? THEME.colors.accent
                    : THEME.colors.muted
                }
              >
                Write custom response...
              </Text>
            </Box>
          )}
        </Box>
      )}

      {/* Custom Text Input Box */}
      {isTyping && (
        <Box flexDirection="row" gap={1} marginTop={0}>
          <Text bold color={THEME.colors.primary}>
            ✍ Your Answer:
          </Text>
          <Text color={THEME.colors.text}>{customText}</Text>
          <Text color={THEME.colors.accent}>▋</Text>
        </Box>
      )}

      {/* Navigation Footer */}
      <Box marginTop={1}>
        <Text color={THEME.colors.muted}>
          {isTyping
            ? 'Press Enter to submit answer | Esc to back'
            : 'Use ↑/↓ arrows or 1..9 to select | Enter to confirm'}
        </Text>
      </Box>
    </Box>
  );
};
