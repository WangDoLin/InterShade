import assert from 'assert';
import { randomUUID } from 'crypto';
import { PlanManager, type PlanStep } from '../state/PlanManager.js';
import { PlanModeTool } from '../tools/agentic/PlanModeTool.js';
import { planCommand } from '../cli/commands/builtinCommands.js';
import type { ToolExecutionContext } from '../types/index.js';

console.log('=== TEST SUITE: Plan Evolution & Incremental Plan Merging ===\n');

const testSessionId = `test-plan-session-${randomUUID()}`;

// ----------------------------------------------------------------------------
// Test 1: PlanManager.createOrReplacePlan (Version 1 Initial Formulation)
// ----------------------------------------------------------------------------
console.log('[Test 1] PlanManager: Create initial plan (v1)');
{
  const initialPlan = PlanManager.createOrReplacePlan(testSessionId, {
    title: 'User Authentication Architecture',
    overview: 'Implement secure JWT-based login and user profile system',
    steps: [
      {
        id: '1',
        title: 'User Database Migration',
        description: 'Create users table with email, password_hash, and timestamps',
        targetFiles: ['db/migrations/001_users.sql'],
        status: 'pending',
      },
      {
        id: '2',
        title: 'Authentication Service',
        description: 'Provide password hashing and credential validation',
        targetFiles: ['src/services/authService.ts'],
        status: 'pending',
      },
      {
        id: '3',
        title: 'Login API Route',
        description: 'POST /api/login endpoint with request schema validation',
        targetFiles: ['src/api/routes/login.ts'],
        status: 'pending',
      },
    ],
    acceptanceCriteria: [
      'Migration runs up and down cleanly',
      'Valid credentials return auth tokens',
      'Invalid password returns 401 Unauthorized',
    ],
  });

  assert.strictEqual(initialPlan.currentVersion, 1);
  assert.strictEqual(initialPlan.steps.length, 3);
  assert.strictEqual(initialPlan.steps[0].changeType, 'new');
  assert.strictEqual(initialPlan.revisions.length, 1);
  assert.strictEqual(initialPlan.acceptanceCriteria.length, 3);

  // Verification from persistence
  const retrieved = PlanManager.getActivePlan(testSessionId);
  assert.notStrictEqual(retrieved, null);
  assert.strictEqual(retrieved?.currentVersion, 1);
  assert.strictEqual(retrieved?.title, 'User Authentication Architecture');
  console.log('  ✔ Successfully created and persisted initial plan v1 with 3 steps.');
}

// ----------------------------------------------------------------------------
// Test 2: PlanManager.mergePlan (Incremental Update: Add & Modify Steps)
// ----------------------------------------------------------------------------
console.log('\n[Test 2] PlanManager: Incremental merge when user adds or modifies steps (v1 -> v2)');
{
  // User says: "Thêm chức năng gửi email xác thực và thay đổi bước 2 thành dùng JWT"
  const mergedPlan = PlanManager.mergePlan(testSessionId, {
    title: 'User Authentication Architecture (JWT & Email Verification)',
    additionsOrChangesText: 'Thêm email verification và đổi auth service sang JWT tokens',
    steps: [
      // Step 1 is omitted here to test partial delta retention or provided as unchanged
      {
        id: '2',
        title: 'JWT Authentication Service',
        description: 'Generate signed JWT tokens with 15m expiration and refresh rotation',
        targetFiles: ['src/services/authService.ts', 'src/services/jwtService.ts'],
        status: 'pending',
      },
      {
        id: '4',
        title: 'Email Verification Service',
        description: 'Send verification token via SMTP / Resend and handle verification link',
        targetFiles: ['src/services/emailService.ts', 'src/api/routes/verify.ts'],
        status: 'pending',
      },
    ],
    acceptanceCriteria: [
      'Signed JWT tokens verified with public key',
      'Email verification link expires after 24h',
    ],
  });

  assert.strictEqual(mergedPlan.currentVersion, 2);
  assert.strictEqual(mergedPlan.revisions.length, 2);

  // Verify that Step 1 and Step 3 were preserved from v1 as UNCHANGED
  const step1 = mergedPlan.steps.find((s) => s.id === '1');
  assert.notStrictEqual(step1, undefined);
  assert.strictEqual(step1?.title, 'User Database Migration');
  assert.strictEqual(step1?.changeType, 'unchanged');

  const step3 = mergedPlan.steps.find((s) => s.id === '3');
  assert.notStrictEqual(step3, undefined);
  assert.strictEqual(step3?.title, 'Login API Route');
  assert.strictEqual(step3?.changeType, 'unchanged');

  // Verify that Step 2 was UPDATED
  const step2 = mergedPlan.steps.find((s) => s.id === '2');
  assert.notStrictEqual(step2, undefined);
  assert.strictEqual(step2?.title, 'JWT Authentication Service');
  assert.strictEqual(step2?.changeType, 'modified');
  assert.ok(step2?.targetFiles?.includes('src/services/jwtService.ts'));

  // Verify that Step 4 was ADDED as NEW
  const step4 = mergedPlan.steps.find((s) => s.id === '4');
  assert.notStrictEqual(step4, undefined);
  assert.strictEqual(step4?.title, 'Email Verification Service');
  assert.strictEqual(step4?.changeType, 'new');

  // Verify merged acceptance criteria
  assert.ok(mergedPlan.acceptanceCriteria.length >= 4);

  // Verify changelog entries
  const latestRev = mergedPlan.revisions[1];
  assert.ok(latestRev.changelog.some((c) => c.includes('[UPDATED] Step 2')));
  assert.ok(latestRev.changelog.some((c) => c.includes('[NEW] Step 4')));
  assert.ok(latestRev.changelog.some((c) => c.includes('[UNCHANGED] Step 1')));
  console.log('  ✔ Seamlessly merged additions and modifications while preserving existing steps.');
}

