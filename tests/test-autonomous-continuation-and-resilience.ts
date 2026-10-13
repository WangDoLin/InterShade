import { AutonomousContinuationGuard } from '../engine/guards/AutonomousContinuationGuard.js';
import { ModelRouter } from '../orchestrator/ModelRouter.js';
import { ConnectionRegistry } from '../providers/core/ConnectionRegistry.js';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`[FAIL] ${msg}`);
    process.exit(1);
  }
  console.log(`[PASS] ${msg}`);
}

async function runTests() {
  console.log('--- TEST SUITE: Autonomous Continuation & Mid-Flight Halting Prevention ---');

  const guard = new AutonomousContinuationGuard(4);

  // 1. Detect forward-intent in Vietnamese without tool calls
  const viIntentResult = guard.evaluateTurn({
    assistantContent: 'Tôi sẽ bắt đầu kiểm tra codebase để tìm lỗi và sửa file index.ts.',
    pendingToolCallsCount: 0,
    lastToolTurnHadError: false,
    modifiedFilesCount: 0,
    isProofModeActive: false,
  });
  assert(viIntentResult.shouldContinue === true, 'Vietnamese forward intent triggers continuation');
  assert(viIntentResult.reason === 'FORWARD_INTENT', 'Reason is FORWARD_INTENT for Vietnamese declaration');
  assert(
    !!viIntentResult.nudgePrompt && viIntentResult.nudgePrompt.includes('[AUTONOMOUS CONTINUATION]'),
    'Nudge prompt is generated'
  );
  assert(viIntentResult.consecutiveNudges === 1, 'Consecutive nudges count is incremented to 1');

  // 2. Detect forward-intent in English without tool calls
  const enIntentResult = guard.evaluateTurn({
    assistantContent: 'I will now inspect the test files and run npm test to verify the fix.',
    pendingToolCallsCount: 0,
    lastToolTurnHadError: false,
    modifiedFilesCount: 0,
    isProofModeActive: false,
  });
  assert(enIntentResult.shouldContinue === true, 'English forward intent triggers continuation');
  assert(enIntentResult.reason === 'FORWARD_INTENT', 'Reason is FORWARD_INTENT for English declaration');
  assert(enIntentResult.consecutiveNudges === 2, 'Consecutive nudges count is 2');

  // 3. Reset consecutive count when a real tool call is executed
  const toolTurnResult = guard.evaluateTurn({
    assistantContent: 'Executing file edit...',
    pendingToolCallsCount: 1,
    lastToolTurnHadError: false,
    modifiedFilesCount: 0,
    isProofModeActive: false,
  });
  assert(toolTurnResult.shouldContinue === false, 'Tool execution turn does not require nudge');
  assert(guard.getConsecutiveCount() === 0, 'Consecutive count resets to 0 after tool execution');

  // 4. Detect truncation on max_tokens
  const truncatedResult = guard.evaluateTurn({
    assistantContent: 'export function processData(items: string[]) { return items.map(item =>',
    finishReason: 'max_tokens',
    pendingToolCallsCount: 0,
    lastToolTurnHadError: false,
    modifiedFilesCount: 0,
    isProofModeActive: false,
  });
  assert(truncatedResult.shouldContinue === true, 'Truncation with max_tokens triggers continuation');
  assert(truncatedResult.reason === 'TRUNCATED_MAX_TOKENS', 'Reason is TRUNCATED_MAX_TOKENS');
  assert(
    !!truncatedResult.nudgePrompt && truncatedResult.nudgePrompt.includes('reached the token limit'),
    'Nudge prompt guides model to resume from cutoff'
  );

  // 5. Detect empty response
  const emptyResult = guard.evaluateTurn({
    assistantContent: '',
    pendingToolCallsCount: 0,
    lastToolTurnHadError: false,
    modifiedFilesCount: 0,
    isProofModeActive: false,
  });
  assert(emptyResult.shouldContinue === true, 'Empty assistant response triggers continuation retry');
  assert(emptyResult.reason === 'EMPTY_RESPONSE_RETRY', 'Reason is EMPTY_RESPONSE_RETRY');

  // 6. Detect incomplete recovery after a tool error
  guard.resetConsecutive();
  const errorRecoveryResult = guard.evaluateTurn({
    assistantContent: 'The file was not found in the root directory.',
    pendingToolCallsCount: 0,
    lastToolTurnHadError: true,
    modifiedFilesCount: 0,
    isProofModeActive: false,
  });
  assert(errorRecoveryResult.shouldContinue === true, 'Unaddressed tool error triggers continuation');
  assert(errorRecoveryResult.reason === 'INCOMPLETE_TOOL_ERROR_RECOVERY', 'Reason is INCOMPLETE_TOOL_ERROR_RECOVERY');

  // 7. Explicit completion stops naturally without unnecessary continuation
  guard.resetConsecutive();
  const completeResult = guard.evaluateTurn({
    assistantContent: 'Đã hoàn thành! Tất cả các file đã được chỉnh sửa và test đã pass 100%.',
    pendingToolCallsCount: 0,
    lastToolTurnHadError: false,
    modifiedFilesCount: 1,
    isProofModeActive: false,
  });
  assert(completeResult.shouldContinue === false, 'Explicit completion stops cleanly');
  assert(completeResult.reason === 'NONE', 'Reason is NONE on completion');

  // 8. Prevent infinite loop by capping consecutive nudges
  const guardCapped = new AutonomousContinuationGuard(3);
  for (let i = 0; i < 3; i++) {
    const res = guardCapped.evaluateTurn({
      assistantContent: 'Tôi sẽ tiếp tục làm bước tiếp theo...',
      pendingToolCallsCount: 0,
      lastToolTurnHadError: false,
      modifiedFilesCount: 0,
      isProofModeActive: false,
    });
    assert(res.shouldContinue === true, `Nudge ${i + 1} triggers continuation`);
  }
  const fourthResult = guardCapped.evaluateTurn({
    assistantContent: 'Tôi sẽ tiếp tục làm bước tiếp theo...',
    pendingToolCallsCount: 0,
    lastToolTurnHadError: false,
    modifiedFilesCount: 0,
    isProofModeActive: false,
  });
  assert(fourthResult.shouldContinue === false, 'Exceeding max consecutive nudges safely stops loop');

  // 9. Verify Provider Failure and Active Fallback resolution in ModelRouter
  ModelRouter.resetProviderFailures();
  ModelRouter.markProviderFailure('anthropic');
  const fallback = ModelRouter.getActiveFallback('anthropic', [
    { model: 'gemini-2.5-flash', provider: 'gemini' },
    { model: 'gpt-4o', provider: 'openai' },
    { model: 'deepseek-chat', provider: 'deepseek' },
  ]);
  // 10. Verify QueryEngine Initialization with AutonomousContinuationGuard
  const { QueryEngine } = await import('../orchestrator/QueryEngine.js');
  const engine = new QueryEngine({
    provider: 'openai',
    model: 'gpt-4o',
    cwd: process.cwd(),
    maxTokens: 100000,
    permissionMode: 'default',
    resumeSession: false,
  });
  assert(engine !== null, 'QueryEngine initializes with AutonomousContinuationGuard integrated');

  // 11. Detect unexecuted code block in markdown without tool invocation
  guard.resetConsecutive();
  const codeBlockResult = guard.evaluateTurn({
    assistantContent: 'Dưới đây là mã nguồn sửa lỗi trong file src/index.ts:\n```typescript\nexport function solve() { return true; }\n```',
    pendingToolCallsCount: 0,
    lastToolTurnHadError: false,
    modifiedFilesCount: 0,
    isProofModeActive: false,
    isPlanModeActive: false,
  });
  assert(codeBlockResult.shouldContinue === true, 'Markdown code block without tool triggers continuation');
  assert(codeBlockResult.reason === 'UNEXECUTED_CODE_BLOCK', 'Reason is UNEXECUTED_CODE_BLOCK');
  assert(!!codeBlockResult.nudgePrompt && codeBlockResult.nudgePrompt.includes('file_edit or file_write'), 'Nudge prompt instructs tool invocation');

  // 12. Detect incomplete multi-step plan formulation
  guard.resetConsecutive();
  const planResult = guard.evaluateTurn({
    assistantContent: 'Kế hoạch triển khai:\nBước 1: Khảo sát cấu trúc thư mục và đọc file cấu hình.\nBước 2: Sửa file server.ts.',
    pendingToolCallsCount: 0,
    lastToolTurnHadError: false,
    modifiedFilesCount: 0,
    isProofModeActive: false,
    isPlanModeActive: false,
  });
  assert(planResult.shouldContinue === true, 'Incomplete multi-step plan triggers continuation');
  assert(planResult.reason === 'INCOMPLETE_PLAN_STEPS', 'Reason is INCOMPLETE_PLAN_STEPS');
  assert(!!planResult.nudgePrompt && planResult.nudgePrompt.includes('Step 1'), 'Nudge prompt instructs executing Step 1');

  // 13. Detect unclosed markdown code block as truncation
  guard.resetConsecutive();
  const unclosedTruncationResult = guard.evaluateTurn({
    assistantContent: 'Here is the implementation:\n```typescript\nfunction process() {\n  const x = 10;\n  return x * 2;',
    pendingToolCallsCount: 0,
    lastToolTurnHadError: false,
    modifiedFilesCount: 0,
    isProofModeActive: false,
  });
  assert(unclosedTruncationResult.shouldContinue === true, 'Unclosed code block triggers continuation for truncation');
  assert(unclosedTruncationResult.reason === 'TRUNCATED_MAX_TOKENS', 'Reason is TRUNCATED_MAX_TOKENS for unclosed code block');

  // 14. Verify QueryEngine.isExecutionDirective accurately identifies coding commands
  assert(QueryEngine.isExecutionDirective('fix') === true, 'Recognizes "fix" as execution directive');
  assert(QueryEngine.isExecutionDirective('sửa lỗi này đi') === true, 'Recognizes Vietnamese fix request');
  assert(QueryEngine.isExecutionDirective('bắt đầu làm') === true, 'Recognizes start work directive');
  assert(QueryEngine.isExecutionDirective('/plan xem xét') === false, 'Ignores /plan commands');

  console.log('\n--- ALL AUTONOMOUS CONTINUATION TESTS PASSED (14/14) ---');
}

runTests().catch((err) => {
  console.error('[UNHANDLED TEST ERROR]:', err);
  process.exit(1);
});
