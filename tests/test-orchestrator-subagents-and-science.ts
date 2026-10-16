import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SubagentOrchestrator } from '../engine/swarm/SubagentOrchestrator.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { DecomposeAndDispatchTool } from '../tools/agentic/DecomposeAndDispatchTool.js';
import { AlphaFoldTool } from '../tools/science/AlphaFoldTool.js';
import { AlphaGenomeTool } from '../tools/science/AlphaGenomeTool.js';
import { HumanProteinAtlasTool } from '../tools/science/HumanProteinAtlasTool.js';
import { EncodeCcresTool } from '../tools/science/EncodeCcresTool.js';
import { FileLockRegistry } from '../engine/swarm/FileLockRegistry.js';
import type { ToolExecutionContext } from '../types/index.js';

const execFileAsync = promisify(execFile);

async function setupTempGitRepo(): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-sci-test-'));
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: tmpDir });
  await execFileAsync('git', ['config', 'user.name', 'InterShaderTest'], { cwd: tmpDir });
  await execFileAsync('git', ['config', 'user.email', 'test@intershader.org'], { cwd: tmpDir });
  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'sci-test', version: '1.0.0' }, null, 2), 'utf-8');
  await execFileAsync('git', ['add', '.'], { cwd: tmpDir });
  await execFileAsync('git', ['commit', '-m', 'chore: init test repository'], { cwd: tmpDir });
  return tmpDir;
}

