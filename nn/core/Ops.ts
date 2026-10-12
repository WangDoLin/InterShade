import { Tensor } from './Tensor.js';

export class Ops {
  /**
   * Element-wise Addition with 1D bias broadcast support: C = A + B
   */
  static add(a: Tensor, b: Tensor): Tensor {
    const isBiasBroadcast = b.shape.length === 1 && a.shape[a.shape.length - 1] === b.shape[0];
    const sameShape = a.shape.length === b.shape.length && a.shape.every((dim, i) => dim === b.shape[i]);

    if (!sameShape && !isBiasBroadcast) {
      throw new Error(`Shape mismatch for add: [${a.shape}] + [${b.shape}]`);
    }

    const outData = new Float32Array(a.size);
    const requiresGrad = a.requiresGrad || b.requiresGrad;

    if (sameShape) {
      for (let i = 0; i < a.size; i++) {
        outData[i] = a.data[i] + b.data[i];
      }
    } else if (isBiasBroadcast) {
      const bLen = b.shape[0];
      for (let i = 0; i < a.size; i++) {
        outData[i] = a.data[i] + b.data[i % bLen];
      }
    }

    const out = new Tensor(outData, a.shape, requiresGrad);

    if (requiresGrad) {
      out.creatorNode = {
        parents: [a, b],
        backward: (upstreamGrad: Tensor) => {
          if (a.requiresGrad) {
            a.accumulateGrad(upstreamGrad);
          }
          if (b.requiresGrad) {
            if (sameShape) {
              b.accumulateGrad(upstreamGrad);
            } else if (isBiasBroadcast) {
              const bLen = b.shape[0];
              const bGradData = new Float32Array(bLen);
              for (let i = 0; i < upstreamGrad.size; i++) {
                bGradData[i % bLen] += upstreamGrad.data[i];
              }
              b.accumulateGrad(new Tensor(bGradData, b.shape, false));
            }
          }
        }
      };
    }

    return out;
  }

  /**
   * Element-wise Subtraction: C = A - B
   */
  static sub(a: Tensor, b: Tensor): Tensor {
    if (a.size !== b.size) {
      throw new Error(`Size mismatch for sub: ${a.size} vs ${b.size}`);
    }

    const outData = new Float32Array(a.size);
    for (let i = 0; i < a.size; i++) {
      outData[i] = a.data[i] - b.data[i];
    }

    const requiresGrad = a.requiresGrad || b.requiresGrad;
    const out = new Tensor(outData, a.shape, requiresGrad);

    if (requiresGrad) {
      out.creatorNode = {
        parents: [a, b],
        backward: (upstreamGrad: Tensor) => {
          if (a.requiresGrad) {
            a.accumulateGrad(upstreamGrad);
          }
          if (b.requiresGrad) {
            const negGradData = new Float32Array(upstreamGrad.size);
            for (let i = 0; i < upstreamGrad.size; i++) {
              negGradData[i] = -upstreamGrad.data[i];
            }
            b.accumulateGrad(new Tensor(negGradData, b.shape, false));
          }
        }
      };
    }

    return out;
  }

  /**
   * Element-wise Multiplication: C = A * B
   */
  static mul(a: Tensor, b: Tensor): Tensor {
    if (a.size !== b.size) {
      throw new Error(`Size mismatch for mul: ${a.size} vs ${b.size}`);
    }

    const outData = new Float32Array(a.size);
    for (let i = 0; i < a.size; i++) {
      outData[i] = a.data[i] * b.data[i];
    }

    const requiresGrad = a.requiresGrad || b.requiresGrad;
    const out = new Tensor(outData, a.shape, requiresGrad);

    if (requiresGrad) {
      out.creatorNode = {
        parents: [a, b],
        backward: (upstreamGrad: Tensor) => {
          if (a.requiresGrad) {
            const aGradData = new Float32Array(a.size);
            for (let i = 0; i < a.size; i++) {
              aGradData[i] = upstreamGrad.data[i] * b.data[i];
            }
            a.accumulateGrad(new Tensor(aGradData, a.shape, false));
          }
          if (b.requiresGrad) {
            const bGradData = new Float32Array(b.size);
            for (let i = 0; i < b.size; i++) {
              bGradData[i] = upstreamGrad.data[i] * a.data[i];
            }
            b.accumulateGrad(new Tensor(bGradData, b.shape, false));
          }
        }
      };
    }

    return out;
  }

