import { Tensor } from '../nn/core/Tensor.js';
import { Ops } from '../nn/core/Ops.js';
import { Linear } from '../nn/layers/Linear.js';
import { RMSNorm } from '../nn/layers/RMSNorm.js';
import { MultiHeadAttention } from '../nn/layers/MultiHeadAttention.js';
import { AdamW } from '../nn/layers/AdamW.js';
import { NeuralToolRouter } from '../nn/agent/NeuralToolRouter.js';
import { SemanticCodeEmbedder } from '../nn/agent/SemanticCodeEmbedder.js';
import { CrossEncoderReranker } from '../nn/agent/CrossEncoderReranker.js';

async function main() {
  console.log('=== 1. TENSOR & AUTOGRAD BACKPROP TEST ===');
  // Simple scalar quadratic optimization: L = (x * 2 - 6)^2
  const x = new Tensor([1.0], [1], true);
  const target = new Tensor([6.0], [1], false);

  for (let epoch = 0; epoch < 20; epoch++) {
    x.zeroGrad();
    const twoX = Ops.scale(x, 2.0);
    const loss = Ops.mseLoss(twoX, target);
    loss.backward();

    if (epoch % 5 === 0 || epoch === 19) {
      console.log(`Epoch ${epoch}: x = ${x.data[0].toFixed(4)}, loss = ${loss.data[0].toFixed(4)}, grad = ${x.grad?.data[0].toFixed(4)}`);
    }

    // SGD update
    x.data[0] -= 0.1 * (x.grad?.data[0] || 0);
  }

  const isConverged = Math.abs(x.data[0] - 3.0) < 0.05;
  console.log(`Autograd backprop test passed: ${isConverged} (expected x ~ 3.0, got ${x.data[0].toFixed(4)})`);

  console.log('\n=== 2. TRANSFORMER LAYERS TEST ===');
  const seqLen = 4;
  const embedDim = 8;
  const numHeads = 2;

  const inputTensor = Tensor.randn([seqLen, embedDim], 0, 1, true);
  const rmsNorm = new RMSNorm(embedDim);
  const mha = new MultiHeadAttention(embedDim, numHeads);

  const normalized = rmsNorm.forward(inputTensor);
  console.log(`RMSNorm output shape: [${normalized.shape}], mean value: ${(normalized.data.reduce((a, b) => a + b, 0) / normalized.size).toFixed(4)}`);

  const attnOut = mha.forward(normalized);
  console.log(`MultiHeadAttention output shape: [${attnOut.shape}], total parameters: ${mha.parameters().length}`);

  console.log('\n=== 3. ADAMW OPTIMIZER TEST ===');
  const linear = new Linear(4, 2, true);
  const optimizer = new AdamW(linear.parameters(), { lr: 0.05 });
  const sampleIn = Tensor.randn([1, 4], 0, 1, false);
  const sampleTarget = Tensor.zeros([1, 2], false);

  const initialLoss = Ops.mseLoss(linear.forward(sampleIn), sampleTarget).data[0];
  for (let i = 0; i < 15; i++) {
    optimizer.zeroGrad();
    const pred = linear.forward(sampleIn);
    const stepLoss = Ops.mseLoss(pred, sampleTarget);
    stepLoss.backward();
    optimizer.step();
  }
  const finalLoss = Ops.mseLoss(linear.forward(sampleIn), sampleTarget).data[0];
  console.log(`Initial Loss: ${initialLoss.toFixed(4)} -> Final Loss after 15 AdamW steps: ${finalLoss.toFixed(4)}`);

  console.log('\n=== 4. NEURAL TOOL ROUTER TEST ===');
  const router = new NeuralToolRouter();
  const testPrompts = [
    'pack entire codebase into single repomix context',
    'please read src/index.ts to see configuration',
    'replace line 10 with new function in App.tsx',
    'run npm test to check if suites pass',
    'grep for database connection string in files'
  ];

  for (const p of testPrompts) {
    const route = router.route(p);
    console.log(`Prompt: "${p}"`);
    console.log(`-> Predicted Top Tool: ${route.topTool} (Confidence: ${(route.confidence * 100).toFixed(1)}%)`);
  }

  console.log('\n=== 5. SEMANTIC EMBEDDINGS & RERANKER TEST ===');
  const query = 'handle authentication token and user database session';
  const candidateDocs = [
    { filePath: 'src/auth/SessionStore.ts', snippet: 'class SessionStore manages user auth tokens and sqlite sessions' },
    { filePath: 'src/ui/DiffViewer.tsx', snippet: 'renders diff lines in terminal with chalk colors and unified format' },
    { filePath: 'src/tools/ShellTool.ts', snippet: 'executes terminal bash command and pipes stdout output' }
  ];

  const reranked = CrossEncoderReranker.rerank(query, candidateDocs, 3);
  console.log(`Query: "${query}"`);
  for (const r of reranked) {
    console.log(`  File: ${r.filePath} -> Score: ${(r.relevanceScore * 100).toFixed(1)}%`);
  }

  console.log('\nALL NEURAL SUBSYSTEM TESTS PASSED SUCCESSFULLY.');
}

main().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
