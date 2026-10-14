import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { TerminalTextInput } from './TerminalTextInput.js';
import { SwarmCoordinator } from '../../engine/swarm/SwarmCoordinator.js';
import type { SwarmRole } from '../../engine/swarm/SwarmTypes.js';
import { THEME } from '../theme.js';
import { t } from '../../services/i18n/index.js';

export interface PromptSlot {
  id: string;
  text: string;
  role: SwarmRole;
}

export interface MultiPromptDeckProps {
  onSubmitSingle: (prompt: string) => void;
  onSubmitSwarm: (prompts: Array<{ prompt: string; role: SwarmRole }>) => void;
  onAbort?: () => void;
  disabled?: boolean;
  isBusy?: boolean;
}

export const MultiPromptDeck: React.FC<MultiPromptDeckProps> = ({
  onSubmitSingle,
  onSubmitSwarm,
  onAbort,
  disabled = false,
  isBusy = false,
}) => {
  const [slots, setSlots] = useState<PromptSlot[]>([
    { id: 'slot-1', text: '', role: 'general' },
  ]);
  const [activeSlotIndex, setActiveSlotIndex] = useState(0);

  // Keyboard shortcut listener for multi-slot deck navigation
  useInput(
    (input, key) => {
      if (disabled || isBusy) return;

      // Ctrl+N (ASCII 14 / '\x0e'): Add a new session prompt slot!
      if (input === '\x0e') {
        setSlots((prev) => {
          if (prev.length >= 5) return prev; // max 5 concurrent session slots
          const newId = `slot-${Date.now().toString(36).slice(-4)}`;
          const next: PromptSlot[] = [...prev, { id: newId, text: '', role: 'general' }];
          setActiveSlotIndex(next.length - 1);
          return next;
        });
        return;
      }

      // Tab: Switch focus to next slot
      if (key.tab) {
        setSlots((prev) => {
          if (prev.length <= 1) return prev;
          setActiveSlotIndex((idx) => (idx + 1) % prev.length);
          return prev;
        });
        return;
      }

      // Escape: Close extra slot if empty
      if (key.escape) {
        if (slots.length > 1 && !slots[activeSlotIndex]?.text) {
          setSlots((prev) => {
            const next = prev.filter((_, i) => i !== activeSlotIndex);
            setActiveSlotIndex(Math.max(0, activeSlotIndex - 1));
            return next;
          });
        } else if (onAbort) {
          onAbort();
        }
      }
    },
    { isActive: !disabled && !isBusy }
  );

  const handleSlotChange = (newText: string, index: number) => {
    setSlots((prev) => {
      const next = [...prev];
      const inferred = SwarmCoordinator.inferRoleAndScope(newText);
      next[index] = {
        ...next[index],
        text: newText,
        role: inferred.role,
      };
      return next;
    });
  };

  const handleSlotSubmit = (submittedText: string, index: number) => {
    if (disabled || isBusy) return;

    // Check if there are other slots with content
    const updatedSlots = slots.map((s, i) => (i === index ? { ...s, text: submittedText } : s));
    const validSlots = updatedSlots.filter((s) => s.text.trim().length > 0);

    if (validSlots.length > 1) {
      // Multi-session swarm submission!
      onSubmitSwarm(
        validSlots.map((s) => ({
          prompt: s.text.trim(),
          role: s.role,
        }))
      );
      // Reset slots
      setSlots([{ id: 'slot-1', text: '', role: 'general' }]);
      setActiveSlotIndex(0);
    } else if (validSlots.length === 1) {
      // Single prompt submission
      onSubmitSingle(validSlots[0].text.trim());
      setSlots([{ id: 'slot-1', text: '', role: 'general' }]);
      setActiveSlotIndex(0);
    }
  };

  const getRoleBadge = (role: SwarmRole) => {
    switch (role) {
      case 'backend':
        return { icon: '⚙️', color: 'blue', label: 'Backend' };
      case 'frontend':
        return { icon: '🎨', color: 'magenta', label: 'Frontend' };
      case 'architect':
        return { icon: '🏗️', color: 'yellow', label: 'Architect' };
      case 'tester':
        return { icon: '🧪', color: 'green', label: 'Tester' };
      case 'reviewer':
        return { icon: '🔍', color: 'cyan', label: 'Reviewer' };
      default:
        return { icon: '🤖', color: 'white', label: 'General' };
    }
  };

  return (
    <Box flexDirection="column" marginY={0}>
      {slots.map((slot, index) => {
        const isFocused = index === activeSlotIndex;
        const badge = getRoleBadge(slot.role);
        const borderColor = isBusy
          ? 'cyan'
          : isFocused
          ? THEME.colors.accent
          : 'gray';

        return (
          <Box
            key={slot.id}
            flexDirection="column"
            borderStyle="round"
            borderColor={borderColor}
            paddingX={1}
            marginBottom={slots.length > 1 ? 1 : 0}
          >
            {/* Header when multiple slots are active */}
            {slots.length > 1 && (
              <Box flexDirection="row" justifyContent="space-between" marginBottom={0}>
                <Text bold color={badge.color as any}>
                  {badge.icon} [Session #{index + 1} - Role: {badge.label}]
                  {isFocused ? ' (Active Input)' : ''}
                </Text>
                <Text color="gray">
                  Slot {index + 1}/{slots.length}
                </Text>
              </Box>
            )}

            <Box flexDirection="row" alignItems="center">
              <Text bold color={isFocused ? THEME.colors.accent : 'gray'}>
                {THEME.brand.promptSymbol}{' '}
              </Text>
              <TerminalTextInput
                value={slot.text}
                onChange={(txt) => handleSlotChange(txt, index)}
                onSubmit={(txt) => handleSlotSubmit(txt, index)}
                onAbort={onAbort}
                focus={isFocused && !disabled && !isBusy}
                placeholder={
                  isBusy
                    ? t('prompt.busyPlaceholder')
                    : slots.length > 1
                    ? `Nhập prompt cho Session #${index + 1} (${badge.label})...`
                    : t('prompt.placeholder')
                }
              />
            </Box>
          </Box>
        );
      })}

      {/* Helper toolbar for multi-session navigation */}
      <Box flexDirection="row" justifyContent="space-between" paddingX={1} marginTop={0}>
        <Text color="gray">
          [Ctrl+N] Thêm session prompt | [Tab] Chuyển khung | [Enter] Thực thi song song
        </Text>
        {slots.length > 1 && (
          <Text color="yellow">Đang có {slots.length} session trong deck</Text>
        )}
      </Box>
    </Box>
  );
};