  /**
   * Scalar Scale Multiplication: C = A * scalar
   */
  static scale(a: Tensor, scalar: number): Tensor {
    const outData = new Float32Array(a.size);
    for (let i = 0; i < a.size; i++) {
      outData[i] = a.data[i] * scalar;
    }

    const out = new Tensor(outData, a.shape, a.requiresGrad);

    if (a.requiresGrad) {
      out.creatorNode = {
        parents: [a],
        backward: (upstreamGrad: Tensor) => {
          const scaledGradData = new Float32Array(a.size);
          for (let i = 0; i < a.size; i++) {
            scaledGradData[i] = upstreamGrad.data[i] * scalar;
          }
          a.accumulateGrad(new Tensor(scaledGradData, a.shape, false));
        }
      };
    }

    return out;
  }

  /**
   * 2D Matrix Multiplication: C = A (M, K) x B (K, N) -> (M, N)
   */
  static matmul(a: Tensor, b: Tensor): Tensor {
    if (a.shape.length !== 2 || b.shape.length !== 2) {
      throw new Error(`matmul currently requires 2D tensors. Got [${a.shape}] and [${b.shape}]`);
    }

    const [M, K1] = a.shape;
    const [K2, N] = b.shape;

    if (K1 !== K2) {
      throw new Error(`Inner dimension mismatch in matmul: [${M}, ${K1}] x [${K2}, ${N}]`);
    }

    const outData = new Float32Array(M * N);

    // Cache-friendly loop order (i, k, j)
    for (let i = 0; i < M; i++) {
      const aOffset = i * K1;
      const cOffset = i * N;
      for (let k = 0; k < K1; k++) {
        const aVal = a.data[aOffset + k];
        const bOffset = k * N;
        for (let j = 0; j < N; j++) {
          outData[cOffset + j] += aVal * b.data[bOffset + j];
        }
      }
    }

    const requiresGrad = a.requiresGrad || b.requiresGrad;
    const out = new Tensor(outData, [M, N], requiresGrad);

    if (requiresGrad) {
      out.creatorNode = {
        parents: [a, b],
        backward: (upstreamGrad: Tensor) => {
          // dL/dA = dL/dC x B^T  ->  (M, N) x (N, K) = (M, K)
          if (a.requiresGrad) {
            const bT = Ops.transpose2d(b);
            const aGrad = Ops.matmul(upstreamGrad, bT);
            a.accumulateGrad(aGrad);
          }
          // dL/dB = A^T x dL/dC  ->  (K, M) x (M, N) = (K, N)
          if (b.requiresGrad) {
            const aT = Ops.transpose2d(a);
            const bGrad = Ops.matmul(aT, upstreamGrad);
            b.accumulateGrad(bGrad);
          }
        }
      };
    }

    return out;
  }

  /**
   * Transpose 2D Matrix: (M, N) -> (N, M)
   */
  static transpose2d(a: Tensor): Tensor {
    if (a.shape.length !== 2) {
      throw new Error(`transpose2d requires 2D tensor. Got shape [${a.shape}]`);
    }

    const [M, N] = a.shape;
    const outData = new Float32Array(M * N);

    for (let i = 0; i < M; i++) {
      for (let j = 0; j < N; j++) {
        outData[j * M + i] = a.data[i * N + j];
      }
    }

    const out = new Tensor(outData, [N, M], a.requiresGrad);

    if (a.requiresGrad) {
      out.creatorNode = {
        parents: [a],
        backward: (upstreamGrad: Tensor) => {
          const gradA = Ops.transpose2d(upstreamGrad);
          a.accumulateGrad(gradA);
        }
      };
    }

    return out;
  }

