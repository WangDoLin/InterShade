import { ToolRegistry } from '../tools/ToolRegistry.js';
import { ReachWebSearchTool } from '../tools/reach/ReachTools.js';
import { AgentReachRouter } from '../engine/reach/AgentReachRouter.js';
import { NetworkGuard } from '../providers/security/NetworkGuard.js';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`[FAIL] ${msg}`);
    process.exit(1);
  }
  console.log(`[PASS] ${msg}`);
}

async function runTests() {
  console.log('--- TEST SUITE: Reach Web Search Engine & Tool ---');

  // 1. Tool definition and schema contract
  const tool = new ReachWebSearchTool();
  assert(tool.name === 'reach_web_search', 'Tool name must be reach_web_search');
  assert(tool.isReadOnly === true, 'ReachWebSearchTool must be marked read-only');
  assert(tool.inputSchema !== undefined, 'Tool must define input schema');

  const schemaParsed = tool.inputSchema.safeParse({ query: 'TypeScript generics guide' });
  assert(schemaParsed.success === true, 'Schema should parse valid query');

  const schemaInvalid = tool.inputSchema.safeParse({});
  assert(schemaInvalid.success === false, 'Schema should reject empty args without query');

  // 2. ToolRegistry integration
  const registry = new ToolRegistry();
  const registeredTool = registry.get('reach_web_search');
  assert(registeredTool !== undefined, 'ToolRegistry must contain reach_web_search');
  assert(registeredTool?.name === 'reach_web_search', 'Registered tool name matches');

  // 3. AgentReachRouter empty query handling
  const emptyRes = await AgentReachRouter.webSearch('');
  assert(emptyRes.results.length === 0, 'Empty query should return empty results');
  assert(emptyRes.source === 'error', 'Empty query should yield error status');

  // 4. Mock connector testing for Jina search protocol parsing
  const mockJinaResponse = JSON.stringify({
    data: [
      {
        title: 'Node.js Documentation',
        url: 'https://nodejs.org/docs',
        description: 'Official API reference and developer guides for Node.js',
      },
      {
        title: 'TypeScript HandBook',
        url: 'https://www.typescriptlang.org/docs',
        description: 'Comprehensive guide to TypeScript language and types',
      },
    ],
  });

  NetworkGuard.setMockConnector(async (url: string) => {
    if (url.includes('s.jina.ai')) {
      return new Response(mockJinaResponse, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Not found', { status: 404 });
  });

  try {
    const mockRes = await AgentReachRouter.webSearch('Node.js docs', { maxResults: 2 });
    assert(mockRes.source === 'jina-search', 'Mocked request should succeed via jina-search');
    assert(mockRes.results.length === 2, 'Should parse 2 search result items');
    assert(mockRes.results[0].title === 'Node.js Documentation', 'First item title matches');
    assert(mockRes.results[0].url === 'https://nodejs.org/docs', 'First item URL matches');

    // 5. Tool execution formatting test
    const dummyContext = {
      sessionId: 'test-session',
      cwd: process.cwd(),
      permissionMode: 'default' as const,
    };
    const toolOutput = await tool.execute({ query: 'Node.js docs', maxResults: 2 }, dummyContext);
    assert(toolOutput.includes('Reach Web Search'), 'Output should have Reach Web Search header');
    assert(toolOutput.includes('[Node.js Documentation](https://nodejs.org/docs)'), 'Output includes markdown link');
  } finally {
    NetworkGuard.setMockConnector(undefined);
  }

  console.log('All Reach Web Search tests passed successfully!\n');
}

runTests().catch((err) => {
  console.error('[UNCAUGHT ERROR]:', err);
  process.exit(1);
});
