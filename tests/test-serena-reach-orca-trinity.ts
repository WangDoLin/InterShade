import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SerenaSemanticEngine } from '../engine/semantic/SerenaSemanticEngine.js';
import { AgentReachRouter } from '../engine/reach/AgentReachRouter.js';
import { ReachHealthDoctor } from '../engine/reach/ReachHealthDoctor.js';
import { OrcaWorktreeOrchestrator } from '../engine/orchestration/OrcaWorktreeOrchestrator.js';
import { NetworkGuard } from '../providers/security/NetworkGuard.js';
import { SecretSanitizer } from '../providers/security/SecretSanitizer.js';

const execFileAsync = promisify(execFile);

console.log('[TEST]: Starting Serena, Agent Reach & Orca Trinity Suite...');

async function setupTempGitRepo(): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-git-test-'));
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: tmpDir });
  await execFileAsync('git', ['config', 'user.name', 'InterShaderTest'], { cwd: tmpDir });
  await execFileAsync('git', ['config', 'user.email', 'test@intershader.org'], { cwd: tmpDir });
  fs.writeFileSync(path.join(tmpDir, 'initial.txt'), 'hello world\n', 'utf-8');
  await execFileAsync('git', ['add', '.'], { cwd: tmpDir });
  await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: tmpDir });
  return tmpDir;
}

function cleanup() {
  NetworkGuard.setMockConnector(undefined);
  SecretSanitizer.clearRegisteredSecrets();
}

// 1. SERENA_SYMBOL_OUTLINE
async function testSerenaSymbolOutline() {
  console.log('\n--- [1/12] Serena: High-Precision AST Symbol Outline Extraction ---');
  console.log('Claim: SerenaSemanticEngine extracts classes, interfaces, types, functions, and enums with line numbers.');

  const sampleCode = `
export interface UserConfig {
  id: string;
  active: boolean;
}

export type ThemeMode = 'dark' | 'light';

export enum LogLevel {
  INFO,
  ERROR,
}

export class AgentSession {
  private id: string = '';
  start(): void {}
}

export function createSession(cfg: UserConfig): AgentSession {
  return new AgentSession();
}

export const DEFAULT_TIMEOUT = 5000;
`;

  const symbols = SerenaSemanticEngine.getSymbolOutline('sample-agent.ts', sampleCode);
  assert.strictEqual(symbols.length, 7);

  const iface = symbols.find((s) => s.name === 'UserConfig');
  assert.ok(iface && iface.kind === 'interface' && iface.isExported);

  const typeAlias = symbols.find((s) => s.name === 'ThemeMode');
  assert.ok(typeAlias && typeAlias.kind === 'type' && typeAlias.isExported);

  const enumDecl = symbols.find((s) => s.name === 'LogLevel');
  assert.ok(enumDecl && enumDecl.kind === 'enum' && enumDecl.isExported);

  const cls = symbols.find((s) => s.name === 'AgentSession');
  assert.ok(cls && cls.kind === 'class' && cls.isExported);

  const method = symbols.find((s) => s.name === 'start');
  assert.ok(method && method.kind === 'method');

  const fn = symbols.find((s) => s.name === 'createSession');
  assert.ok(fn && fn.kind === 'function' && fn.isExported);

  const v = symbols.find((s) => s.name === 'DEFAULT_TIMEOUT');
  assert.ok(v && v.kind === 'variable' && v.isExported);

  console.log('Evidence: Extracted 7 symbols accurately matching all TypeScript declaration kinds including methods.');
}

// 2. SERENA_FIND_DEFINITION
async function testSerenaFindDefinition() {
  console.log('\n--- [2/12] Serena: Symbol Definition Location Lookup ---');
  console.log('Claim: SerenaSemanticEngine locates the exact declaration line and column for a symbol.');

  const sampleCode = `
import { other } from './other.js';

export class ModelCatalogStore {
  static getModel(id: string) {
    return id;
  }
}
`;

  const def = SerenaSemanticEngine.findDefinition('ModelCatalogStore.ts', 'ModelCatalogStore', sampleCode);
  assert.ok(def, 'Expected definition to be found');
  assert.strictEqual(def.line, 4);
  assert.ok(def.snippet?.includes('class ModelCatalogStore'));

  const notFound = SerenaSemanticEngine.findDefinition('ModelCatalogStore.ts', 'NonExistentSymbol', sampleCode);
  assert.strictEqual(notFound, null);

  console.log('Evidence: Found ModelCatalogStore definition at line 4 with matching snippet.');
}

