import { GrepTool } from '../tools/search/GrepTool.js';
import type { ToolExecutionContext } from '../types/index.js';
import path from 'path';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`[FAIL] ${msg}`);
    process.exit(1);
  }
  console.log(`[PASS] ${msg}`);
}

async function runBenchmark() {
  console.log('--- TEST & BENCHMARK: Optimized GrepTool ---');

  const grep = new GrepTool();
  const context: ToolExecutionContext = {
    sessionId: 'test-grep-session',
    cwd: path.resolve('.'),
    permissionMode: 'bypass' as any,
  };

  // Test 1: Query finding known symbols with Git Grep / Ripper
  console.log('1. Searching for "GrepTool" across codebase...');
  const t0 = performance.now();
  const res1 = await grep.execute({ query: 'GrepTool' }, context);
  const elapsed1 = performance.now() - t0;
  console.log(`Result:\n${res1}`);
  console.log(`Time taken: ${elapsed1.toFixed(2)}ms`);

  assert(res1.includes('GrepTool.ts'), 'Must find matches in GrepTool.ts');
  assert(res1.includes('ToolRegistry.ts'), 'Must find matches in ToolRegistry.ts');
  assert(elapsed1 < 2000, `Search should complete rapidly (took ${elapsed1.toFixed(2)}ms)`);

  // Test 2: Case-insensitive search
  console.log('\n2. Testing case-insensitive search for "greptool"...');
  const t1 = performance.now();
  const res2 = await grep.execute({ query: 'greptool', caseInsensitive: true }, context);
  const elapsed2 = performance.now() - t1;
  console.log(`Time taken: ${elapsed2.toFixed(2)}ms`);
  assert(res2.includes('GrepTool'), 'Must find matches regardless of casing');

  // Test 3: Path pattern filter
  console.log('\n3. Testing pathPattern filter "*.ts"...');
  const res3 = await grep.execute({ query: 'BaseTool', pathPattern: '*.ts' }, context);
  assert(res3.includes('GrepTool.ts') || res3.includes('BaseTool.ts'), 'Must find matches in .ts files');

  // Test 4: Single file search
  console.log('\n4. Testing single file search...');
  const t3 = performance.now();
  const res4 = await grep.execute({ query: 'DEFAULT_MAX_RESULTS', path: 'tools/search/GrepTool.ts' }, context);
  const elapsed4 = performance.now() - t3;
  console.log(`Time taken: ${elapsed4.toFixed(2)}ms`);
  assert(res4.includes('DEFAULT_MAX_RESULTS'), 'Must find match in single file');
  assert(elapsed4 < 100, `Single file search should take < 100ms (took ${elapsed4.toFixed(2)}ms)`);

  // Test 5: No match handling
  console.log('\n5. Testing no-match search...');
  const res5 = await grep.execute({ query: 'ThisStringDefinitelyDoesNotExistInTheCodebase12345' }, context);
  assert(res5.includes('No matches found for'), 'Must return standard no match notice');

  console.log('\n>>> All GrepTool performance and correctness tests PASSED! <<<');
}

runBenchmark().catch((err) => {
  console.error('[UNCAUGHT ERROR]', err);
  process.exit(1);
});
