import type React from 'react';

export type CommandType = 'prompt' | 'local' | 'local-jsx';

export interface CommandContext {
  cwd: string;
  sessionState: Record<string, unknown>;
  args: string[];
}

export interface PromptCommand {
  name: string;
  description: string;
  type: 'prompt';
  aliases?: string[];
  getPrompt(ctx: CommandContext): Promise<string> | string;
}

export interface LocalCommand {
  name: string;
  description: string;
  type: 'local';
  aliases?: string[];
  execute(ctx: CommandContext): Promise<string> | string;
}

export interface LocalJSXCommand {
  name: string;
  description: string;
  type: 'local-jsx';
  aliases?: string[];
  render(ctx: CommandContext): React.ReactElement;
}

export type SlashCommand = PromptCommand | LocalCommand | LocalJSXCommand;