// ----------------------------------------------------------------------------
// Test 3: PlanManager.formatPlanMarkdown Formatting
// ----------------------------------------------------------------------------
console.log('\n[Test 3] PlanManager: formatPlanMarkdown readability & changelog tags');
{
  const activePlan = PlanManager.getActivePlan(testSessionId)!;
  const markdown = PlanManager.formatPlanMarkdown(activePlan, { showChangelog: true });

  assert.ok(markdown.includes('# Architecture Plan:'));
  assert.ok(markdown.includes('(v2)'));
  assert.ok(markdown.includes('### Plan Changelog (v2 vs v1):'));
  assert.ok(markdown.includes('[UPDATED]'));
  assert.ok(markdown.includes('[NEW]'));
  assert.ok(markdown.includes('[UNCHANGED]'));
  assert.ok(markdown.includes('### Verification & Acceptance Criteria:'));
  console.log('  ✔ Markdown formatted with clear revision changelog tags and criteria checklists.');
}

// ----------------------------------------------------------------------------
// Test 4: PlanManager.extractPlanFromText (English and Vietnamese LLM output)
// ----------------------------------------------------------------------------
console.log('\n[Test 4] PlanManager: extractPlanFromText auto-parsing');
{
  const enMarkdown = `
# Architecture Plan: Rate Limiting System

## Implementation Steps
1. [NEW] Token Bucket Algorithm Implementation
   - Target files: src/security/tokenBucket.ts
   - Details: Implement in-memory token bucket with sliding window
2. [UNCHANGED] Redis Middleware Integration
   - Target files: src/middleware/rateLimit.ts
   - Details: Connect to Redis cluster for distributed limits
3. [NEW] HTTP 429 Retry-After Headers
   - Target files: src/api/errors.ts
   - Details: Add standards-compliant retry headers

## Acceptance Criteria
- [ ] Conforms to RFC 6585
- [ ] Returns 429 when bucket exhausted
`;

  const parsedEn = PlanManager.extractPlanFromText(enMarkdown);
  assert.notStrictEqual(parsedEn, null);
  assert.strictEqual(parsedEn?.title, 'Rate Limiting System');
  assert.strictEqual(parsedEn?.steps.length, 3);
  assert.strictEqual(parsedEn?.steps[0].title, 'Token Bucket Algorithm Implementation');
  assert.ok(parsedEn?.steps[0].targetFiles?.includes('src/security/tokenBucket.ts'));
  assert.strictEqual(parsedEn?.acceptanceCriteria?.length, 2);

  const viMarkdown = `
# Kế hoạch triển khai: Hệ thống phân quyền người dùng (RBAC)

### Các bước thực hiện:
1. Bước 1: Khởi tạo bảng Role và Permission
   - Tệp tin: db/migrations/002_rbac.sql
   - Chi tiết: Tạo các bảng quan hệ N-N giữa User và Role
2. Bước 2: Middleware kiểm tra quyền hạn (Authorize Guard)
   - Tệp tin: src/guards/rbacGuard.ts
   - Chi tiết: Chặn các request không có đủ quyền trong token
3. Bước 3: Viết bộ kiểm thử phân quyền
   - Tệp tin: tests/rbac.test.ts
   - Chi tiết: Test quyền admin, user, và khách

### Tiêu chí nghiệm thu:
- [ ] Không ai truy cập được route admin nếu thiếu role Admin
- [ ] Toàn bộ unit tests pass
`;

  const parsedVi = PlanManager.extractPlanFromText(viMarkdown);
  assert.notStrictEqual(parsedVi, null);
  assert.strictEqual(parsedVi?.steps.length, 3);
  assert.ok(parsedVi?.steps[0].targetFiles?.includes('db/migrations/002_rbac.sql'));
  assert.strictEqual(parsedVi?.acceptanceCriteria?.length, 2);

  console.log('  ✔ Accurate extraction from both English and Vietnamese LLM response formats.');
}