  /**
   * Rectified Linear Unit: ReLU(x) = max(0, x)
   */
  static relu(a: Tensor): Tensor {
    const outData = new Float32Array(a.size);
    for (let i = 0; i < a.size; i++) {
      outData[i] = a.data[i] > 0 ? a.data[i] : 0;
    }

    const out = new Tensor(outData, a.shape, a.requiresGrad);

    if (a.requiresGrad) {
      out.creatorNode = {
        parents: [a],
        backward: (upstreamGrad: Tensor) => {
          const gradData = new Float32Array(a.size);
          for (let i = 0; i < a.size; i++) {
            gradData[i] = a.data[i] > 0 ? upstreamGrad.data[i] : 0;
          }
          a.accumulateGrad(new Tensor(gradData, a.shape, false));
        }
      };
    }

    return out;
  }

  /**
   * GELU activation (Gaussian Error Linear Unit fast tanh approximation)
   */
  static gelu(a: Tensor): Tensor {
    const outData = new Float32Array(a.size);
    const SQRT_2_OVER_PI = 0.7978845608;

    for (let i = 0; i < a.size; i++) {
      const x = a.data[i];
      const cube = 0.044715 * x * x * x;
      const inner = SQRT_2_OVER_PI * (x + cube);
      const tanh = Math.tanh(inner);
      outData[i] = 0.5 * x * (1 + tanh);
    }

    const out = new Tensor(outData, a.shape, a.requiresGrad);

    if (a.requiresGrad) {
      out.creatorNode = {
        parents: [a],
        backward: (upstreamGrad: Tensor) => {
          const gradData = new Float32Array(a.size);
          for (let i = 0; i < a.size; i++) {
            const x = a.data[i];
            const cube = 0.044715 * x * x * x;
            const inner = SQRT_2_OVER_PI * (x + cube);
            const tanh = Math.tanh(inner);
            const sech2 = 1 - tanh * tanh;
            const dInner = SQRT_2_OVER_PI * (1 + 3 * 0.044715 * x * x);
            const dGelu = 0.5 * (1 + tanh) + 0.5 * x * sech2 * dInner;
            gradData[i] = upstreamGrad.data[i] * dGelu;
          }
          a.accumulateGrad(new Tensor(gradData, a.shape, false));
        }
      };
    }

    return out;
  }

  /**
   * Softmax along last dimension
   */
  static softmax(a: Tensor): Tensor {
    const lastDim = a.shape[a.shape.length - 1];
    const outerSize = a.size / lastDim;
    const outData = new Float32Array(a.size);

    for (let outer = 0; outer < outerSize; outer++) {
      const offset = outer * lastDim;
      let maxVal = -Infinity;
      for (let i = 0; i < lastDim; i++) {
        if (a.data[offset + i] > maxVal) maxVal = a.data[offset + i];
      }

      let sumExp = 0;
      for (let i = 0; i < lastDim; i++) {
        const exp = Math.exp(a.data[offset + i] - maxVal);
        outData[offset + i] = exp;
        sumExp += exp;
      }

      const invSum = 1 / (sumExp || 1e-9);
      for (let i = 0; i < lastDim; i++) {
        outData[offset + i] *= invSum;
      }
    }

    return new Tensor(outData, a.shape, false);
  }

  /**
   * Sums all elements into a scalar Tensor of shape [1]
   */
  static sum(a: Tensor): Tensor {
    let total = 0;
    for (let i = 0; i < a.size; i++) {
      total += a.data[i];
    }

    const out = new Tensor(new Float32Array([total]), [1], a.requiresGrad);

    if (a.requiresGrad) {
      out.creatorNode = {
        parents: [a],
        backward: (upstreamGrad: Tensor) => {
          const upstreamVal = upstreamGrad.data[0];
          const gradData = new Float32Array(a.size);
          gradData.fill(upstreamVal);
          a.accumulateGrad(new Tensor(gradData, a.shape, false));
        }
      };
    }

    return out;
  }

  /**
   * Mean Squared Error Loss: MSE = sum((pred - target)^2) / N
   */
  static mseLoss(pred: Tensor, target: Tensor): Tensor {
    if (pred.size !== target.size) {
      throw new Error(`Size mismatch in mseLoss: ${pred.size} vs ${target.size}`);
    }

    const diff = Ops.sub(pred, target);
    const sqDiff = Ops.mul(diff, diff);
    const sumSq = Ops.sum(sqDiff);
    return Ops.scale(sumSq, 1.0 / pred.size);
  }
}
