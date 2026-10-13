import { GeminiProvider } from '../providers/GeminiProvider.js';
import { DualLoopExecutor } from '../engine/DualLoopExecutor.js';
import { ModelRouter } from '../orchestrator/ModelRouter.js';
import { QueryEngine } from '../orchestrator/QueryEngine.js';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`[FAIL] ${msg}`);
    process.exit(1);
  }
  console.log(`[PASS] ${msg}`);
}

async function runTests() {
  console.log('--- TEST SUITE: Cognitive Reasoning, Thinking Budget & Model Routing ---');

  // 1. GeminiProvider model normalization
  const normalizedFlash = GeminiProvider.normalizeModelName('gemini-flash');
  assert(normalizedFlash === 'gemini-2.5-flash', 'gemini-flash maps to gemini-2.5-flash');

  const normalizedPro = GeminiProvider.normalizeModelName('gemini-pro');
  assert(normalizedPro === 'gemini-2.5-pro', 'gemini-pro maps to gemini-2.5-pro');

  const normalizedExact = GeminiProvider.normalizeModelName('gemini-3.8-flash');
  assert(normalizedExact === 'gemini-3.8-flash', 'Exact model name preserved');

  // 2. DualLoopExecutor model tier routing
  const fastClaude = DualLoopExecutor.selectModelTier(true, 'claude-3-7-sonnet');
  assert(fastClaude === 'claude-3-5-haiku-20241022', 'Exploration tier Claude routes to Haiku');

  const fastOpenAI = DualLoopExecutor.selectModelTier(true, 'gpt-4o');
  assert(fastOpenAI === 'gpt-4o-mini', 'Exploration tier OpenAI routes to gpt-4o-mini');

  const fastGemini = DualLoopExecutor.selectModelTier(true, 'gemini-2.5-pro');
  assert(fastGemini === 'gemini-2.5-flash', 'Exploration tier Gemini routes to 2.5-flash');

  const implTier = DualLoopExecutor.selectModelTier(false, 'claude-3-7-sonnet');
  assert(implTier === 'claude-3-7-sonnet', 'Implementation phase preserves requested model');

  // 3. ModelRouter task categorization for RESEARCH
  const routeResearch = ModelRouter.route({
    prompt: 'Tìm hiểu và tra cứu tài liệu thư viện TanStack Query v5',
  });
  assert(routeResearch.category === 'RESEARCH', 'Prompt with tra cứu/tìm hiểu routes to RESEARCH');
  assert(routeResearch.thinkingBudget === 4096, 'RESEARCH task receives thinking budget 4096');

  // 4. ModelRouter task categorization for REASONING
  const routeReasoning = ModelRouter.route({
    prompt: 'Investigate the root cause of deadlock and race condition across 6 modules',
    fileCount: 8,
  });
  assert(routeReasoning.category === 'REASONING', 'Complex multi-file architectural bug routes to REASONING');
  assert(routeReasoning.thinkingBudget === 8192, 'REASONING task receives high thinking budget 8192');

  // 5. QueryEngine base system prompt validation
  const qe = new QueryEngine({
    cwd: process.cwd(),
    model: 'gemini-2.5-flash',
    provider: 'gemini',
    permissionMode: 'default',
    maxTokens: 160000,
    resumeSession: false,
  });

  const fullPrompt = (qe as any).buildFullSystemContent() as string;
  assert(
    fullPrompt.includes('Cognitive Deliberate Reasoning Protocol'),
    'QueryEngine prompt must include Cognitive Deliberate Reasoning Protocol'
  );
  assert(
    fullPrompt.includes('Multi-Source Research & Empirical Synthesis Protocol'),
    'QueryEngine prompt must include Multi-Source Research Protocol'
  );
  assert(
    fullPrompt.includes('reach_web_search'),
    'QueryEngine prompt must reference reach_web_search tool'
  );
  assert(
    fullPrompt.includes('PREVENT NAME & ID COLLISIONS'),
    'QueryEngine prompt must enforce name & ID collision prevention'
  );
  assert(
    fullPrompt.includes('NO EVIDENCE, NO DONE'),
    'QueryEngine prompt must enforce empirical proof axiom'
  );

  console.log('All Cognitive Reasoning & Routing tests passed successfully!\n');
}

runTests().catch((err) => {
  console.error('[UNCAUGHT ERROR]:', err);
  process.exit(1);
});