// ----------------------------------------------------------------------------
// Test 5: PlanModeTool (Agent Tool Invocation)
// ----------------------------------------------------------------------------
console.log('\n[Test 5] PlanModeTool: Tool lifecycle execution');
{
  const tool = new PlanModeTool();
  let confirmationResult = false;
  const mockContext: ToolExecutionContext = {
    sessionId: `test-tool-${randomUUID()}`,
    cwd: process.cwd(),
    permissionMode: 'default',
    askConfirmation: async () => confirmationResult,
  };

  // 1. Enter Plan Mode
  const enterRes = await tool.execute({ action: 'enter' }, mockContext);
  assert.strictEqual(mockContext.permissionMode, 'plan');
  assert.ok(enterRes.includes('[PLAN MODE ON]'));

  // 2. Create Plan
  const createRes = await tool.execute(
    {
      action: 'create',
      planTitle: 'Microservice Refactor',
      planSteps: [
        { id: '1', title: 'Extract Payment Client', targetFiles: ['src/payment/client.ts'] },
        { id: '2', title: 'Add Circuit Breaker', targetFiles: ['src/payment/breaker.ts'] },
      ],
    },
    mockContext
  );
  assert.ok(createRes.includes('[PLAN CREATED (v1)]'));

  // 3. Update Plan (Incremental Merge)
  const updateRes = await tool.execute(
    {
      action: 'update',
      changesDescription: 'Add webhook verification step',
      planSteps: [
        { id: '3', title: 'Webhook Signature Verification', targetFiles: ['src/payment/webhook.ts'] },
      ],
    },
    mockContext
  );
  assert.ok(updateRes.includes('[PLAN UPDATED & MERGED (v2)]'));
  assert.ok(updateRes.includes('[NEW]'));

  // 4. View Plan
  const viewRes = await tool.execute({ action: 'view' }, mockContext);
  assert.ok(viewRes.includes('# Architecture Plan: Microservice Refactor (v2)'));

  // 5a. Exit Plan Mode without approval -> Must remain in Plan Mode
  confirmationResult = false;
  const declineRes = await tool.execute({ action: 'exit' }, mockContext);
  assert.strictEqual(mockContext.permissionMode, 'plan');
  assert.ok(declineRes.includes('[PLAN MODE REMAIN ACTIVE]'));

  // 5b. Exit Plan Mode with user approval -> Transitions to default Execution Mode
  confirmationResult = true;
  const exitRes = await tool.execute({ action: 'exit' }, mockContext);
  assert.strictEqual(mockContext.permissionMode, 'default');
  assert.ok(exitRes.includes('[PLAN MODE OFF]'));

  console.log('  ✔ PlanModeTool handles enter, create, update (merge), view, and exit cleanly.');
}

// ----------------------------------------------------------------------------
// Test 6: planCommand Slash Command (CLI integration)
// ----------------------------------------------------------------------------
console.log('\n[Test 6] planCommand: CLI slash command view and reset');
{
  const cliSessionId = `test-cli-${randomUUID()}`;
  PlanManager.createOrReplacePlan(cliSessionId, {
    title: 'CLI Test Plan',
    steps: [{ id: '1', title: 'CLI Step 1' }, { id: '2', title: 'CLI Step 2' }],
  });

  const state: Record<string, unknown> = {
    id: cliSessionId,
    permissionMode: 'default',
  };

  // 1. /plan view
  const viewOutput = await planCommand.execute({
    cwd: process.cwd(),
    sessionState: state as any,
    args: ['view'],
  });
  assert.ok(viewOutput.includes('# Architecture Plan: CLI Test Plan (v1)'));

  // 2. /plan reset
  const resetOutput = await planCommand.execute({
    cwd: process.cwd(),
    sessionState: state as any,
    args: ['reset'],
  });
  assert.ok(resetOutput.includes('[PLAN RESET]'));
  assert.strictEqual(PlanManager.getActivePlan(cliSessionId), null);

  // 3. /plan (toggle)
  const toggleOn = await planCommand.execute({
    cwd: process.cwd(),
    sessionState: state as any,
    args: [],
  });
  assert.strictEqual(state.permissionMode, 'plan');
  assert.ok(toggleOn.includes('[PLAN MODE ON]'));

  console.log('  ✔ planCommand slash command view, reset, and toggle work as expected.');
}

console.log('\n===============================================================');
console.log('🎉 ALL PLAN MERGING & EVOLUTION TESTS PASSED (6/6 PASS)');
console.log('===============================================================');
