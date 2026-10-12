import assert from 'assert';
import { ProviderContractSuite } from '../providers/testing/ProviderContractSuite.js';

console.log('[TEST]: Starting Provider & Model Gateway v2.0 Contract Suite (Phases P0, P1, P2, P4)...');

async function main() {
  const result = await ProviderContractSuite.runAll();

  for (const detail of result.details) {
    console.log(`  ${detail}`);
  }

  console.log(`\n[SUMMARY]: Passed: ${result.passed}, Failed: ${result.failed}`);
  assert.strictEqual(result.failed, 0, `Expected 0 failures, got ${result.failed}`);
  assert.strictEqual(result.passed, 12, `Expected 12 passing contract tests, got ${result.passed}`);

  console.log('[SUCCESS]: Provider & Model Gateway v2.0 (Phases P0, P1, P2, P4) Contract Suite PASSED 100%!');
}

main().catch((err) => {
  console.error('[ERROR]: Test execution failed:', err);
  process.exit(1);
});