async function testOrchestratorAndScienceSuite() {
  console.log('--- Testing SubagentOrchestrator & Biological Science Suite ---');

  const tempRepo = await setupTempGitRepo();
  FileLockRegistry.clearAll();

  const mockContext: ToolExecutionContext = {
    sessionId: 'test-session-orchestrator',
    cwd: tempRepo,
    permissionMode: 'auto',
  };

  // ==========================================
  // Part 1: ToolRegistry & Biological Tools Registration
  // ==========================================
  console.log('Checking ToolRegistry for Subagent & Science Tools...');
  const registry = new ToolRegistry();

  assert.ok(registry.get('dispatch_subagents'), 'dispatch_subagents must be registered');
  assert.ok(registry.get('alphafold_database'), 'alphafold_database must be registered');
  assert.ok(registry.get('alphagenome_analysis'), 'alphagenome_analysis must be registered');
  assert.ok(registry.get('human_protein_atlas'), 'human_protein_atlas must be registered');
  assert.ok(registry.get('encode_ccres'), 'encode_ccres must be registered');

  // Activate deferred science tools
  assert.strictEqual(registry.activateDeferredTool('alphafold_database'), true);
  assert.strictEqual(registry.activateDeferredTool('alphagenome_analysis'), true);
  assert.strictEqual(registry.activateDeferredTool('human_protein_atlas'), true);
  assert.strictEqual(registry.activateDeferredTool('encode_ccres'), true);

  // ==========================================
  // Part 2: AlphaFoldTool Unit Tests
  // ==========================================
  console.log('Testing AlphaFoldTool...');
  const alphafold = new AlphaFoldTool();
  assert.strictEqual(alphafold.name, 'alphafold_database');

  // Missing uniprotId on fetch should return helpful error
  const fetchErr = await alphafold.execute({ action: 'fetch' }, mockContext);
  assert.ok(fetchErr.includes('uniprotId is required'), 'Should report missing uniprotId');

  // Missing metadataFile on analyze_plddt should return helpful error
  const plddtErr = await alphafold.execute({ action: 'analyze_plddt', metadataFile: 'non_existent.json' }, mockContext);
  assert.ok(plddtErr.includes('Metadata file not found'), 'Should report missing metadata file');

  // ==========================================
  // Part 3: AlphaGenomeTool Unit Tests
  // ==========================================
  console.log('Testing AlphaGenomeTool...');
  const alphagenome = new AlphaGenomeTool();
  assert.strictEqual(alphagenome.name, 'alphagenome_analysis');

  // Missing geneSymbol on lookup_gene should return helpful error
  const geneErr = await alphagenome.execute({ action: 'lookup_gene' }, mockContext);
  assert.ok(geneErr.includes('geneSymbol is required'), 'Should report missing geneSymbol');

  // Missing variant on analyze_variant should return helpful error
  const variantErr = await alphagenome.execute({ action: 'analyze_variant' }, mockContext);
  assert.ok(variantErr.includes('variant is required'), 'Should report missing variant');

  // Missing API key handling
  delete process.env.ALPHAGENOME_API_KEY;
  const apiKeyNotice = await alphagenome.execute({ action: 'analyze_variant', variant: 'chr7:140753336:A>T' }, mockContext);
  assert.ok(apiKeyNotice.includes('ALPHAGENOME_API_KEY is not configured'), 'Should alert on missing ALPHAGENOME_API_KEY');

  // ==========================================
  // Part 4: HumanProteinAtlasTool Unit Tests
  // ==========================================
  console.log('Testing HumanProteinAtlasTool...');
  const hpa = new HumanProteinAtlasTool();
  assert.strictEqual(hpa.name, 'human_protein_atlas');

  // Missing ensemblId on tissue query without geneSymbol should return error
  const tissueErr = await hpa.execute({ action: 'get_tissue_expression' }, mockContext);
  assert.ok(tissueErr.includes('ensemblId is required'), 'Should report missing ensemblId');

  // ==========================================
  // Part 5: EncodeCcresTool Unit Tests
  // ==========================================
  console.log('Testing EncodeCcresTool...');
  const encode = new EncodeCcresTool();
  assert.strictEqual(encode.name, 'encode_ccres');

  // Missing accession on ccre_details should return error
  const ccreErr = await encode.execute({ action: 'ccre_details' }, mockContext);
  assert.ok(ccreErr.includes('accession is required'), 'Should report missing accession');

  // ==========================================
  // Part 6: DecomposeAndDispatchTool Unit Tests
  // ==========================================
  console.log('Testing DecomposeAndDispatchTool Schema & Dispatch...');
  const dispatchTool = new DecomposeAndDispatchTool();
  assert.strictEqual(dispatchTool.name, 'dispatch_subagents');

  // Valid schema check
  const validArgs = dispatchTool.inputSchema.parse({
    overallGoal: 'Build Bioinformatics Microservice',
    subtasks: [
      {
        id: 'task-api',
        title: 'Build API Endpoint',
        role: 'backend',
        prompt: 'Create REST endpoints in src/api/endpoints.ts',
        scope: ['src/api/**'],
      },
      {
        id: 'task-bio',
        title: 'Run AlphaFold Structure Analysis',
        role: 'bioinformatics',
        prompt: 'Fetch P04637 structure and generate summary in data/alphafold',
        scope: ['data/**'],
      },
    ],
    autoMerge: true,
  });
  assert.strictEqual(validArgs.subtasks.length, 2);

  // ==========================================
  // Part 7: SubagentOrchestrator Execution & Isolated Worktree Verification
  // ==========================================
  console.log('Testing SubagentOrchestrator Parallel Execution & Integration...');
  const orchestrator = new SubagentOrchestrator();

  // Mock sessionManager.executeBatch to simulate fast isolated worktree execution without external LLM network latency
  const sessionMgr = orchestrator.getSessionManager();
  sessionMgr.executeBatch = async (taskSpecs: any[], baseCwd: string) => {
    const tasks: any[] = [];
    const { OrcaWorktreeOrchestrator } = await import('../engine/orchestration/OrcaWorktreeOrchestrator.js');
    for (const spec of taskSpecs) {
      const wt = await OrcaWorktreeOrchestrator.createWorktree(`wt-${spec.role}`, 'HEAD', baseCwd);

      // Perform real git file changes in isolated worktree
      if (spec.role === 'backend') {
        fs.mkdirSync(path.join(wt.worktreePath, 'src/services'), { recursive: true });
        fs.writeFileSync(path.join(wt.worktreePath, 'src/services/auth.ts'), 'export const authService = { login: () => true };\n');
      } else {
        fs.mkdirSync(path.join(wt.worktreePath, 'data'), { recursive: true });
        fs.writeFileSync(path.join(wt.worktreePath, 'data/analysis_config.json'), '{"alphafold": true, "plddt": "high"}\n');
      }

      await execFileAsync('git', ['add', '.'], { cwd: wt.worktreePath });
      await execFileAsync('git', ['commit', '-m', `feat: complete ${spec.role} task`], { cwd: wt.worktreePath });

      tasks.push({
        id: `task-${spec.role}`,
        role: spec.role,
        prompt: spec.prompt,
        status: 'completed',
        progressPercent: 100,
        worktreePath: wt.worktreePath,
        branch: wt.branch,
        leasedFiles: [],
        resultSummary: `Subagent ${spec.role} successfully finished in worktree.`,
        completedAt: Date.now(),
      });
    }
    return tasks;
  };

  let progressReportCount = 0;
  const report = await orchestrator.decomposeAndDispatch({
    overallGoal: 'Refactor Auth and Setup Protein Analysis',
    subtasks: [
      {
        id: 'sub-backend',
        title: 'Backend Auth Service',
        role: 'backend',
        prompt: 'Implement auth service functions in src/services/auth.ts',
        scope: ['src/services/**'],
      },
      {
        id: 'sub-bio',
        title: 'Bioinformatics Pipeline',
        role: 'bioinformatics',
        prompt: 'Create analysis config in data/analysis_config.json',
        scope: ['data/**'],
      },
    ],
    baseCwd: tempRepo,
    autoMerge: true,
    onProgress: (_msg) => {
      progressReportCount++;
    },
  });

  assert.strictEqual(report.tasks.length, 2, 'Should execute 2 subtasks');
  assert.ok(progressReportCount > 0, 'Should trigger onProgress events');
  assert.ok(report.summary.includes('Orchestrator Decomposition'), 'Summary should contain title');
  assert.strictEqual(report.tasks[0].role, 'backend');
  assert.strictEqual(report.tasks[1].role, 'bioinformatics');
  assert.strictEqual(report.mergeResult?.success, true, 'Merge should succeed cleanly');
  assert.ok(fs.existsSync(path.join(tempRepo, 'src/services/auth.ts')), 'Merged auth.ts should exist in main repo');
  assert.ok(fs.existsSync(path.join(tempRepo, 'data/analysis_config.json')), 'Merged config should exist in main repo');

  // Clean up test repo
  try {
    fs.rmSync(tempRepo, { recursive: true, force: true });
  } catch {
    // Ignore cleanup on temp
  }

  console.log('All SubagentOrchestrator and Biological Science tests passed successfully!');
}

testOrchestratorAndScienceSuite().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
