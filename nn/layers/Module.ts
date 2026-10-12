import { Tensor } from '../core/Tensor.js';

export abstract class Module {
  public training: boolean = true;

  train(): void {
    this.training = true;
  }

  eval(): void {
    this.training = false;
  }

  abstract forward(input: Tensor): Tensor;

  abstract parameters(): Tensor[];

  zeroGrad(): void {
    for (const p of this.parameters()) {
      p.zeroGrad();
    }
  }
}
