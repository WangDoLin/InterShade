import { Module } from './Module.js';
import { Tensor } from '../core/Tensor.js';
import { Linear } from './Linear.js';
import { Ops } from '../core/Ops.js';

export class MultiHeadAttention extends Module {
  public embedDim: number;
  public numHeads: number;
  public headDim: number;

  public qProj: Linear;
  public kProj: Linear;
  public vProj: Linear;
  public outProj: Linear;

  constructor(embedDim: number, numHeads: number) {
    super();
    if (embedDim % numHeads !== 0) {
      throw new Error(`embedDim (${embedDim}) must be divisible by numHeads (${numHeads})`);
    }

    this.embedDim = embedDim;
    this.numHeads = numHeads;
    this.headDim = embedDim / numHeads;

    this.qProj = new Linear(embedDim, embedDim, false);
    this.kProj = new Linear(embedDim, embedDim, false);
    this.vProj = new Linear(embedDim, embedDim, false);
    this.outProj = new Linear(embedDim, embedDim, true);
  }

  forward(x: Tensor): Tensor {
    // x: (seqLen, embedDim)
    const [seqLen, embedDim] = x.shape;
    if (embedDim !== this.embedDim) {
      throw new Error(`Input dim ${embedDim} does not match attention embedDim ${this.embedDim}`);
    }

    const q = this.qProj.forward(x);
    const k = this.kProj.forward(x);
    const v = this.vProj.forward(x);

    // Compute scaled dot-product attention
    // scores = (Q x K^T) / sqrt(headDim)
    const kT = Ops.transpose2d(k);
    const scores = Ops.matmul(q, kT);
    const scaleFactor = 1.0 / Math.sqrt(this.headDim);
    const scaledScores = Ops.scale(scores, scaleFactor);

    // Softmax over attention weights
    const attnWeights = Ops.softmax(scaledScores);

    // Context = attnWeights x V
    const context = Ops.matmul(attnWeights, v);

    // Output projection
    return this.outProj.forward(context);
  }

  parameters(): Tensor[] {
    return [
      ...this.qProj.parameters(),
      ...this.kProj.parameters(),
      ...this.vProj.parameters(),
      ...this.outProj.parameters()
    ];
  }
}