// 3. SERENA_FIND_REFERENCES
async function testSerenaFindReferences() {
  console.log('\n--- [3/12] Serena: AST Cross-File Reference Mapping ---');
  console.log('Claim: SerenaSemanticEngine finds AST references to an identifier across files in directory.');

  const refs = SerenaSemanticEngine.findReferences('NetworkGuard', process.cwd(), { maxResults: 10 });
  assert.ok(refs.length > 0, 'Expected to find NetworkGuard references in codebase');
  assert.ok(refs.every((r) => r.line > 0 && r.file.endsWith('.ts')));

  console.log(`Evidence: Located ${refs.length} AST references to NetworkGuard across TypeScript files.`);
}

// 4. SERENA_COMPILER_DIAGNOSTICS
async function testSerenaCompilerDiagnostics() {
  console.log('\n--- [4/12] Serena: Compiler Syntactic & Semantic Diagnostics ---');
  console.log('Claim: SerenaSemanticEngine runs compiler checks and identifies deliberate syntax or type errors.');

  const faultyCode = `
const num: number = "this is not a number";
function broken() {
  missingFunctionCall();
}
`;

  const diags = SerenaSemanticEngine.getDiagnostics('faulty.ts', faultyCode);
  assert.ok(diags.length > 0, 'Expected compiler diagnostics to report errors');
  const typeError = diags.find((d) => d.code === 2322); // TS2322: Type 'string' is not assignable to type 'number'
  assert.ok(typeError, 'Expected TS2322 type assignment error');
  assert.strictEqual(typeError.category, 'error');

  console.log(`Evidence: Detected TS2322 type error at line ${typeError.line} with message: ${typeError.message}`);
}

// 5. REACH_WEB_READ_PRIMARY_JINA
async function testReachWebReadPrimary() {
  console.log('\n--- [5/12] Agent Reach: Primary Route (Jina Reader Protocol) ---');
  console.log('Claim: AgentReachRouter requests https://r.jina.ai/<url> and returns clean Markdown.');

  let requestedUrl = '';
  NetworkGuard.setMockConnector(async (url: string) => {
    requestedUrl = url;
    return new Response(
      '# Clean Markdown\nThis is formatted markdown content from Jina Reader.',
      { status: 200, headers: { 'Content-Type': 'text/markdown' } }
    );
  });

  const res = await AgentReachRouter.webRead('https://docs.intershader.org/intro');
  assert.strictEqual(res.source, 'jina-reader');
  assert.ok(requestedUrl.includes('https://r.jina.ai/'));
  assert.ok(res.markdown.includes('# Clean Markdown'));
  assert.strictEqual(res.httpStatus, 200);

  console.log('Evidence: Successfully read URL via primary Jina Reader protocol.');
  cleanup();
}

// 6. REACH_WEB_READ_FALLBACK
async function testReachWebReadFallback() {
  console.log('\n--- [6/12] Agent Reach: Automatic Fallback to Direct Fetch & HTML Stripping ---');
  console.log('Claim: If Jina Reader fails (500/timeout), AgentReachRouter falls back to direct fetch.');

  NetworkGuard.setMockConnector(async (url: string) => {
    if (url.includes('r.jina.ai')) {
      return new Response('Jina rate limit exceeded', { status: 429, statusText: 'Too Many Requests' });
    }
    return new Response(
      '<html><body><h1>Direct Header</h1><p>Direct paragraph content.</p><script>alert(1)</script></body></html>',
      { status: 200, headers: { 'Content-Type': 'text/html' } }
    );
  });

  const res = await AgentReachRouter.webRead('https://example.com/article');
  assert.strictEqual(res.source, 'direct-fallback');
  assert.ok(res.markdown.includes('Direct Header Direct paragraph content'));
  assert.ok(!res.markdown.includes('<script>'), 'Script tags must be stripped');

  console.log('Evidence: Primary 429 triggered clean fallback to direct fetch with HTML sanitized.');
  cleanup();
}

