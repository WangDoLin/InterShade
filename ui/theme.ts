/**
 * Oceanic Theme Tokens for InterShader TUI
 * Inspired by Marine & Sea Glass Design System (White, Light Sea Blue, Aqua & Deep Navy)
 */

export interface ThemeColors {
  primary: string;
  accent: string;
  border: string;
  text: string;
  muted: string;
  interCyan: string;
  shadeWhite: string;
  surface: string;
  bg: string;
  ok: string;
  warn: string;
  error: string;
  statusGood: string;
  statusWarn: string;
  statusBad: string;
}

export interface ThemeBrand {
  name: string;
  tagline1: string;
  tagline2: string;
  promptSymbol: string;
  toolSymbol: string;
}

export interface InterShaderTheme {
  colors: ThemeColors;
  brand: ThemeBrand;
}

export const THEME: InterShaderTheme = {
  colors: {
    primary: '#38BDF8',       // Light Sea Blue / Sky Cyan
    accent: '#7DD3FC',        // Pale Sea Aqua
    border: '#0284C7',        // Ocean Blue
    text: '#FFFFFF',          // Crisp Pure White
    muted: '#94A3B8',         // Cool Sea Mist / Slate
    interCyan: '#BAE6FD',     // Ice Sea Foam for "INTER"
    shadeWhite: '#FFFFFF',    // Crisp White for "SHADE"
    surface: '#0F172A',       // Abyssal Ocean Navy
    bg: '#030712',            // Deep Ocean Night
    ok: '#34D399',            // Seafoam Mint
    warn: '#FBBF24',          // Sunlight Amber
    error: '#F87171',         // Coral Red
    statusGood: '#6EE7B7',    // Aquamarine Mint
    statusWarn: '#38BDF8',    // Light Sea Blue
    statusBad: '#FB7185',     // Sea Coral
  },
  brand: {
    name: 'InterShader',
    tagline1: 'Wang Do Lin',
    tagline2: 'Agentic Coding',
    promptSymbol: '❯',
    toolSymbol: '┊',
  },
};
