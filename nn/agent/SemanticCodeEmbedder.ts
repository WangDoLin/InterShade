import { Tensor } from '../core/Tensor.js';

export interface CodeMatch {
  filePath: string;
  snippet: string;
  similarity: number;
}

export class SemanticCodeEmbedder {
  public static readonly EMBEDDING_DIM = 128;

  /**
   * Generates a 128-dimensional dense vector for a given text snippet.
   */
  static embed(text: string): Float32Array {
    const vec = new Float32Array(SemanticCodeEmbedder.EMBEDDING_DIM);
    const cleaned = text.toLowerCase();

    // Word tokenization
    const tokens = cleaned.match(/[a-z0-9_]{2,}/g) || [];
    for (const token of tokens) {
      let h = 0;
      for (let i = 0; i < token.length; i++) {
        h = (h * 33 + token.charCodeAt(i)) >>> 0;
      }
      const dim = h % SemanticCodeEmbedder.EMBEDDING_DIM;
      vec[dim] += 1.0;
    }

    // Substring n-gram projection for partial matches
    for (let i = 0; i < cleaned.length - 3; i += 2) {
      const quad = cleaned.slice(i, i + 4);
      let h = 5381;
      for (let j = 0; j < quad.length; j++) {
        h = ((h << 5) + h + quad.charCodeAt(j)) >>> 0;
      }
      const dim = h % SemanticCodeEmbedder.EMBEDDING_DIM;
      vec[dim] += 0.3;
    }

    // L2 Normalization
    let normSq = 0;
    for (let i = 0; i < SemanticCodeEmbedder.EMBEDDING_DIM; i++) {
      normSq += vec[i] * vec[i];
    }

    const norm = Math.sqrt(normSq);
    if (norm > 1e-9) {
      const invNorm = 1 / norm;
      for (let i = 0; i < SemanticCodeEmbedder.EMBEDDING_DIM; i++) {
        vec[i] *= invNorm;
      }
    }

    return vec;
  }

  /**
   * Computes cosine similarity between two normalized vectors
   */
  static cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i];
    }
    return dot;
  }

  /**
   * Rank snippets by cosine similarity against query
   */
  static rank(query: string, candidates: Array<{ filePath: string; snippet: string }>): CodeMatch[] {
    const queryVec = this.embed(query);
    const scored: CodeMatch[] = [];

    for (const item of candidates) {
      const itemVec = this.embed(item.snippet);
      const similarity = this.cosineSimilarity(queryVec, itemVec);
      scored.push({
        filePath: item.filePath,
        snippet: item.snippet,
        similarity: Number(similarity.toFixed(4))
      });
    }

    return scored.sort((a, b) => b.similarity - a.similarity);
  }
}
