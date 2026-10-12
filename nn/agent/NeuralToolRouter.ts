import { Tensor } from '../core/Tensor.js';
import { Linear } from '../layers/Linear.js';
import { Ops } from '../core/Ops.js';

export interface RoutePrediction {
  topTool: string;
  confidence: number;
  scores: Record<string, number>;
}

export class NeuralToolRouter {
  public static readonly TOOLS = [
    'pack_repository',
    'file_read',
    'file_edit',
    'file_write',
    'grep_search',
    'find_files',
    'shell_exec',
    'ask_user',
    'subagent_delegate'
  ];

  private fc1: Linear;
  private fc2: Linear;
  private inputDim: number = 64;

  constructor() {
    this.fc1 = new Linear(this.inputDim, 32, true);
    this.fc2 = new Linear(32, NeuralToolRouter.TOOLS.length, true);
    this.initializeHeuristicWeights();
  }

  /**
   * Generates a 64-dimensional feature vector from prompt text
   */
  private extractFeatures(prompt: string): Tensor {
    const lower = prompt.toLowerCase();
    const vec = new Float32Array(this.inputDim);

    const patterns: Array<[RegExp, number]> = [
      [/\b(pack|repomix|overview|snapshot|context|repo)\b/g, 0],
      [/\b(read|view|show|cat|inspect|open)\b/g, 1],
      [/\b(edit|modify|change|replace|update|fix)\b/g, 2],
      [/\b(write|create|new file|generate file)\b/g, 3],
      [/\b(grep|search|find text|lookup|pattern)\b/g, 4],
      [/\b(find|glob|locate|list files|tree)\b/g, 5],
      [/\b(run|exec|bash|terminal|command|npm|test|build)\b/g, 6],
      [/\b(ask|clarify|question|confirm)\b/g, 7],
      [/\b(subagent|delegate|parallel|background)\b/g, 8]
    ];

    for (const [re, idx] of patterns) {
      const matches = lower.match(re);
      if (matches) {
        vec[idx] = Math.min(5.0, matches.length * 1.5);
      }
    }

    // Hash character trigrams into dimensions 9..63 for lexical semantic coverage
    for (let i = 0; i < lower.length - 2; i++) {
      const trigram = lower.slice(i, i + 3);
      let hash = 0;
      for (let j = 0; j < trigram.length; j++) {
        hash = (hash * 31 + trigram.charCodeAt(j)) >>> 0;
      }
      const dim = 9 + (hash % (this.inputDim - 9));
      vec[dim] = Math.min(3.0, vec[dim] + 0.2);
    }

    return new Tensor(vec, [1, this.inputDim], false);
  }

  /**
   * Initializes network with inductive bias weights for routing
   */
  private initializeHeuristicWeights(): void {
    // Connect prominent feature slots directly through fc1 and fc2
    for (let i = 0; i < Math.min(NeuralToolRouter.TOOLS.length, 9); i++) {
      this.fc1.weight.data[i * 32 + i] = 2.5;
      this.fc2.weight.data[i * NeuralToolRouter.TOOLS.length + i] = 3.0;
    }
  }

  /**
   * Predicts top tool and probability distribution given a user prompt
   */
  route(prompt: string): RoutePrediction {
    const input = this.extractFeatures(prompt);

    // Forward pass: Linear -> GELU -> Linear -> Softmax
    const h1 = this.fc1.forward(input);
    const act = Ops.gelu(h1);
    const logits = this.fc2.forward(act);
    const probs = Ops.softmax(logits);

    const scores: Record<string, number> = {};
    let topTool = NeuralToolRouter.TOOLS[0];
    let maxProb = -1;

    for (let i = 0; i < NeuralToolRouter.TOOLS.length; i++) {
      const tool = NeuralToolRouter.TOOLS[i];
      const prob = probs.data[i];
      scores[tool] = Number(prob.toFixed(4));
      if (prob > maxProb) {
        maxProb = prob;
        topTool = tool;
      }
    }

    return {
      topTool,
      confidence: Number(maxProb.toFixed(4)),
      scores
    };
  }
}
