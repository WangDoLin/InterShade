export type TensorData = Float32Array;

export interface AutogradNode {
  backward(upstreamGrad: Tensor): void;
  parents: Tensor[];
}

export class Tensor {
  public shape: number[];
  public strides: number[];
  public size: number;
  public data: Float32Array;
  public grad: Tensor | null = null;
  public requiresGrad: boolean;
  public creatorNode: AutogradNode | null = null;

  constructor(
    data: Float32Array | number[],
    shape: number[],
    requiresGrad: boolean = false
  ) {
    this.shape = [...shape];
    this.size = shape.reduce((acc, dim) => acc * dim, 1);
    this.strides = Tensor.computeStrides(this.shape);
    this.requiresGrad = requiresGrad;

    if (data instanceof Float32Array) {
      if (data.length !== this.size) {
        throw new Error(`Data size (${data.length}) does not match shape total (${this.size}).`);
      }
      this.data = data;
    } else {
      if (data.length !== this.size) {
        throw new Error(`Data array length (${data.length}) does not match shape total (${this.size}).`);
      }
      this.data = new Float32Array(data);
    }
  }

  static computeStrides(shape: number[]): number[] {
    const strides = new Array(shape.length);
    let stride = 1;
    for (let i = shape.length - 1; i >= 0; i--) {
      strides[i] = stride;
      stride *= shape[i];
    }
    return strides;
  }

  static zeros(shape: number[], requiresGrad: boolean = false): Tensor {
    const size = shape.reduce((a, b) => a * b, 1);
    return new Tensor(new Float32Array(size), shape, requiresGrad);
  }

  static ones(shape: number[], requiresGrad: boolean = false): Tensor {
    const size = shape.reduce((a, b) => a * b, 1);
    const data = new Float32Array(size);
    data.fill(1);
    return new Tensor(data, shape, requiresGrad);
  }

  static randn(shape: number[], mean: number = 0, std: number = 1, requiresGrad: boolean = false): Tensor {
    const size = shape.reduce((a, b) => a * b, 1);
    const data = new Float32Array(size);
    for (let i = 0; i < size; i += 2) {
      // Box-Muller transform
      const u1 = Math.max(1e-7, Math.random());
      const u2 = Math.random();
      const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
      const z1 = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);
      data[i] = mean + z0 * std;
      if (i + 1 < size) {
        data[i + 1] = mean + z1 * std;
      }
    }
    return new Tensor(data, shape, requiresGrad);
  }

  static kaimingUniform(shape: number[], fanIn: number, requiresGrad: boolean = false): Tensor {
    const bound = Math.sqrt(3.0 / Math.max(1, fanIn));
    const size = shape.reduce((a, b) => a * b, 1);
    const data = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      data[i] = (Math.random() * 2 - 1) * bound;
    }
    return new Tensor(data, shape, requiresGrad);
  }

  clone(): Tensor {
    const clonedData = new Float32Array(this.data);
    const t = new Tensor(clonedData, this.shape, this.requiresGrad);
    if (this.grad) {
      t.grad = this.grad.clone();
    }
    return t;
  }

  zeroGrad(): void {
    if (this.grad) {
      this.grad.data.fill(0);
    }
  }

  accumulateGrad(upstreamGrad: Tensor): void {
    if (!this.requiresGrad) return;
    if (!this.grad) {
      this.grad = upstreamGrad.clone();
      return;
    }

    if (this.grad.size !== upstreamGrad.size) {
      throw new Error(`Grad size mismatch: ${this.grad.size} vs ${upstreamGrad.size}`);
    }

    for (let i = 0; i < this.size; i++) {
      this.grad.data[i] += upstreamGrad.data[i];
    }
  }

  backward(): void {
    if (!this.requiresGrad) {
      throw new Error('Cannot call backward on a tensor with requiresGrad = false');
    }

    if (!this.grad) {
      this.grad = Tensor.ones(this.shape, false);
    }

    // Topological sorting of computation DAG
    const ordered: Tensor[] = [];
    const visited = new Set<Tensor>();

    function buildTopo(curr: Tensor) {
      if (visited.has(curr)) return;
      visited.add(curr);
      if (curr.creatorNode) {
        for (const parent of curr.creatorNode.parents) {
          buildTopo(parent);
        }
      }
      ordered.push(curr);
    }

    buildTopo(this);

    // Backward propagation in reverse topological order
    for (let i = ordered.length - 1; i >= 0; i--) {
      const node = ordered[i];
      if (node.creatorNode && node.grad) {
        node.creatorNode.backward(node.grad);
      }
    }
  }
}
