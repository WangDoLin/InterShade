import { Tensor } from '../core/Tensor.js';

export interface AdamWOptions {
  lr?: number;
  betas?: [number, number];
  eps?: number;
  weightDecay?: number;
}

export class AdamW {
  public params: Tensor[];
  public lr: number;
  public beta1: number;
  public beta2: number;
  public eps: number;
  public weightDecay: number;

  private m: Map<Tensor, Float32Array> = new Map();
  private v: Map<Tensor, Float32Array> = new Map();
  private stepCount: number = 0;

  constructor(params: Tensor[], options: AdamWOptions = {}) {
    this.params = params.filter(p => p.requiresGrad);
    this.lr = options.lr ?? 0.001;
    this.beta1 = options.betas ? options.betas[0] : 0.9;
    this.beta2 = options.betas ? options.betas[1] : 0.999;
    this.eps = options.eps ?? 1e-8;
    this.weightDecay = options.weightDecay ?? 0.01;

    for (const p of this.params) {
      this.m.set(p, new Float32Array(p.size));
      this.v.set(p, new Float32Array(p.size));
    }
  }

  step(): void {
    this.stepCount++;
    const biasCorrection1 = 1 - Math.pow(this.beta1, this.stepCount);
    const biasCorrection2 = 1 - Math.pow(this.beta2, this.stepCount);

    for (const p of this.params) {
      if (!p.grad) continue;

      const m = this.m.get(p)!;
      const v = this.v.get(p)!;
      const grad = p.grad.data;
      const data = p.data;

      for (let i = 0; i < p.size; i++) {
        const g = grad[i];

        // First moment update
        m[i] = this.beta1 * m[i] + (1 - this.beta1) * g;
        // Second moment update
        v[i] = this.beta2 * v[i] + (1 - this.beta2) * g * g;

        // Bias corrected moments
        const mHat = m[i] / biasCorrection1;
        const vHat = v[i] / biasCorrection2;

        // Weight decay (decoupled)
        data[i] -= this.lr * this.weightDecay * data[i];

        // Parameter update
        data[i] -= (this.lr * mHat) / (Math.sqrt(vHat) + this.eps);
      }
    }
  }

  zeroGrad(): void {
    for (const p of this.params) {
      p.zeroGrad();
    }
  }
}
