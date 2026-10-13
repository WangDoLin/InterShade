import { QueryEngine } from '../orchestrator/QueryEngine.js';
import { DualLoopExecutor } from '../engine/DualLoopExecutor.js';
import { ModelRouter } from '../orchestrator/ModelRouter.js';

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    console.error(`[FAIL] ${msg}`);
    process.exit(1);
  }
  console.log(`[PASS] ${msg}`);
}

async function runTests(): Promise<void> {
  console.log('--- TEST SUITE: Surgical Bug-Fixing Focus & Anti-Wandering Guard ---');

  // 1. QueryEngine.isSurgicalFixOrTargetedPrompt classification
  const userExactPrompt =
    'fix lỗi khi tôi bảo lỗi gì đó thì agent không đi vào trọng tâm mà cứ lân la đi dạo quanh các chỗ khác mà không đi đúng vào lỗi tôi bảo';
  assert(
    QueryEngine.isSurgicalFixOrTargetedPrompt(userExactPrompt),
    'User reported bug prompt must be classified as surgical bug fix'
  );

  const combatBugPrompt = 'sửa lỗi crash khi tính toán lực chiến trong cogs/combat/combat.py';
  assert(
    QueryEngine.isSurgicalFixOrTargetedPrompt(combatBugPrompt),
    'Vietnamese prompt with sửa lỗi and file path must be classified as surgical task'
  );

  const fileRefPrompt = 'cập nhật logic trong utils.py:3604';
  assert(
    QueryEngine.isSurgicalFixOrTargetedPrompt(fileRefPrompt),
    'Prompt referencing specific file path must be classified as surgical task'
  );

  const englishBugPrompt = 'fix null pointer exception when player health drops to zero';
  assert(
    QueryEngine.isSurgicalFixOrTargetedPrompt(englishBugPrompt),
    'English bug fix prompt must be classified as surgical task'
  );

  const openExplorationPrompt = 'giới thiệu tổng quan về cấu trúc các thư mục trong repository này';
  assert(
    !QueryEngine.isSurgicalFixOrTargetedPrompt(openExplorationPrompt),
    'Open exploration prompt must not be classified as surgical task'
  );

  const casualChatPrompt = 'hôm nay thời tiết đẹp quá bạn ơi';
  assert(
    !QueryEngine.isSurgicalFixOrTargetedPrompt(casualChatPrompt),
    'Casual conversational prompt must not be classified as surgical task'
  );

  // 2. DualLoopExecutor preservation of primary reasoning model for surgical tasks
  const sonnetModel = 'claude-3-7-sonnet';
  const gptModel = 'gpt-4o';
  const geminiModel = 'gemini-2.5-pro';

  // In generic exploration phase without surgical flag, models downgrade to fast explorers
  const downgradedSonnet = DualLoopExecutor.selectModelTier(true, sonnetModel, false);
  assert(
    downgradedSonnet === 'claude-3-5-haiku-20241022',
    'Generic exploration phase routes Claude to fast Haiku'
  );

  // When surgical task is active, primary reasoning model is preserved even during exploration
  const surgicalSonnet = DualLoopExecutor.selectModelTier(true, sonnetModel, true);
  assert(
    surgicalSonnet === sonnetModel,
    'Surgical task preserves primary Claude 3.7 Sonnet model'
  );

  const surgicalGpt = DualLoopExecutor.selectModelTier(true, gptModel, true);
  assert(
    surgicalGpt === gptModel,
    'Surgical task preserves primary GPT-4o model'
  );

  const surgicalGemini = DualLoopExecutor.selectModelTier(true, geminiModel, true);
  assert(
    surgicalGemini === geminiModel,
    'Surgical task preserves primary Gemini 2.5 Pro model'
  );

  // When exploration phase is false, requested model is always preserved
  const directImplSonnet = DualLoopExecutor.selectModelTier(false, sonnetModel);
  assert(
    directImplSonnet === sonnetModel,
    'Implementation phase preserves requested model'
  );

  // 3. System prompt verification in QueryEngine
  const qe = new QueryEngine({
    cwd: process.cwd(),
    model: 'claude-3-7-sonnet',
    provider: 'anthropic',
    permissionMode: 'default',
    maxTokens: 160000,
    resumeSession: false,
  });

  const fullPrompt = (qe as unknown as { buildFullSystemContent: () => string }).buildFullSystemContent();

  assert(
    fullPrompt.includes('Surgical Bug-Fixing & Pinpoint Focus Protocol'),
    'Prompt must include Surgical Bug-Fixing & Pinpoint Focus Protocol'
  );
  assert(
    fullPrompt.includes('STRICT PROHIBITION ON WANDERING'),
    'Prompt must enforce strict prohibition on wandering'
  );
  assert(
    fullPrompt.includes('MAXIMUM 1-2 TARGETED INSPECTIONS'),
    'Prompt must enforce maximum 1-2 targeted inspections limit'
  );
  assert(
    fullPrompt.includes('GO DIRECTLY TO THE SOURCE'),
    'Prompt must instruct agent to go directly to the source'
  );

  // 4. ModelRouter task categorization
  const routeVnBug = ModelRouter.route({
    prompt: 'sửa lỗi crash khi người chơi tung chiêu trong combat.py',
  });
  assert(
    routeVnBug.category === 'CODING' || routeVnBug.category === 'REASONING',
    'Vietnamese bug fix prompt must route to CODING or REASONING, never FAST'
  );

  const routeExplain = ModelRouter.route({
    prompt: 'giải thích khái niệm dependency injection là gì',
  });
  assert(
    routeExplain.category === 'FAST',
    'Pure conceptual explanation prompt routes to FAST'
  );

  console.log('All Surgical Bug-Fixing Focus & Anti-Wandering tests passed successfully!\n');
}

runTests().catch((err) => {
  console.error('[UNCAUGHT TEST ERROR]:', err);
  process.exit(1);
});