// 7. REACH_SSRF_BLOCKING
async function testReachSsrfBlocking() {
  console.log('\n--- [7/12] Agent Reach: SSRF Prevention on Outbound Requests ---');
  console.log('Claim: Requests to cloud metadata (169.254.169.254) are rejected by NetworkGuard.');

  const res = await AgentReachRouter.webRead('http://169.254.169.254/latest/meta-data/');
  assert.strictEqual(res.source, 'error');
  assert.ok(res.markdown.includes('REJECT_SSRF') || res.markdown.includes('forbidden') || res.markdown.includes('error'));

  console.log('Evidence: Outbound request to link-local metadata IP blocked with SSRF rejection.');
  cleanup();
}

// 8. REACH_SECRET_REDACTION
async function testReachSecretRedaction() {
  console.log('\n--- [8/12] Agent Reach: Zero Credential Exfiltration in Web Read ---');
  console.log('Claim: Registered secrets in SecretSanitizer are scrubbed from web read markdown output.');

  const secretToken = 'sk-reach-confidential-token-12345';
  SecretSanitizer.registerSecret(secretToken);

  NetworkGuard.setMockConnector(async () => {
    return new Response(
      `Documentation leaked token: ${secretToken} in response.`,
      { status: 200, headers: { 'Content-Type': 'text/markdown' } }
    );
  });

  const res = await AgentReachRouter.webRead('https://leaked-docs.org');
  assert.ok(!res.markdown.includes(secretToken), 'Raw secret leaked in web read markdown!');
  assert.ok(res.markdown.includes('[REDACTED_REGISTERED_SECRET]'));

  console.log('Evidence: Secret token replaced with [REDACTED_REGISTERED_SECRET] in web read output.');
  cleanup();
}

// 9. REACH_GITHUB_RESEARCH
async function testReachGithubResearch() {
  console.log('\n--- [9/12] Agent Reach: GitHub Research (No Local Git Clone Needed) ---');
  console.log('Claim: githubResearch directly fetches README and file contents from GitHub raw endpoints.');

  let fetchedUrl = '';
  NetworkGuard.setMockConnector(async (url: string) => {
    fetchedUrl = url;
    return new Response('# Repository Readme Content', { status: 200 });
  });

  const res = await AgentReachRouter.githubResearch('oraios/serena', 'readme');
  assert.ok(res.success);
  assert.strictEqual(res.repo, 'oraios/serena');
  assert.ok(fetchedUrl.includes('raw.githubusercontent.com/oraios/serena'));
  assert.ok(res.content.includes('# Repository Readme Content'));

  console.log('Evidence: githubResearch queried raw endpoint without cloning repository.');
  cleanup();
}

// 10. REACH_DOCTOR_DIAGNOSTICS
async function testReachDoctorDiagnostics() {
  console.log('\n--- [10/12] Agent Reach: ReachHealthDoctor Diagnostic Report ---');
  console.log('Claim: ReachHealthDoctor tests DNS, Web Reader, and GitHub API, generating formatted report.');

  NetworkGuard.setMockConnector(async (url: string) => {
    if (url.includes('zen')) {
      return new Response('Keep it logically awesome.', { status: 200 });
    }
    return new Response('Mock response', { status: 200 });
  });

  const report = await ReachHealthDoctor.diagnose();
  assert.ok(report.channels.length >= 3);
  assert.ok(report.timestamp > 0);

  const formatted = ReachHealthDoctor.formatReport(report);
  assert.ok(formatted.includes('AGENT REACH HEALTH DOCTOR REPORT'));
  assert.ok(formatted.includes('DNS Resolution'));
  assert.ok(formatted.includes('Web Reader'));
  assert.ok(formatted.includes('GitHub API'));

  console.log('Evidence: ReachHealthDoctor executed 3 channel checks and rendered clean ASCII table.');
  cleanup();
}

