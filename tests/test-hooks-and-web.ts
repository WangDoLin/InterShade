import { HookEngine } from '../services/hooks/HookEngine.js';
import { WebFetchTool } from '../tools/web/WebFetchTool.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { ToolSearchTool } from '../tools/meta/ToolSearchTool.js';
import type { ToolExecutionContext } from '../types/index.js';

async function main() {
  console.log('=== 1. TESTING HOOK ENGINE LIFECYCLE DISPATCH ===');
  const hooks = new HookEngine();

  let preHookCalled = false;
  let postHookCalled = false;
  let failureHookCalled = false;

  hooks.register('pre_tool_use', payload => {
    preHookCalled = true;
    console.log(`[PRE HOOK OK] Tool: ${payload.toolName}`);
  });

  hooks.register('post_tool_use', payload => {
    postHookCalled = true;
    console.log(`[POST HOOK OK] Tool: ${payload.toolName}`);
  });

  hooks.register('post_tool_use_failure', payload => {
    failureHookCalled = true;
    console.log(`[FAILURE HOOK OK] Tool: ${payload.toolName} -> ${payload.error.message}`);
  });

  const dummyContext: ToolExecutionContext = {
    sessionId: 'test-session',
    cwd: process.cwd(),
    permissionMode: 'default',
  };

  await hooks.triggerPreToolUse({
    toolName: 'file_edit',
    args: { filePath: 'test.ts' },
    context: dummyContext,
  });

  await hooks.triggerPostToolUse({
    toolName: 'file_edit',
    args: { filePath: 'test.ts' },
    result: 'Success',
    context: dummyContext,
  });

  await hooks.triggerToolFailure({
    toolName: 'run_shell_command',
    args: { command: 'invalid-command' },
    error: new Error('Command failed'),
    context: dummyContext,
  });

  if (!preHookCalled || !postHookCalled || !failureHookCalled) {
    throw new Error('HookEngine failed to trigger registered hooks!');
  }

  console.log('\n=== 2. TESTING WEBFETCH TOOL SSRF GUARDS ===');
  const webTool = new WebFetchTool();

  // Test SSRF: localhost
  let localhostBlocked = false;
  try {
    await webTool.execute({ url: 'http://localhost:3000/api/keys' }, dummyContext);
  } catch (err: any) {
    localhostBlocked = true;
    console.log('Blocked safely:', err.message);
  }
  if (!localhostBlocked) throw new Error('Failed to block localhost SSRF!');

  // Test SSRF: Cloud metadata endpoint 169.254.169.254
  let metadataBlocked = false;
  try {
    await webTool.execute({ url: 'http://169.254.169.254/latest/meta-data/' }, dummyContext);
  } catch (err: any) {
    metadataBlocked = true;
    console.log('Blocked safely:', err.message);
  }
  if (!metadataBlocked) throw new Error('Failed to block 169.254.169.254 cloud metadata SSRF!');

  // Test SSRF: Private 192.168.x.x
  let privateIpBlocked = false;
  try {
    await webTool.execute({ url: 'http://192.168.1.1/admin' }, dummyContext);
  } catch (err: any) {
    privateIpBlocked = true;
    console.log('Blocked safely:', err.message);
  }
  if (!privateIpBlocked) throw new Error('Failed to block private subnet SSRF!');

  console.log('\n=== 3. TESTING TOOL SEARCH & DEFERRED ACTIVATION ===');
  const registry = new ToolRegistry();
  const searchTool = new ToolSearchTool(registry);

  const initialActive = registry.getActiveTools().map(t => t.name);
  console.log('Initial Active Tools count:', initialActive.length);
  console.log('Includes fetch_web_content initially?:', initialActive.includes('fetch_web_content'));

  if (initialActive.includes('fetch_web_content')) {
    throw new Error('fetch_web_content should be deferred by default!');
  }

  // Search and activate via direct select
  const selectResult = await searchTool.execute({ query: 'select:fetch_web_content' }, dummyContext);
  console.log('Select Result Preview:\n', selectResult);

  const afterActive = registry.getActiveTools().map(t => t.name);
  console.log('Active Tools after activation:', afterActive.length);
  console.log('Includes fetch_web_content now?:', afterActive.includes('fetch_web_content'));

  if (!afterActive.includes('fetch_web_content')) {
    throw new Error('fetch_web_content was not activated after select!');
  }

  console.log('\nALL HOOK ENGINE, WEBFETCH SSRF, AND TOOL SEARCH TESTS PASSED.');
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
