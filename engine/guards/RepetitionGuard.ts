export interface ToolCallSignature {
  toolName: string;
  argsString: string;
  timestamp: number;
}

export type LoopType = 'consecutive' | 'alternating_cycle' | 'streaming_echo';

export interface RepetitionCheckResult {
  isLooping: boolean;
  repeatCount: number;
  loopType?: LoopType;
  toolName?: string;
  cycleSignature?: string[];
  interventionPrompt?: string;
}

/**
 * RepetitionGuard detects when an agent gets trapped in degenerate loops:
 * 1. Consecutive identical tool calls with identical arguments.
 * 2. Alternating cyclical loops (e.g., Tool A -> Tool B -> Tool A -> Tool B).
 * 3. Text-level degenerate repetition (token/line echoing) inspired by Hermes Agent repetition_guard.
 */
export class RepetitionGuard {
  private history: ToolCallSignature[] = [];
  private readonly maxWindow: number;
  private readonly loopThreshold: number;

  constructor(maxWindow: number = 10, loopThreshold: number = 3) {
    this.maxWindow = maxWindow;
    this.loopThreshold = loopThreshold;
  }

  /**
   * Record a tool invocation and immediately evaluate whether a loop is detected.
   */
  record(toolName: string, args: Record<string, unknown>): RepetitionCheckResult {
    const argsString = JSON.stringify(args);
    const sig: ToolCallSignature = {
      toolName,
      argsString,
      timestamp: Date.now(),
    };

    this.history.push(sig);
    if (this.history.length > this.maxWindow) {
      this.history.shift();
    }

    return this.check();
  }

  /**
   * Check for consecutive identical calls or alternating cyclical loops.
   */
  check(): RepetitionCheckResult {
    // 1. Check consecutive identical tool calls
    if (this.history.length >= this.loopThreshold) {
      const last = this.history[this.history.length - 1];
      let repeatCount = 0;

      for (let i = this.history.length - 1; i >= 0; i--) {
        const item = this.history[i];
        if (item.toolName === last.toolName && item.argsString === last.argsString) {
          repeatCount++;
        } else {
          break;
        }
      }

      if (repeatCount >= this.loopThreshold) {
        return {
          isLooping: true,
          repeatCount,
          loopType: 'consecutive',
          toolName: last.toolName,
          interventionPrompt: `[REPETITION GUARD INTERVENTION]: You have invoked the tool "${last.toolName}" with identical arguments ${repeatCount} times consecutively without state progression. Stop repeating this action. Analyze the root cause of why this call is not progressing your goal, switch to an alternative strategy, or seek user clarification.`,
        };
      }
    }

    // 2. Check alternating cyclical patterns (e.g., A -> B -> A -> B or A -> B -> C -> A -> B -> C)
    const cycle = this.detectAlternatingCycle();
    if (cycle.isCycle) {
      const cyclePattern = cycle.cycleNames.join(' -> ');
      return {
        isLooping: true,
        repeatCount: cycle.repetitions,
        loopType: 'alternating_cycle',
        cycleSignature: cycle.cycleNames,
        interventionPrompt: `[CYCLICAL LOOP DETECTED]: An alternating tool cycle [${cyclePattern}] was executed ${cycle.repetitions} times repeatedly. The current strategy is ping-ponging between tools without converging. Step back, analyze why this sequence is failing, formulate a fundamentally different plan, or ask the user for guidance.`,
      };
    }

    return {
      isLooping: false,
      repeatCount: 0,
    };
  }

  /**
   * Detect alternating cycles (period length 2 to 4) repeated at least 2 times.
   */
  private detectAlternatingCycle(): { isCycle: boolean; cycleNames: string[]; repetitions: number } {
    const n = this.history.length;
    if (n < 4) return { isCycle: false, cycleNames: [], repetitions: 0 };

    // Test cycle periods of 2, 3, or 4
    for (let period = 2; period <= 4; period++) {
      if (n < period * 2) continue;

      const candidateCycle = this.history.slice(n - period).map((h) => `${h.toolName}:${h.argsString}`);
      let matches = 1;

      for (let offset = period * 2; offset <= n; offset += period) {
        const prevBlock = this.history.slice(n - offset, n - offset + period).map((h) => `${h.toolName}:${h.argsString}`);
        let allEqual = true;
        for (let i = 0; i < period; i++) {
          if (candidateCycle[i] !== prevBlock[i]) {
            allEqual = false;
            break;
          }
        }

        if (allEqual) {
          matches++;
        } else {
          break;
        }
      }

      if (matches >= 2) {
        const cycleNames = this.history.slice(n - period).map((h) => h.toolName);
        return {
          isCycle: true,
          cycleNames,
          repetitions: matches,
        };
      }
    }

    return { isCycle: false, cycleNames: [], repetitions: 0 };
  }

  /**
   * Scan generated text or streaming deltas for runaway echoing loops.
   * Based on Hermes repetition_guard.py:
   * Checks for line duplication dominance or repeating window recurrence.
   */
  static isTextRepetitionDominated(text: string): { isEchoing: boolean; details?: string } {
    if (!text || typeof text !== 'string') return { isEchoing: false };
    const len = text.length;
    if (len < 400) return { isEchoing: false };

    // 1. Line-level repetition check: one normalized non-empty line repeating excessively
    const rawLines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 10);
    if (rawLines.length >= 6) {
      const lineCounts = new Map<string, number>();
      for (const line of rawLines) {
        lineCounts.set(line, (lineCounts.get(line) || 0) + 1);
      }

      for (const [line, count] of lineCounts.entries()) {
        const totalCharsInRepeat = line.length * count;
        if (count >= 5 && totalCharsInRepeat > len * 0.45) {
          return {
            isEchoing: true,
            details: `Line repetition dominated: Line "${line.slice(0, 40)}..." repeated ${count} times covering ${Math.round((totalCharsInRepeat / len) * 100)}% of content.`,
          };
        }
      }
    }

    // 2. Sliding window repeat check (60-char window)
    const windowSize = 60;
    if (len >= windowSize * 3) {
      const windowCounts = new Map<string, number>();
      const step = 15; // sample step for efficiency
      const requiredMatches = Math.max(5, Math.ceil((len * 0.4) / windowSize));

      for (let i = 0; i <= len - windowSize; i += step) {
        const sub = text.slice(i, i + windowSize);
        const count = (windowCounts.get(sub) || 0) + 1;
        if (count >= requiredMatches) {
          return {
            isEchoing: true,
            details: `Window repetition dominated: 60-character block recurred ${count} times.`,
          };
        }
        windowCounts.set(sub, count);
      }
    }

    return { isEchoing: false };
  }

  /**
   * Reset history ledger.
   */
  reset(): void {
    this.history = [];
  }
}
