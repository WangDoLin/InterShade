import { SemanticCodeEmbedder, type CodeMatch } from './SemanticCodeEmbedder.js';

export interface RerankResult {
  filePath: string;
  relevanceScore: number;
  snippet: string;
}

export class CrossEncoderReranker {
  /**
   * Reranks a set of search matches using dual lexical and semantic cross-scoring
   */
  static rerank(
    query: string,
    candidates: Array<{ filePath: string; snippet: string }>,
    topK: number = 10
  ): RerankResult[] {
    const rawMatches = SemanticCodeEmbedder.rank(query, candidates);
    const queryTokens = new Set(
      query
        .toLowerCase()
        .match(/[a-z0-9_]{3,}/g) || []
    );

    const scored = rawMatches.map(m => {
      const lowerSnippet = m.snippet.toLowerCase();
      let lexicalBonus = 0;

      for (const token of queryTokens) {
        if (lowerSnippet.includes(token)) {
          lexicalBonus += 0.15;
        }
      }

      // Exact substring match bonus
      if (lowerSnippet.includes(query.toLowerCase().trim())) {
        lexicalBonus += 0.3;
      }

      const totalScore = Math.min(1.0, m.similarity * 0.7 + lexicalBonus);
      return {
        filePath: m.filePath,
        relevanceScore: Number(totalScore.toFixed(4)),
        snippet: m.snippet
      };
    });

    return scored
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, topK);
  }
}
