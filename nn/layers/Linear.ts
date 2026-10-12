import { Module } from './Module.js';
import { Tensor } from '../core/Tensor.js';
import { Ops } from '../core/Ops.js';

export class Linear extends Module {
  public weight: Tensor;
  public bias: Tensor | null;
  public inFeatures: number;
  public outFeatures: number;

  constructor(inFeatures: number, outFeatures: number, useBias: boolean = true) {
    super();
    this.inFeatures = inFeatures;
    this.outFeatures = outFeatures;

    // Kaiming uniform weight initialization: (inFeatures, outFeatures)
    this.weight = Tensor.kaimingUniform([inFeatures, outFeatures], inFeatures, true);
    this.bias = useBias ? Tensor.zeros([outFeatures], true) : null;
  }

  forward(input: Tensor): Tensor {
    // input is (Batch, inFeatures)
    // out = input x weight
    let out = Ops.matmul(input, this.weight);
    if (this.bias) {
      out = Ops.add(out, this.bias);
    }
    return out;
  }

  parameters(): Tensor[] {
    const params = [this.weight];
    if (this.bias) params.push(this.bias);
    return params;
  }
}
