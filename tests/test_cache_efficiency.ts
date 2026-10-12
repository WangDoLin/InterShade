import { CacheEfficiencyMetric } from '../context/CacheEfficiencyMetric.js';
import assert from 'node:assert';

const metric = new CacheEfficiencyMetric();

// Scenario 1: turns = 1
const res1 = metric.calculateSavings(1000, 100, 1);
assert.strictEqual(res1.tokensSaved, 0);
assert.strictEqual(metric.evaluateQuality(res1.savingsRatio), 'LOW');

// Scenario 2: turns = 10
const res2 = metric.calculateSavings(1000, 100, 10);
// Without: (1000 + 100) * 10 = 11000
// With: 1000 + (100 * 10) = 2000
// Saved: 9000
assert.strictEqual(res2.tokensSaved, 9000);
assert.strictEqual(metric.evaluateQuality(res2.savingsRatio), 'HIGH');

// Scenario 3: dynamicTokens = 0
const res3 = metric.calculateSavings(1000, 0, 5);
// Without: 1000 * 5 = 5000
// With: 1000 + 0 = 1000
// Saved: 4000
assert.strictEqual(res3.tokensSaved, 4000);
assert.strictEqual(metric.evaluateQuality(res3.savingsRatio), 'HIGH');

console.log('All tests passed!');
