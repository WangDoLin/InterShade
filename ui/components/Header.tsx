import React from 'react';
import { Box, Text } from 'ink';
import { t, i18n } from '../../services/i18n/index.js';
import { THEME } from '../theme.js';
import {
  getBannerArtChunks,
  getBorderLine,
  centerText,
  INNER_WIDTH,
  TAGLINE,
} from '../banner.js';

export interface HeaderProps {
  model: string;
  provider: string;
  cwd: string;
  permissionMode: string;
  totalTokens: number;
}

export const Header: React.FC<HeaderProps> = ({
  model,
  provider,
  cwd,
  permissionMode,
  totalTokens,
}) => {
  const currentLang = i18n.getLocale().toUpperCase();
  const artChunks = getBannerArtChunks();
  const borderLine = getBorderLine();

  const isPlanMode = permissionMode === 'plan';

  return (
    <Box flexDirection="column" marginY={1}>
      {/* ── INTERSHADE Terminal Banner ── */}
      <Box flexDirection="column">
        {/* Top border */}
        <Text color={THEME.colors.border}>{borderLine}</Text>

        {/* 6 Art rows */}
        {artChunks.map((chunk, idx) => (
          <Box key={`art-${idx}`} flexDirection="row">
            <Text color={THEME.colors.border}>|</Text>
            <Text>{chunk.leftPad}</Text>
            <Text>{chunk.interText}</Text>
            <Text>{chunk.shadeText}</Text>
            <Text>{chunk.rightPad}</Text>
            <Text color={THEME.colors.border}>|</Text>
          </Box>
        ))}

        {/* Blank separator row */}
        <Box flexDirection="row">
          <Text color={THEME.colors.border}>|</Text>
          <Text>{' '.repeat(INNER_WIDTH)}</Text>
          <Text color={THEME.colors.border}>|</Text>
        </Box>

        {/* Tagline: WANG DO LIN | AGENTIC CODING */}
        <Box flexDirection="row">
          <Text color={THEME.colors.border}>|</Text>
          <Text bold color={THEME.colors.primary}>
            {centerText(TAGLINE)}
          </Text>
          <Text color={THEME.colors.border}>|</Text>
        </Box>

        {/* Bottom border */}
        <Text color={THEME.colors.border}>{borderLine}</Text>
      </Box>

      {/* ── InterShader Session Info Strip ── */}
      <Box
        flexDirection="column"
        marginTop={1}
        paddingX={1}
        borderStyle="single"
        borderColor={THEME.colors.border}
      >
        <Box justifyContent="space-between">
          <Box gap={1}>
            <Text bold color={THEME.colors.primary}>
              {model}
            </Text>
            <Text color={THEME.colors.muted}>({provider})</Text>
            <Text color={THEME.colors.border}>|</Text>
            <Text bold color={isPlanMode ? THEME.colors.warn : THEME.colors.ok}>
              [{isPlanMode ? t('header.planMode') : 'DEFAULT'}]
            </Text>
          </Box>

          <Box gap={1}>
            <Text color={THEME.colors.accent}>
              {t('header.tokens')}: <Text bold color={THEME.colors.text}>{totalTokens.toLocaleString()}</Text>
            </Text>
            <Text color={THEME.colors.border}>|</Text>
            <Text color={THEME.colors.muted}>
              {t('header.lang')}: <Text bold color={THEME.colors.text}>{currentLang}</Text>
            </Text>
          </Box>
        </Box>

        <Box marginTop={0}>
          <Text color={THEME.colors.muted}>
            CWD: <Text color={THEME.colors.text}>{cwd}</Text>
          </Text>
        </Box>
      </Box>
    </Box>
  );
};
