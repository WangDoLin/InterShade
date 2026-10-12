import { Module } from './Module.js';
import { Tensor } from '../core/Tensor.js';

export class RMSNorm extends Module {
  public weight: Tensor;
  public dim: number;
  public eps: number;

  constructor(dim: number, eps: number = 1e-6) {
    super();
    this.dim = dim;
    this.eps = eps;
    this.weight = Tensor.ones([dim], true);
  }

  forward(input: Tensor): Tensor {
    const lastDim = input.shape[input.shape.length - 1];
    if (lastDim !== this.dim) {
      throw new Error(`RMSNorm dim mismatch: input last dim ${lastDim} != ${this.dim}`);
    }

    const outerSize = input.size / lastDim;
    const outData = new Float32Array(input.size);

    for (let outer = 0; outer < outerSize; outer++) {
      const offset = outer * lastDim;
      let sumSq = 0;
      for (let i = 0; i < lastDim; i++) {
        const val = input.data[offset + i];
        sumSq += val * val;
      }

      const rms = Math.sqrt(sumSq / lastDim + this.eps);
      const invRms = 1 / rms;

      for (let i = 0; i < lastDim; i++) {
        outData[offset + i] = (input.data[offset + i] * invRms) * this.weight.data[i];
      }
    }

    return new Tensor(outData, input.shape, input.requiresGrad || this.weight.requiresGrad);
  }

  parameters(): Tensor[] {
    return [this.weight];
  }
}
