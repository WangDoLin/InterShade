export class CacheEfficiencyMetric {
  calculateSavings(staticTokens: number, dynamicTokens: number, turns: number): { totalWithoutCache: number; totalWithCache: number; tokensSaved: number; savingsRatio: number } {
    const totalWithoutCache = (staticTokens + dynamicTokens) * turns;
    const totalWithCache = staticTokens + (dynamicTokens * turns);
    const tokensSaved = totalWithoutCache - totalWithCache;
    const savingsRatio = totalWithoutCache > 0 ? tokensSaved / totalWithoutCache : 0;

    return { totalWithoutCache, totalWithCache, tokensSaved, savingsRatio };
  }

  evaluateQuality(savingsRatio: number): 'LOW' | 'MEDIUM' | 'HIGH' {
    if (savingsRatio >= 0.7) return 'HIGH';
    if (savingsRatio >= 0.3) return 'MEDIUM';
    return 'LOW';
  }
}
