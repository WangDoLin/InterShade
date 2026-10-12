import assert from 'assert';
import fs from 'fs';
import { MemoryService } from '../services/memory/MemoryService.js';
import { randomUUID } from 'crypto';

console.log('[TEST]: Starting Durable Memory Subsystem Tests...');

const testProjectId = `proj-${randomUUID().slice(0, 8)}`;
const testSessionId = `sess-${randomUUID().slice(0, 8)}`;

// 1. Record memories
const mem1 = MemoryService.recordMemory({
  projectId: testProjectId,
  sessionId: testSessionId,
  type: 'architecture',
  title: 'Database Access Pattern',
  content: 'Always use DatabaseSync with WAL pragma for thread safety and fast commits.',
});
assert.ok(mem1.id);
assert.strictEqual(mem1.title, 'Database Access Pattern');

const mem2 = MemoryService.recordMemory({
  projectId: testProjectId,
  sessionId: testSessionId,
  type: 'lesson',
  title: 'File Modification Safeguard',
  content: 'Read file contents using file_read before modifying using file_edit.',
});
assert.ok(mem2.id);
console.log('[PASS]: SQLite WAL memory record insertion verified');

// 2. Query project memories
const projectMemories = MemoryService.getMemoriesForProject(testProjectId);
assert.strictEqual(projectMemories.length, 2);
assert.strictEqual(projectMemories[0].title, 'Database Access Pattern');
assert.strictEqual(projectMemories[1].title, 'File Modification Safeguard');
console.log('[PASS]: Project memories retrieval verified');

// 3. Format for LLM context
const formatted = MemoryService.formatMemoriesForContext(testProjectId);
assert.ok(formatted.includes('# Project Durable Memories & Architectural Lessons'));
assert.ok(formatted.includes('[ARCHITECTURE] Database Access Pattern'));
assert.ok(formatted.includes('[LESSON] File Modification Safeguard'));
console.log('[PASS]: Context markdown formatting verified');

// 4. Export to markdown file
const tempDir = process.cwd();
const exportedPath = MemoryService.exportToMarkdown(tempDir, testProjectId);
assert.ok(fs.existsSync(exportedPath));
const fileContent = fs.readFileSync(exportedPath, 'utf-8');
assert.ok(fileContent.includes('Database Access Pattern'));
console.log(`[PASS]: Exported memory markdown verified at ${exportedPath}`);

console.log('[SUCCESS]: All Durable Memory Subsystem Tests PASSED!');
