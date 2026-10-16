import fs from 'fs';
import path from 'path';
import os from 'os';
import { FileEditTool } from '../tools/filesystem/FileEditTool.js';
import { FileWriteTool } from '../tools/filesystem/FileWriteTool.js';
import { SessionStore } from '../state/SessionStore.js';
import type { ToolExecutionContext } from '../types/index.js';

async function runTests() {
  console.log('--- TEST: Whitespace-Tolerant Fuzzy Match & Post-Edit Diagnostics ---');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intershade-fuzzy-test-'));
  const testFile = path.join(tmpDir, 'service.ts');

  const targetSessionId = `test-session-fuzzy-${Date.now()}`;
  const createdSession = SessionStore.createSession({
    sessionId: targetSessionId,
    model: 'test-model',
    provider: 'test-provider',
    cwd: tmpDir,
    maxTokens: 4000,
    permissionMode: 'bypassPermissions',
  });

  const initialCode = [
    'export class AuthService {',
    '  validateUser(username: string): boolean {',
    '    if (!username) {',
    '      return false;',
    '    }',
    '    return true;',
    '  }',
    '}',
  ].join('\n');

  fs.writeFileSync(testFile, initialCode, 'utf-8');

  const mockContext: ToolExecutionContext = {
    sessionId: createdSession.id,
    cwd: tmpDir,
    permissionMode: 'bypassPermissions',
  };

  const editTool = new FileEditTool();

  // Test 1: Whitespace/Indentation difference fuzzy match (Aider / Hermes pattern)
  // Target has 4-space indentation and different whitespace, but lines match trimmed
  const indentedOldString = [
    '    if (!username) {',
    '        return false;',
    '    }',
  ].join('\n');

  const newString = [
    '    if (!username || username.trim() === "") {',
    '      return false;',
    '    }',
  ].join('\n');

  console.log('1. Testing fuzzy match with different whitespace indentation...');
  const editResult = await editTool.execute(
    {
      filePath: testFile,
      oldString: indentedOldString,
      newString: newString,
    },
    mockContext
  );

  if (!editResult.success) {
    throw new Error('Expected fuzzy edit to succeed.');
  }
  console.log(`[PASS] Edit succeeded: ${editResult.message}`);

  const updatedContent = fs.readFileSync(testFile, 'utf-8');
  if (!updatedContent.includes('username.trim() === ""')) {
    throw new Error('Replacement content was not found in updated file.');
  }
  console.log('[PASS] File content successfully updated via fuzzy matching.');

  // Test 2: Post-edit compiler diagnostic detection
  // Intentionally introduce a syntax/type error and verify diagnostics feedback
  console.log('2. Testing immediate compiler diagnostics detection...');
  const brokenCode = [
    '    if (!username || username.trim() === "") {',
    '      undeclaredVariableCall();',
    '      return false;',
    '    }',
  ].join('\n');

  const diagResult = await editTool.execute(
    {
      filePath: testFile,
      oldString: newString,
      newString: brokenCode,
    },
    mockContext
  );

  if (!diagResult.diagnostics || !diagResult.diagnostics.includes('COMPILER DIAGNOSTICS DETECTED')) {
    throw new Error('Expected diagnostics alert to be returned for undeclared variable.');
  }
  console.log(`[PASS] Compiler diagnostics caught error immediately:`);
  console.log(diagResult.diagnostics.trim());

  // Test 3: FileWriteTool with diagnostics
  console.log('3. Testing FileWriteTool diagnostics feedback...');
  const writeTool = new FileWriteTool();
  const writeResult = await writeTool.execute(
    {
      filePath: path.join(tmpDir, 'syntax-err.ts'),
      content: 'const a: number = "this is string type error";',
      overwrite: true,
    },
    mockContext
  );

  if (!writeResult.includes('COMPILER DIAGNOSTICS DETECTED')) {
    throw new Error('Expected FileWriteTool to report compiler diagnostic error.');
  }
  console.log(`[PASS] FileWriteTool diagnostics verified: ${writeResult}`);

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('\nAll Whitespace-Tolerant Match & Diagnostics Tests PASSED! [100% SUCCESS]');
}

runTests().catch((err) => {
  console.error('[TEST FAILURE]:', err);
  process.exit(1);
});
