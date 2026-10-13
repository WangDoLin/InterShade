import { ModelRouter } from '../orchestrator/ModelRouter.js';
import { FileReadTool, clearFileReadCache, getFileReadCacheSize } from '../tools/filesystem/FileReadTool.js';
import { CommandRegistry } from '../cli/commands/CommandRegistry.js';
import { fastCommand, thinkCommand, registerBuiltinCommands } from '../cli/commands/builtinCommands.js';
import { VerificationEvidenceCollector } from '../engine/VerificationEvidenceCollector.js';
import fs from 'fs';
import path from 'path';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`[FAIL] ${msg}`);
    process.exit(1);
  }
  console.log(`[PASS] ${msg}`);
}

async function runTests() {
  console.log('--- TEST SUITE: Speed, Latency, Thinking Tiers & In-Memory Caching ---');

  // 1. ModelRouter Speed Mode Override
  const fastRoute = ModelRouter.route({
    prompt: 'Implement a quick helper function for formatting timestamps',
    speedMode: 'fast',
  });
  assert(fastRoute.category === 'FAST', 'Explicit speedMode: fast routes to FAST category');
  assert(fastRoute.thinkingBudget === 0, 'Fast mode assigns thinkingBudget: 0 for instant generation');
  assert(fastRoute.rationale.includes('zero thinking'), 'Fast mode rationale explains zero thinking delay');

  // 2. ModelRouter Thinking Tier Override
  const thinkOffRoute = ModelRouter.route({
    prompt: 'Architectural refactor of state management system',
    fileCount: 10,
    thinkingTier: 'off',
  });
  assert(thinkOffRoute.category === 'FAST', 'thinkingTier: off overrides deep reasoning to FAST');
  assert(thinkOffRoute.thinkingBudget === 0, 'thinkingTier: off sets thinkingBudget to 0');

  // 3. Slash Command: /fast
  const sessionState: Record<string, unknown> = {
    id: 'test-session-speed',
    model: 'claude-3-7-sonnet',
    provider: 'anthropic',
    permissionMode: 'default',
  };

  const reg = new CommandRegistry();
  registerBuiltinCommands(reg);

  // Toggle fast on
  const resFastOn = await fastCommand.execute({
    cwd: process.cwd(),
    args: ['on'],
    sessionState,
  });
  assert(sessionState.speedMode === 'fast', 'Command /fast on sets speedMode to fast');
  assert(sessionState.thinkingBudget === 0, 'Command /fast on sets thinkingBudget to 0');
  assert(typeof resFastOn === 'string' && resFastOn.includes('[FAST MODE ON]'), 'Returns FAST MODE ON notice');

  // Toggle fast off
  const resFastOff = await fastCommand.execute({
    cwd: process.cwd(),
    args: ['off'],
    sessionState,
  });
  assert(sessionState.speedMode === 'normal', 'Command /fast off restores normal speedMode');
  assert(typeof resFastOff === 'string' && resFastOff.includes('[FAST MODE OFF]'), 'Returns FAST MODE OFF notice');

  // 4. Slash Command: /think
  await thinkCommand.execute({
    cwd: process.cwd(),
    args: ['low'],
    sessionState,
  });
  assert(sessionState.thinkingBudget === 1024, '/think low sets thinkingBudget to 1024');

  await thinkCommand.execute({
    cwd: process.cwd(),
    args: ['high'],
    sessionState,
  });
  assert(sessionState.thinkingBudget === 8192, '/think high sets thinkingBudget to 8192');

  await thinkCommand.execute({
    cwd: process.cwd(),
    args: ['off'],
    sessionState,
  });
  assert(sessionState.thinkingBudget === 0, '/think off sets thinkingBudget to 0');

  await thinkCommand.execute({
    cwd: process.cwd(),
    args: ['2500'],
    sessionState,
  });
  assert(sessionState.thinkingBudget === 2500, '/think 2500 sets custom budget to 2500');

  // 5. Verification Gate Bypass Evaluation
  const collector = new VerificationEvidenceCollector();
  const evaluationInitial = collector.evaluateReadiness();
  assert(evaluationInitial.readyToConclude === true, 'No files modified means task is ready to conclude without typecheck');
  assert(collector.getModifiedFiles().length === 0, 'Initial modified files is empty');

  // If a file was modified, readiness requires typecheck
  collector.recordFileModification('src/test.ts');
  const evaluationAfterMod = collector.evaluateReadiness();
  assert(evaluationAfterMod.readyToConclude === false, 'Modified files require typecheck before concluding');

  // 6. FileReadTool In-Memory Caching
  clearFileReadCache();
  assert(getFileReadCacheSize() === 0, 'FileRead cache starts empty after clearFileReadCache()');

  const testFilePath = path.join(process.cwd(), 'temp-speed-cache-test.txt');
  fs.writeFileSync(testFilePath, 'Line 1: Alpha\nLine 2: Beta\nLine 3: Gamma\nLine 4: Delta', 'utf-8');

  try {
    const fileReadTool = new FileReadTool();
    const mockContext = {
      sessionId: 'test-session',
      cwd: process.cwd(),
      permissionMode: 'default' as const,
    };

    // First read -> loads from disk and populates cache
    const read1 = await fileReadTool.execute({ filePath: testFilePath }, mockContext);
    assert(read1.includes('Line 1: Alpha') && read1.includes('Line 4: Delta'), 'First read returns file contents');
    assert(getFileReadCacheSize() === 1, 'File is now cached in memory');

    // Second read -> resolves from in-memory cache
    const read2 = await fileReadTool.execute({ filePath: testFilePath, offset: 2, limit: 2 }, mockContext);
    assert(read2.includes('Line 2: Beta') && read2.includes('Line 3: Gamma'), 'Second read slice matches expected content');
    assert(!read2.includes('Line 1: Alpha'), 'Second read slice properly excludes offset');

    // Update file content -> mtime changes -> cache updates seamlessly
    await new Promise((r) => setTimeout(r, 50));
    fs.writeFileSync(testFilePath, 'Line 1: Updated\nLine 2: Fresh', 'utf-8');

    const read3 = await fileReadTool.execute({ filePath: testFilePath }, mockContext);
    assert(read3.includes('Line 1: Updated'), 'Cache automatically invalidates and returns fresh content on mtime change');
  } finally {
    if (fs.existsSync(testFilePath)) {
      try {
        fs.unlinkSync(testFilePath);
      } catch {
        await new Promise((r) => setTimeout(r, 100));
        try {
          if (fs.existsSync(testFilePath)) {
            fs.unlinkSync(testFilePath);
          }
        } catch {
          // Ignore Windows file handle delay in test cleanup
        }
      }
    }
    clearFileReadCache();
  }

  console.log('--- ALL SPEED AND CACHING OPTIMIZATION TESTS PASSED! ---');
}

runTests().catch((err) => {
  console.error('[UNHANDLED TEST ERROR]:', err);
  process.exit(1);
});
