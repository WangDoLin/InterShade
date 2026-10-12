import assert from 'assert';
import path from 'path';
import { NativeCodeIntelligence } from '../services/lsp/NativeCodeIntelligence.js';
import { LspTool } from '../tools/code/LspTool.js';

console.log('[TEST]: Starting Native LSP Code Intelligence Bridge verification...');

const cwd = process.cwd();
const targetFile = path.resolve(cwd, 'services/lsp/NativeCodeIntelligence.ts');

// 1. Verify Document Symbols extraction (LSP)
const symbols = NativeCodeIntelligence.getDocumentSymbols(targetFile);
assert.ok(symbols.length >= 5);

const classSym = symbols.find((s) => s.kind === 'class' && s.name === 'NativeCodeIntelligence');
assert.ok(classSym);
assert.strictEqual(classSym.isExported, true);

const ifaceSym = symbols.find((s) => s.kind === 'interface' && s.name === 'LspSymbol');
assert.ok(ifaceSym);

const methodSym = symbols.find((s) => s.kind === 'method' && s.name === 'getDocumentSymbols');
assert.ok(methodSym);
console.log(`[PASS]: Document symbols extracted accurately: Found ${symbols.length} symbols`);

// 2. Verify Hover Type Info retrieval (LSP)
const typeInfo = NativeCodeIntelligence.getTypeInfo(targetFile, classSym.line, 14, cwd);
assert.ok(typeInfo);
assert.ok(typeInfo.signature.includes('class NativeCodeIntelligence'));
console.log(`[PASS]: Retrieved type signature accurately: ${typeInfo.signature.split('\n')[0]}`);

// 3. Verify Go to Definition (LSP)
const defs = NativeCodeIntelligence.getDefinition(targetFile, classSym.line, 14, cwd);
assert.ok(defs.length >= 1);
assert.ok(defs[0].file.includes('NativeCodeIntelligence.ts'));
console.log(`[PASS]: Go to Definition accurate at: ${defs[0].file}:${defs[0].line}`);

// 4. Verify LspTool execution
async function testTool() {
  const tool = new LspTool();

  // Test document_symbols
  const symOut = await tool.execute(
    { action: 'document_symbols', filePath: 'services/lsp/NativeCodeIntelligence.ts' },
    { cwd, sessionId: 'test', permissionMode: 'auto' }
  );
  assert.ok(symOut.includes('class NativeCodeIntelligence'));
  assert.ok(symOut.includes('interface LspSymbol'));

  // Test type_info
  const typeOut = await tool.execute(
    { action: 'type_info', filePath: 'services/lsp/NativeCodeIntelligence.ts', line: classSym!.line, character: 14 },
    { cwd, sessionId: 'test', permissionMode: 'auto' }
  );
  assert.ok(typeOut.includes('class NativeCodeIntelligence'));

  console.log('[PASS]: LspTool successfully executed LSP operations');
}

testTool().then(() => {
  console.log('[SUCCESS]: ALL STEP 3 TESTS (NATIVE LSP CODE INTELLIGENCE) PASSED 100%!');
});
