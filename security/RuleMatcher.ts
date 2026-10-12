export interface ParsedRule {
  raw: string;
  toolName: string;
  argPattern?: string;
  isAllow: boolean;
}

export class RuleMatcher {
  /**
   * Parse a rule string such as:
   * "run_shell_command(git commit *)"
   * "file_edit(src/**)"
   * "file_write(*.json)"
   */
  static parseRule(ruleStr: string, isAllow: boolean = true): ParsedRule {
    const trimmed = ruleStr.trim();
    const match = trimmed.match(/^([a-zA-Z0-9_-]+)(?:\((.*)\))?$/);

    if (!match) {
      return {
        raw: trimmed,
        toolName: trimmed,
        isAllow,
      };
    }

    return {
      raw: trimmed,
      toolName: match[1],
      argPattern: match[2] ? match[2].trim() : undefined,
      isAllow,
    };
  }

  /**
   * Evaluates if a given tool call matches a rule pattern
   */
  static matches(rule: ParsedRule, toolName: string, args: Record<string, unknown>): boolean {
    const normalizedTool = toolName.toLowerCase();
    const ruleTool = rule.toolName.toLowerCase();

    // Map common aliases (e.g. bash -> run_shell_command, fileedit -> file_edit)
    const aliases: Record<string, string> = {
      bash: 'run_shell_command',
      shell: 'run_shell_command',
      fileedit: 'file_edit',
      filewrite: 'file_write',
      fileread: 'file_read',
    };

    const targetTool = aliases[normalizedTool] || normalizedTool;
    const ruleTargetTool = aliases[ruleTool] || ruleTool;

    if (ruleTargetTool !== '*' && ruleTargetTool !== targetTool) {
      return false;
    }

    if (!rule.argPattern || rule.argPattern === '*') {
      return true;
    }

    // Extract relevant argument string for checking (e.g. command or path)
    const argValue = (args.command || args.path || args.filePath || args.url || JSON.stringify(args)) as string;
    if (typeof argValue !== 'string') {
      return false;
    }

    return this.wildcardMatch(rule.argPattern, argValue);
  }

  /**
   * Fast glob wildcard matching (e.g. "git commit *" or "src/**")
   */
  static wildcardMatch(pattern: string, str: string): boolean {
    if (pattern === '*' || pattern === '**') return true;

    // Use placeholder to prevent double-replacement of *
    let p = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    p = p.replace(/\*\*/g, '__GLOBSTAR__');
    p = p.replace(/\*/g, '.*');
    p = p.replace(/__GLOBSTAR__/g, '.*');
    p = p.replace(/\?/g, '.');

    const regex = new RegExp(`^${p}$`, 'i');
    return regex.test(str);
  }
}
