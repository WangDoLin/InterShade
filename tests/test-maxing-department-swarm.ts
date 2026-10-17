import assert from 'node:assert';
import { DepartmentBlackboard } from '../engine/swarm/DepartmentBlackboard.js';
import { SwarmCoordinator } from '../engine/swarm/SwarmCoordinator.js';
import { SwarmDepartmentCoordinator } from '../engine/swarm/SwarmDepartmentCoordinator.js';
import { MaxingDepartmentTool } from '../tools/agentic/MaxingDepartmentTool.js';
import { CommandRegistry } from '../cli/commands/CommandRegistry.js';
import { registerBuiltinCommands, maxingCommand } from '../cli/commands/builtinCommands.js';
import { QueryEngine } from '../orchestrator/QueryEngine.js';
import type { DepartmentContract, SwarmRole } from '../engine/swarm/SwarmTypes.js';

async function runMaxingDepartmentSwarmTestSuite(): Promise<void> {
  console.log('================================================================');
  console.log(' INTERSHADE MAXING MODE & DEPARTMENT SWARM TEST SUITE           ');
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // Test 1: DepartmentBlackboard Memory & Contract Exchange
  // -------------------------------------------------------------
  console.log('=== TEST 1: DEPARTMENT BLACKBOARD REAL-TIME TRANSACTIONAL MEMORY ===');
  const blackboard = DepartmentBlackboard.getInstance();
  blackboard.clear();

  let contractEventTriggered = false;
  let entryEventTriggered = false;

  blackboard.once('contract_published', (contract: DepartmentContract) => {
    contractEventTriggered = true;
    assert.strictEqual(contract.name, 'AuthInterface');
  });

  blackboard.once('entry_posted', (entry) => {
    entryEventTriggered = true;
    assert.strictEqual(entry.key, 'contract:AuthInterface');
  });

  const testContract: DepartmentContract = {
    id: 'contract-auth-101',
    name: 'AuthInterface',
    sourceRole: 'architect',
    targetRoles: ['backend', 'frontend', 'tester'],
    interfaceCode: 'export interface UserToken { token: string; exp: number; }',
    publishedAt: Date.now(),
  };

  blackboard.publishContract(testContract);
  assert.ok(contractEventTriggered, 'Contract published event must fire');
  assert.ok(entryEventTriggered, 'Entry posted event must fire');

  const retrievedContract = blackboard.getContract('AuthInterface');
  assert.ok(retrievedContract, 'Must retrieve contract by name');
  assert.strictEqual(retrievedContract.sourceRole, 'architect');
  assert.strictEqual(blackboard.getContracts().length, 1);

  // Post findings entry
  blackboard.postEntry({
    key: 'security:cve-check-01',
    category: 'security_finding',
    authorRole: 'security',
    data: { vulnerabilities: 0, auditedPackages: 42 },
  });

  const secEntry = blackboard.getEntry('security:cve-check-01');
  assert.ok(secEntry, 'Must retrieve posted blackboard entry');
  assert.strictEqual(secEntry.authorRole, 'security');

  const allFindings = blackboard.getEntries('security_finding');
  assert.strictEqual(allFindings.length, 1);
  assert.strictEqual(allFindings[0].key, 'security:cve-check-01');

  const digest = blackboard.getDigest();
  console.log('Blackboard Digest Preview:\n', digest, '\n');
  assert.ok(digest.includes('AuthInterface'), 'Digest must include published contract');
  assert.ok(digest.includes('security:cve-check-01'), 'Digest must include findings entry');
  console.log('[PASS] DepartmentBlackboard contract & shared entry operations verified.');

  // -------------------------------------------------------------
  // Test 2: SwarmCoordinator Role Inference (Security & Research)
  // -------------------------------------------------------------
  console.log('\n=== TEST 2: SWARM COORDINATOR EXPANDED ROLE INFERENCE ===');

  // Test Security desk inference
  const secRole = SwarmCoordinator.inferRoleAndScope('Audit CVE vulnerabilities in package.json and license risks');
  assert.strictEqual(secRole.role, 'security', 'Should infer security role for cve audit task');
  assert.ok(secRole.scope.includes('package.json'), 'Security role scope includes package.json');

  // Test Research desk inference
  const resRole = SwarmCoordinator.inferRoleAndScope('Conduct literature research on arxiv and openalex for state of the art models');
  assert.strictEqual(resRole.role, 'research', 'Should infer research role for literature task');
  assert.ok(resRole.scope.includes('research/**'), 'Research role scope includes research/**');

  // Test Frontend desk inference
  const feRole = SwarmCoordinator.inferRoleAndScope('Build responsive React UI dashboard with Tailwind CSS');
  assert.strictEqual(feRole.role, 'frontend', 'Should infer frontend role for UI task');

  // Test Backend desk inference
  const beRole = SwarmCoordinator.inferRoleAndScope('Implement GraphQL API server with Postgres database schema');
  assert.strictEqual(beRole.role, 'backend', 'Should infer backend role for API task');

  console.log('[PASS] SwarmCoordinator role inference for Security & Research verified.');

  // -------------------------------------------------------------
  // Test 3: MaxingDepartmentTool Schema & Guardrails
  // -------------------------------------------------------------
  console.log('\n=== TEST 3: MAXING DEPARTMENT TOOL SCHEMA & VALIDATION ===');
  const deptTool = new MaxingDepartmentTool();
  assert.strictEqual(deptTool.name, 'maxing_department');
  assert.strictEqual(deptTool.requiresPermission, true, 'Department tool requires user permission');

  const validArgs = {
    overallGoal: 'Design, implement, and audit a distributed payment processing cluster',
    maxingBudget: 24576,
    autoMerge: true,
    requiredRoles: ['architect', 'backend', 'security', 'tester'] as SwarmRole[],
  };
  const parseResult = deptTool.inputSchema.safeParse(validArgs);
  assert.ok(parseResult.success, 'Valid arguments must pass schema validation');

  const invalidArgs = { overallGoal: 'abc' }; // Too short
  const failResult = deptTool.inputSchema.safeParse(invalidArgs);
  assert.strictEqual(failResult.success, false, 'Short goal must fail validation');
  console.log('[PASS] MaxingDepartmentTool schema validation verified.');

  // -------------------------------------------------------------
  // Test 4: Slash Command /maxing & Aliases (/max, /department)
  // -------------------------------------------------------------
  console.log('\n=== TEST 4: /MAXING COMMAND & ALIASES (/MAX, /DEPARTMENT) ===');
  const reg = new CommandRegistry();
  registerBuiltinCommands(reg);

  assert.ok(reg.has('maxing'), 'CommandRegistry must contain maxing');
  assert.ok(reg.has('max'), 'CommandRegistry must contain alias max');
  assert.ok(reg.has('department'), 'CommandRegistry must contain alias department');

  const mockSessionState: Record<string, unknown> = {
    id: 'test-maxing-session',
    maxingMode: false,
    thinkingBudget: 2048,
  };

  // 4a. /maxing on
  const resOn = await maxingCommand.execute({
    cwd: process.cwd(),
    args: ['on'],
    sessionState: mockSessionState,
  });
  assert.strictEqual(mockSessionState.maxingMode, true, 'Executing /maxing on must enable maxingMode');
  assert.strictEqual(mockSessionState.thinkingBudget, 16384, 'Executing /maxing on must set thinkingBudget to 16,384');
  assert.ok(typeof resOn === 'string' && resOn.includes('[MAXING MODE: ACTIVE]'), 'Output must announce activation');

  // 4b. /maxing status
  const resStatus = await maxingCommand.execute({
    cwd: process.cwd(),
    args: ['status'],
    sessionState: mockSessionState,
  });
  assert.ok(typeof resStatus === 'string' && resStatus.includes('🟢 ACTIVE'), 'Status must show ACTIVE');
  assert.ok(typeof resStatus === 'string' && resStatus.includes('16384'), 'Status must show 16384 token budget');

  // 4c. /maxing off
  const resOff = await maxingCommand.execute({
    cwd: process.cwd(),
    args: ['off'],
    sessionState: mockSessionState,
  });
  assert.strictEqual(mockSessionState.maxingMode, false, 'Executing /maxing off must disable maxingMode');
  assert.strictEqual(mockSessionState.thinkingBudget, 2048, 'Executing /maxing off must restore 2048 token budget');

  // 4d. Test alias execution via CommandRegistry: "/max on"
  const maxCmd = reg.get('max');
  assert.ok(maxCmd && maxCmd.type === 'local', 'Must find local command via alias max');
  await maxCmd.execute({
    cwd: process.cwd(),
    args: ['on'],
    sessionState: mockSessionState,
  });
  assert.strictEqual(mockSessionState.maxingMode, true, 'Executing /max on via alias must enable maxingMode');

  // 4e. Test alias execution via CommandRegistry: "/department status"
  const deptCmd = reg.get('department');
  assert.ok(deptCmd && deptCmd.type === 'local', 'Must find local command via alias department');
  const resDept = await deptCmd.execute({
    cwd: process.cwd(),
    args: ['status'],
    sessionState: mockSessionState,
  });
  assert.ok(typeof resDept === 'string' && resDept.includes('🟢 ACTIVE'), 'Status via department alias must show ACTIVE');
  console.log('[PASS] /maxing, /max, and /department command suite verified.');

  // -------------------------------------------------------------
  // Test 5: SwarmDepartmentCoordinator Role Mobilization
  // -------------------------------------------------------------
  console.log('\n=== TEST 5: SWARM DEPARTMENT COORDINATOR MOBILIZATION ===');
  const deptCoordinator = new SwarmDepartmentCoordinator();
  assert.ok(deptCoordinator.getSessionManager(), 'Must have valid session manager');
  assert.ok(deptCoordinator.getBlackboard(), 'Must have valid shared blackboard');

  // Test full-spectrum role determination
  const fullSpecGoal = 'Develop end-to-end protein genomics analysis app with React UI, REST API, arXiv research literature, and security cve audit';
  const mobilizedRoles: SwarmRole[] = (deptCoordinator as any).determineDepartmentRoles(fullSpecGoal);

  console.log('Mobilized Department Desks:', mobilizedRoles);
  assert.ok(mobilizedRoles.includes('architect'), 'Must mobilize Lead Architect');
  assert.ok(mobilizedRoles.includes('backend'), 'Must mobilize Backend Engineer');
  assert.ok(mobilizedRoles.includes('tester'), 'Must mobilize QA/Tester');
  assert.ok(mobilizedRoles.includes('reviewer'), 'Must mobilize Reviewer Sentinel');
  assert.ok(mobilizedRoles.includes('frontend'), 'Must mobilize Frontend Engineer for React UI');
  assert.ok(mobilizedRoles.includes('bioinformatics'), 'Must mobilize Bioinformatics specialist for protein genomics');
  assert.ok(mobilizedRoles.includes('research'), 'Must mobilize Research Scientist for arXiv literature');
  assert.ok(mobilizedRoles.includes('security'), 'Must mobilize Security Auditor for CVE audit');

  // Test initial contract publication
  deptCoordinator.getBlackboard().clear();
  (deptCoordinator as any).publishInitialContracts('Payment gateway service', ['architect', 'backend', 'security']);
  const publishedContracts = deptCoordinator.getBlackboard().getContracts();
  assert.ok(publishedContracts.length >= 1, 'Initial contract must be published');
  const specContract = deptCoordinator.getBlackboard().getContract('SystemInterfaceSpecification');
  assert.ok(specContract, 'Must find SystemInterfaceSpecification contract');
  assert.strictEqual(specContract.name, 'SystemInterfaceSpecification');
  console.log('[PASS] SwarmDepartmentCoordinator role mobilization and blueprint generation verified.');

  // -------------------------------------------------------------
  // Test 6: QueryEngine Unconstrained Thinking Budget in Maxing Mode
  // -------------------------------------------------------------
  console.log('\n=== TEST 6: QUERY ENGINE UNCONSTRAINED THINKING BUDGET ===');
  const queryEngine = new QueryEngine({
    provider: 'anthropic',
    model: 'claude-3-7-sonnet',
    cwd: process.cwd(),
    maxTokens: 100000,
    permissionMode: 'auto',
    resumeSession: false,
  });

  // Enable Maxing Mode on QueryEngine
  queryEngine.setMaxingMode(true, 32768);
  const engineState = queryEngine.getSessionState();
  assert.strictEqual(engineState.maxingMode, true, 'QueryEngine maxingMode must be true');
  assert.strictEqual(engineState.maxingBudget, 32768, 'QueryEngine maxingBudget must be 32,768');
  assert.strictEqual(engineState.thinkingBudget, 32768, 'QueryEngine thinkingBudget must equal maxingBudget');

  // Disable Maxing Mode on QueryEngine
  queryEngine.setMaxingMode(false);
  const revertedState = queryEngine.getSessionState();
  assert.strictEqual(revertedState.maxingMode, false, 'QueryEngine maxingMode must revert to false');
  console.log('[PASS] QueryEngine unconstrained thinking budget and toggle mechanics verified.');

  console.log('\n================================================================');
  console.log(' ALL 6/6 MAXING MODE & DEPARTMENT SWARM TESTS PASSED! 🎉        ');
  console.log('================================================================');
}

runMaxingDepartmentSwarmTestSuite().catch((err) => {
  console.error('[FAIL] Test suite execution failed:', err);
  process.exit(1);
});
