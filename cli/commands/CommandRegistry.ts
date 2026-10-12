import type { SlashCommand, CommandContext } from './types.js';

export class CommandRegistry {
  private commands: Map<string, SlashCommand> = new Map();
  private aliasMap: Map<string, string> = new Map();

  register(command: SlashCommand): void {
    const key = command.name.toLowerCase().replace(/^\//, '');
    this.commands.set(key, command);

    if (command.aliases) {
      for (const alias of command.aliases) {
        const aliasKey = alias.toLowerCase().replace(/^\//, '');
        this.aliasMap.set(aliasKey, key);
      }
    }
  }

  get(name: string): SlashCommand | undefined {
    const clean = name.toLowerCase().replace(/^\//, '');
    const canonical = this.aliasMap.get(clean) || clean;
    return this.commands.get(canonical);
  }

  has(name: string): boolean {
    return this.get(name) !== undefined;
  }

  list(): SlashCommand[] {
    return Array.from(this.commands.values());
  }

  /**
   * Parse input line (e.g. "/review src/auth.ts") into command and args
   */
  parseInput(input: string): { commandName: string; args: string[] } | null {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) {
      return null;
    }

    const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
    const matches: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(trimmed.slice(1))) !== null) {
      matches.push(match[1] !== undefined ? match[1] : match[2] !== undefined ? match[2] : match[0]);
    }

    if (matches.length === 0) return null;
    const commandName = matches[0];
    const args = matches.slice(1);

    return { commandName, args };
  }

  /**
   * Execute a slash command from raw input string
   */
  async execute(
    input: string,
    context: { cwd: string; sessionState: Record<string, unknown>; args?: string[] }
  ): Promise<string> {
    const parsed = this.parseInput(input);
    if (!parsed) {
      return `Invalid command syntax: ${input}`;
    }

    const cmd = this.get(parsed.commandName);
    if (!cmd) {
      return `Unknown command: /${parsed.commandName}`;
    }

    const commandCtx: CommandContext = {
      cwd: context.cwd,
      sessionState: context.sessionState,
      args: parsed.args.length > 0 ? parsed.args : context.args || [],
    };

    if (cmd.type === 'local') {
      return await cmd.execute(commandCtx);
    }

    if (cmd.type === 'prompt') {
      return await cmd.getPrompt(commandCtx);
    }

    return `Command /${cmd.name} is a UI interactive component.`;
  }
}
