import assert from 'node:assert';
import path from 'node:path';
import { PromptEnhancerTool } from '../tools/agentic/PromptEnhancerTool.js';
import { DependencyAuditTool } from '../tools/code/DependencyAuditTool.js';
import { LiteratureSearchTool } from '../tools/ai/LiteratureSearchTool.js';
import { EncodeCcresTool } from '../tools/science/EncodeCcresTool.js';
import { AlphaGenomeTool } from '../tools/science/AlphaGenomeTool.js';
import { MLCausalEngine } from '../engine/ml/MLCausalEngine.js';
import { CommandRegistry, registerBuiltinCommands } from '../cli/commands/index.js';
import type { ToolExecutionContext } from '../types/index.js';

async function runResearchUpgradeTestSuite() {
  console.log('================================================================');
  console.log(' INTERSHADE RESEARCH & AI MODEL BUILDING UPGRADE SUITE         ');
  console.log('================================================================\n');

  const mockContext: ToolExecutionContext = {
    sessionId: 'test-research-upgrade',
    cwd: process.cwd(),
    permissionMode: 'auto',
  };

  // -------------------------------------------------------------
  // Test 1: PromptEnhancerTool 6-Dimension Formalization
  // -------------------------------------------------------------
  console.log('=== TEST 1: PROMPT ENHANCER 6-DIMENSION SPECIFICATION ===');
  const enhancer = new PromptEnhancerTool();
  assert.strictEqual(enhancer.name, 'prompt_enhancer');

  const enhancedPrompt = await enhancer.execute(
    {
      action: 'enhance_prompt',
      rawPrompt: 'Predict variant effect on promoter chromatin accessibility',
      domainContext: 'biological_genomics',
    },
    mockContext
  );
  console.log('Enhanced Prompt Output Preview:\n', enhancedPrompt.slice(0, 320), '...\n');
  assert.ok(enhancedPrompt.includes('1. WHAT'), 'Must contain WHAT section');
  assert.ok(enhancedPrompt.includes('2. WHY'), 'Must contain WHY section');
  assert.ok(enhancedPrompt.includes('3. WHO'), 'Must contain WHO section');
  assert.ok(enhancedPrompt.includes('4. WHEN'), 'Must contain WHEN section');
  assert.ok(enhancedPrompt.includes('5. HOW'), 'Must contain HOW section');
  assert.ok(enhancedPrompt.includes('6. DONE'), 'Must contain DONE section');

  const mlSpec = await enhancer.execute(
    {
      action: 'generate_ml_spec',
      rawPrompt: 'Train protein stability predictor on thermal Tm',
      domainContext: 'biological_genomics',
    },
    mockContext
  );
  console.log('ML Spec Output:\n', mlSpec, '\n');
  assert.ok(mlSpec.includes('`bio_sequence`'), 'Must detect bio_sequence modality');
  assert.ok(mlSpec.includes('`spearman_rho`'), 'Must specify spearman_rho');

  // -------------------------------------------------------------
  // Test 2: DependencyAuditTool Multi-Ecosystem Scanner
  // -------------------------------------------------------------
  console.log('\n=== TEST 2: DEPENDENCY AUDIT TOOL ===');
  const auditTool = new DependencyAuditTool();
  assert.strictEqual(auditTool.name, 'dependency_audit');

  const auditReport = await auditTool.execute(
    {
      targetDir: '.',
      ecosystem: 'auto',
      scanTypes: ['outdated'],
    },
    mockContext
  );
  console.log('Dependency Audit Preview:\n', auditReport.slice(0, 260), '...\n');
  assert.ok(auditReport.includes('Dependency Security & Freshness Audit Report'), 'Report header present');
  assert.ok(auditReport.includes('NODE'), 'Must detect Node.js ecosystem');

  // -------------------------------------------------------------
  // Test 3: LiteratureSearchTool OpenAlex SOTA Architecture Grounding
  // -------------------------------------------------------------
  console.log('\n=== TEST 3: LITERATURE SEARCH OPENALEX & SOTA GROUNDING ===');
  const litTool = new LiteratureSearchTool();
  assert.strictEqual(litTool.name, 'literature_search');

  const sotaArch = await litTool.execute(
    {
      source: 'openalex',
      query: 'Transformer state space Mamba DNA language model',
      action: 'sota_architecture',
      maxResults: 3,
    },
    mockContext
  );
  console.log('SOTA Literature Grounding Preview:\n', sotaArch.slice(0, 300), '...\n');
  assert.ok(sotaArch.includes('SOTA Literature Grounding'), 'Must contain SOTA grounding title');
  assert.ok(sotaArch.includes('Recommended Model Grounding'), 'Must recommend backbone and loss');

  // -------------------------------------------------------------
  // Test 4: EncodeCcresTool Expanded Actions
  // -------------------------------------------------------------
  console.log('\n=== TEST 4: ENCODE CCRES EXPANDED CAPABILITIES ===');
  const encodeTool = new EncodeCcresTool();
  assert.strictEqual(encodeTool.name, 'encode_ccres');

  // gene_expression validation without symbol
  const exprErr = await encodeTool.execute({ action: 'gene_expression' }, mockContext);
  assert.ok(exprErr.includes('geneSymbol is required'), 'Must require geneSymbol');

  // linked_genes validation without accession
  const linkErr = await encodeTool.execute({ action: 'linked_genes' }, mockContext);
  assert.ok(linkErr.includes('accession is required'), 'Must require accession');

  // orthologs validation without accession
  const orthErr = await encodeTool.execute({ action: 'orthologs' }, mockContext);
  assert.ok(orthErr.includes('accession is required'), 'Must require accession');
  console.log('EncodeCcresTool Input Validations: PASS');

  // -------------------------------------------------------------
  // Test 5: AlphaGenomeTool Expanded Actions
  // -------------------------------------------------------------
  console.log('\n=== TEST 5: ALPHAGENOME EXPANDED ACTIONS ===');
  const alphaTool = new AlphaGenomeTool();
  assert.strictEqual(alphaTool.name, 'alphagenome_analysis');

  // analyze_ism validation
  const ismErr = await alphaTool.execute({ action: 'analyze_ism' }, mockContext);
  assert.ok(ismErr.includes('variant is required'), 'Must require variant');

  // interpret_splicing validation
  const spliceErr = await alphaTool.execute({ action: 'interpret_splicing' }, mockContext);
  assert.ok(spliceErr.includes('variant is required'), 'Must require variant');

  // visualize_tracks validation
  const trackErr = await alphaTool.execute({ action: 'visualize_tracks' }, mockContext);
  assert.ok(trackErr.includes('interval or variant is required'), 'Must require interval/variant');
  console.log('AlphaGenomeTool Input Validations: PASS');

  // -------------------------------------------------------------
  // Test 6: MLCausalEngine Full Integration
  // -------------------------------------------------------------
  console.log('\n=== TEST 6: ML CAUSAL ENGINE RESEARCH INTEGRATION ===');
  const mlEngine = new MLCausalEngine('Genomic Enhancer-Promoter Regulation Model', 'bio_sequence');

  // Stage 1: Prompt specification
  mlEngine.setPromptSpecification({
    taskGoal: 'Predict enhancer-promoter looping from genomic sequence',
    targetMetric: 'auroc',
    baselineThreshold: 0.88,
  });
  mlEngine.recordStage('TaskFraming', 'PASSED', 'Enhanced by PromptEnhancerTool: 6-dimension specification formalized');

  // Stage 2: Dependency audit
  mlEngine.recordDependencyAudit(true, 'Environment scanned: 0 critical vulnerabilities in PyTorch 2.3 & CUDA dependencies');

  // Stage 3: Literature baselines
  mlEngine.addLiteratureBaseline({
    title: 'High-throughput mapping of human cis-regulatory elements',
    doi: 'https://doi.org/10.1038/s41586-020-03134-3',
    architecture: 'Enformer / Dilated CNN + Transformer',
    metricScore: 0.86,
  });

  // Stage 4: Domain science oracles
  mlEngine.addDomainOracle('ENCODE', 'EH38E2941922', 'cCRE Promoter element with verified H3K4me3 / DNase Z-scores');
  mlEngine.addDomainOracle('AlphaGenome', 'chr11:5205263:C>T', 'Quantile score: 0.998 on liver chromatin accessibility');

  const summary = mlEngine.getSummary();
  console.log('ML Causal Loop Summary Preview:\n', summary, '\n');
  assert.ok(summary.includes('auroc'), 'Target metric updated');
  assert.ok(summary.includes('Literature SOTA Baselines'), 'Literature section present');
  assert.ok(summary.includes('**Dependency Audit**: `PASSED`'), 'Dependency status verified');

  // -------------------------------------------------------------
  // Test 7: Slash Commands Registry (/enhance & /audit)
  // -------------------------------------------------------------
  console.log('\n=== TEST 7: SLASH COMMANDS REGISTRATION ===');
  const registry = new CommandRegistry();
  registerBuiltinCommands(registry);

  assert.ok(registry.get('/enhance'), '/enhance command must be registered');
  assert.ok(registry.get('/pe'), '/pe alias must resolve');
  assert.ok(registry.get('/prompt-enhancer'), '/prompt-enhancer alias must resolve');

  assert.ok(registry.get('/audit'), '/audit command must be registered');
  assert.ok(registry.get('/dependency-audit'), '/dependency-audit alias must resolve');
  console.log('Commands & Aliases Verified: PASS');

  console.log('\n================================================================');
  console.log(' ALL RESEARCH & AI MODEL BUILDING UPGRADE TESTS PASSED (100%) ');
  console.log('================================================================');
}

runResearchUpgradeTestSuite().catch((err) => {
  console.error('\n[TEST FAILURE]:', err);
  process.exit(1);
});
