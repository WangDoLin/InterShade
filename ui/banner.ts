/**
 * INTERSHADE terminal banner generator
 * Inspired by Oceanic Design System (ANSI Shadow FIGlet font with White/Light Sea Blue gradient).
 */

import { THEME } from './theme.js';

export const LOGO_ART = [
  '██╗███╗   ██╗████████╗███████╗██████╗     ███████╗██╗  ██╗ █████╗ ██████╗ ███████╗',
  '██║████╗  ██║╚══██╔══╝██╔════╝██╔══██╗    ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝',
  '██║██╔██╗ ██║   ██║   █████╗  ██████╔╝    ███████╗███████║███████║██║  ██║█████╗  ',
  '██║██║╚██╗██║   ██║   ██╔══╝  ██╔══██╗    ╚════██║██╔══██║██╔══██║██║  ██║██╔══╝  ',
  '██║██║ ╚████║   ██║   ███████╗██║  ██║    ███████║██║  ██║██║  ██║██████╔╝███████╗',
  '╚═╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝╚═╝  ╚═╝    ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ╚══════╝',
] as const;

export const LOGO_GRADIENT = [0, 0, 1, 1, 2, 2] as const;

export const WORD = 'INTERSHADE';
export const ART_WIDTH = Math.max(...LOGO_ART.map((l) => l.length)); // 79
export const INNER_WIDTH = ART_WIDTH + 4; // 83

export const WHITE = '\x1b[38;2;255;255;255m';
export const LIGHT_SEA = '\x1b[38;2;186;230;253m';
export const SEA_BLUE = '\x1b[38;2;56;189;248m';
export const DEEP_SEA = '\x1b[38;2;14;165;233m';
export const RESET = '\x1b[0m';
export const DIM_SEA = '\x1b[38;2;148;163;184m';

// Aliases for backwards-compatibility
export const GOLD = WHITE;
export const AMBER = LIGHT_SEA;
export const BRONZE = SEA_BLUE;
export const DIM = DIM_SEA;

export interface BannerRowChunks {
  leftPad: string;
  interText: string;
  shadeText: string;
  rightPad: string;
}

export function renderArt(useColor = true): string[] {
  const gradient = [WHITE, WHITE, LIGHT_SEA, LIGHT_SEA, SEA_BLUE, SEA_BLUE];
  return LOGO_ART.map((line, i) => {
    if (!useColor) return line;
    return `${gradient[i]}${line}${RESET}`;
  });
}

export function getBannerArtChunks(useColor = true): BannerRowChunks[] {
  const gradient = [WHITE, WHITE, LIGHT_SEA, LIGHT_SEA, SEA_BLUE, SEA_BLUE];
  const splitIndex = 42;
  const rows: BannerRowChunks[] = [];

  for (let i = 0; i < LOGO_ART.length; i++) {
    const line = LOGO_ART[i]!;
    const interPart = line.slice(0, splitIndex);
    const shadePart = line.slice(splitIndex);

    const interText = useColor ? `${gradient[i]}${interPart}${RESET}` : interPart;
    const shadeText = useColor ? `${gradient[i]}${shadePart}${RESET}` : shadePart;

    rows.push({
      leftPad: '  ',
      interText,
      shadeText,
      rightPad: '  ',
    });
  }

  return rows;
}

export function getBorderLine(): string {
  return '+' + '-'.repeat(INNER_WIDTH) + '+';
}

export function centerText(text: string, width: number = INNER_WIDTH): string {
  const slack = Math.max(0, width - text.length);
  const left = slack >> 1;
  const right = slack - left;
  return ' '.repeat(left) + text + ' '.repeat(right);
}

export const TAGLINE = 'WANG DO LIN  |  AGENTIC CODING';
export const TAGLINES = [THEME.brand.tagline1, THEME.brand.tagline2] as const;