// 11. ORCA_WORKTREE_CREATE_AND_DIFF
async function testOrcaWorktreeCreateAndDiff() {
  console.log('\n--- [11/12] Orca: Isolated Git Worktree Creation & Independent Diff ---');
  console.log('Claim: Orca creates isolated worktree in .intershade/worktrees and tracks local diffs without dirtying workspace.');

  const tempRepo = await setupTempGitRepo();
  try {
    const testId = 'test-wt-eval-1';
    const { worktreePath, branch } = await OrcaWorktreeOrchestrator.createWorktree(testId, 'HEAD', tempRepo);

    assert.ok(fs.existsSync(worktreePath), `Expected worktree directory at ${worktreePath}`);
    assert.strictEqual(branch, `intershade-wt-${testId}`);

    // Create a modified file in the isolated worktree
    const testFileInWt = path.join(worktreePath, 'intershade-wt-probe.txt');
    fs.writeFileSync(testFileInWt, 'orca isolated worktree probe data\n', 'utf-8');
    await execFileAsync('git', ['add', '.'], { cwd: worktreePath });

    // Verify listWorktrees identifies it as InterShade-managed
    const list = await OrcaWorktreeOrchestrator.listWorktrees(tempRepo);
    const found = list.find((w) => w.branch === branch);
    assert.ok(found, 'Worktree must appear in listWorktrees');
    assert.ok(found.isInterShadeManaged, 'Worktree must be marked as InterShade-managed');

    // Verify getWorktreeDiff detects modified content
    const diff = await OrcaWorktreeOrchestrator.getWorktreeDiff(testId, 'HEAD', tempRepo);
    assert.ok(diff.includes('intershade-wt-probe.txt'));

    // Cleanup worktree
    await OrcaWorktreeOrchestrator.cleanupWorktree(testId, true, tempRepo);
    assert.ok(!fs.existsSync(worktreePath), 'Worktree directory should be deleted after cleanup');

    console.log(`Evidence: Worktree created at ${worktreePath} with branch ${branch} and diff verified.`);
  } finally {
    fs.rmSync(tempRepo, { recursive: true, force: true });
  }
}

// 12. ORCA_WORKTREE_COMPARE_AND_CLEANUP
async function testOrcaWorktreeCompareAndCleanup() {
  console.log('\n--- [12/12] Orca: Multi-Worktree Comparison & Clean Teardown ---');
  console.log('Claim: Orca compares multiple candidate worktrees and cleanly prunes directories and branches.');

  const tempRepo = await setupTempGitRepo();
  try {
    const wtA = 'test-compare-a';
    const wtB = 'test-compare-b';

    const resA = await OrcaWorktreeOrchestrator.createWorktree(wtA, 'HEAD', tempRepo);
    const resB = await OrcaWorktreeOrchestrator.createWorktree(wtB, 'HEAD', tempRepo);

    assert.ok(fs.existsSync(resA.worktreePath));
    assert.ok(fs.existsSync(resB.worktreePath));

    fs.writeFileSync(path.join(resA.worktreePath, 'file-a.txt'), 'candidate change a\n');
    await execFileAsync('git', ['add', '.'], { cwd: resA.worktreePath });

    const comparison = await OrcaWorktreeOrchestrator.compareWorktrees('HEAD', [wtA, wtB], tempRepo);
    assert.strictEqual(comparison.worktrees.length, 2);
    assert.strictEqual(comparison.recommendedWinner, wtA);

    // Teardown both
    await OrcaWorktreeOrchestrator.cleanupWorktree(wtA, true, tempRepo);
    await OrcaWorktreeOrchestrator.cleanupWorktree(wtB, true, tempRepo);

    assert.ok(!fs.existsSync(resA.worktreePath));
    assert.ok(!fs.existsSync(resB.worktreePath));

    console.log('Evidence: Compared 2 isolated worktrees and verified 100% clean teardown.');
  } finally {
    fs.rmSync(tempRepo, { recursive: true, force: true });
  }
}

async function main() {
  await testSerenaSymbolOutline();
  await testSerenaFindDefinition();
  await testSerenaFindReferences();
  await testSerenaCompilerDiagnostics();
  await testReachWebReadPrimary();
  await testReachWebReadFallback();
  await testReachSsrfBlocking();
  await testReachSecretRedaction();
  await testReachGithubResearch();
  await testReachDoctorDiagnostics();
  await testOrcaWorktreeCreateAndDiff();
  await testOrcaWorktreeCompareAndCleanup();

  console.log('\n=============================================================');
  console.log('Serena, Agent Reach & Orca Trinity Suite: 12/12 PASSED');
  console.log('Symbolic AST, Internet Reach & Parallel Worktrees: VERIFIED');
  console.log('=============================================================');
}

main().catch((err) => {
  console.error('[ERROR]: Test suite failed:', err);
  process.exit(1);
});
