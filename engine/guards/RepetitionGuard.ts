export interface ToolCallSignature {
  toolName: string;
  argsString: string;
  timestamp: number;
}

export interface RepetitionCheckResult {
  isLooping: boolean;
  repeatCount: number;
  toolName?: string;
  interventionPrompt?: string;
}

export class RepetitionGuard {
  private history: ToolCallSignature[] = [];
  private readonly maxWindow: number;
  private readonly loopThreshold: number;

  constructor(maxWindow: number = 6, loopThreshold: number = 3) {
    this.maxWindow = maxWindow;
    this.loopThreshold = loopThreshold;
  }

  record(toolName: string, args: Record<string, unknown>): RepetitionCheckResult {
    const argsString = JSON.stringify(args);
    const sig: ToolCallSignature = {
      toolName,
      argsString,
      timestamp: Date.now()
    };

    this.history.push(sig);
    if (this.history.length > this.maxWindow) {
      this.history.shift();
    }

    return this.check();
  }

  check(): RepetitionCheckResult {
    if (this.history.length < this.loopThreshold) {
      return { isLooping: false, repeatCount: 0 };
    }

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
        toolName: last.toolName,
        interventionPrompt: `[REPETITION GUARD INTERVENTION]: You have invoked the tool "${last.toolName}" with identical arguments ${repeatCount} times consecutively without changing state. Stop repeating the action. Analyze the root cause of why this action is not making progress, select an alternative strategy, or report the obstacle directly to the user.`
      };
    }

    return {
      isLooping: false,
      repeatCount
    };
  }

  reset(): void {
    this.history = [];
  }
}
