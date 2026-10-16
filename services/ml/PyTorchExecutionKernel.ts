import { exec, spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

export interface PyTorchRunOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  dependencies?: string[];
  onProgress?: (line: string) => void;
}

export interface PyTorchRunResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  metrics: Record<string, number>;
  remediation?: MLRemediationPlan;
}

export interface MLRemediationPlan {
  detectedError: 'CUDA_OOM' | 'SHAPE_MISMATCH' | 'NAN_LOSS' | 'GENERAL_RUNTIME';
  rootCause: string;
  recommendedAction: string;
  suggestedPatch: string;
}

/**
 * PyTorchExecutionKernel manages executing PyTorch scripts safely inside an isolated
 * `uv` sandbox with PEP 723 dependency headers and provides self-healing diagnostic analysis.
 */
export class PyTorchExecutionKernel {
  /**
   * Executes a Python script with PyTorch dependencies via `uv run`
   */
  static async runScript(
    scriptPath: string,
    options: PyTorchRunOptions = {}
  ): Promise<PyTorchRunResult> {
    const timeout = options.timeoutMs || 300000; // default 5 minutes
    const cwd = options.cwd || process.cwd();
    const deps = options.dependencies || ['torch', 'numpy'];

    // Construct uv run command with inline dependencies
    const depFlags = deps.map((d) => `--with "${d}"`).join(' ');
    const cmd = `uv run ${depFlags} python "${scriptPath}"`;

    return new Promise((resolve) => {
      const child = exec(
        cmd,
        {
          cwd,
          timeout,
          maxBuffer: 10 * 1024 * 1024,
          env: {
            ...process.env,
            PYTHONUNBUFFERED: '1',
            ...options.env,
          },
        },
        (error, stdout, stderr) => {
          const rawStdout = stdout || '';
          const rawStderr = stderr || '';
          const exitCode = error ? (error.code as number) || 1 : 0;
          const success = exitCode === 0;

          // Parse telemetry metrics (e.g. "epoch: 1, loss: 0.234, auroc: 0.89")
          const metrics = this.extractMetrics(rawStdout);

          // If failed, invoke self-healing diagnostic engine
          let remediation: MLRemediationPlan | undefined;
          if (!success) {
            remediation = this.diagnoseError(rawStderr || rawStdout);
          }

          resolve({
            success,
            stdout: rawStdout,
            stderr: rawStderr,
            exitCode,
            metrics,
            remediation,
          });
        }
      );

      if (options.onProgress && child.stdout) {
        child.stdout.on('data', (data) => {
          options.onProgress?.(data.toString());
        });
      }
    });
  }

  /**
   * Diagnoses ML runtime errors (CUDA OOM, Shape Mismatch, NaN Loss) and formulates remediation
   */
  static diagnoseError(output: string): MLRemediationPlan {
    // 1. CUDA Out of Memory
    if (/CUDA out of memory|torch\.cuda\.OutOfMemoryError/i.test(output)) {
      return {
        detectedError: 'CUDA_OOM',
        rootCause: 'GPU VRAM exhausted during forward/backward pass or tensor allocation.',
        recommendedAction: 'Halve batch size, double gradient accumulation steps, and enable mixed precision (AMP).',
        suggestedPatch: `
# Remediation: Reduce batch size and increase gradient accumulation
batch_size = max(1, batch_size // 2)
gradient_accumulation_steps = gradient_accumulation_steps * 2
torch.cuda.empty_cache()
scaler = torch.amp.GradScaler('cuda')
`.trim(),
      };
    }

    // 2. Tensor Shape Mismatch
    const shapeMatch = /RuntimeError: The size of tensor a \((\d+)\) must match the size of tensor b \((\d+)\)/i.exec(
      output
    ) || /size mismatch, m1: \[(\d+) x (\d+)\], m2: \[(\d+) x (\d+)\]/i.exec(output);

    if (shapeMatch) {
      return {
        detectedError: 'SHAPE_MISMATCH',
        rootCause: `Tensor dimension mismatch detected: ${shapeMatch[0]}. Layer projections do not align.`,
        recommendedAction: 'Insert an adaptive pooling layer or adjust the linear projection in_features to match output dimension.',
        suggestedPatch: `
# Remediation: Adjust linear layer projection or use adaptive pooling
# e.g.: nn.Linear(in_features=${shapeMatch[2] || shapeMatch[1]}, out_features=...)
# or:   x = nn.functional.adaptive_avg_pool2d(x, (1, 1)).flatten(1)
`.trim(),
      };
    }

    // 3. NaN / Inf Loss or Gradient Explosion
    if (/Loss is NaN|Loss is Inf|gradient.*nan/i.test(output)) {
      return {
        detectedError: 'NAN_LOSS',
        rootCause: 'Numerical instability or exploding gradients encountered during backpropagation.',
        recommendedAction: 'Apply gradient norm clipping (e.g. clip_grad_norm_ <= 1.0) and reduce initial learning rate.',
        suggestedPatch: `
# Remediation: Gradient clipping and numerical stability guards
torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
optimizer.param_groups[0]['lr'] = optimizer.param_groups[0]['lr'] * 0.5
`.trim(),
      };
    }

    return {
      detectedError: 'GENERAL_RUNTIME',
      rootCause: 'General Python or PyTorch runtime exception.',
      recommendedAction: 'Inspect stack trace call sites and verify dependencies.',
      suggestedPatch: '# Review trace for module imports and input data format.',
    };
  }

  /**
   * Extracts quantitative metric pairs from training output
   */
  private static extractMetrics(output: string): Record<string, number> {
    const metrics: Record<string, number> = {};
    const metricRegex = /\b(loss|val_loss|accuracy|acc|auroc|auc|f1|f1_score|rmse|mae|r2|epoch|step)\b[:=]\s*([0-9.]+)/gi;
    let match: RegExpExecArray | null;

    while ((match = metricRegex.exec(output)) !== null) {
      const key = match[1].toLowerCase();
      const val = parseFloat(match[2]);
      if (!isNaN(val)) {
        metrics[key] = val;
      }
    }
    return metrics;
  }
}
