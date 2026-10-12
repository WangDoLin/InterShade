import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { getDatabase } from '../../state/Database.js';

export interface MemoryEntry {
  id: string;
  sessionId?: string;
  projectId: string;
  type: 'decision' | 'lesson' | 'architecture' | 'bug_pattern';
  title: string;
  content: string;
  createdAt: number;
}

export class MemoryService {
  /**
   * Save a durable memory record to SQLite WAL database
   */
  static recordMemory(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): MemoryEntry {
    const db = getDatabase();
    const id = randomUUID();
    const createdAt = Date.now();

    const stmt = db.prepare(`
      INSERT INTO memories (id, session_id, project_id, type, title, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      entry.sessionId || null,
      entry.projectId,
      entry.type,
      entry.title,
      entry.content,
      createdAt
    );

    return {
      id,
      ...entry,
      createdAt,
    };
  }

  /**
   * Retrieve memories for a specific project
   */
  static getMemoriesForProject(projectId: string): MemoryEntry[] {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT id, session_id as sessionId, project_id as projectId, type, title, content, created_at as createdAt
      FROM memories
      WHERE project_id = ?
      ORDER BY created_at ASC
    `);

    return stmt.all(projectId) as MemoryEntry[];
  }

  /**
   * Formats project memories into a concise Markdown section for LLM context injection
   */
  static formatMemoriesForContext(projectId: string): string {
    const entries = this.getMemoriesForProject(projectId);
    if (entries.length === 0) {
      return '';
    }

    const lines = [
      '# Project Durable Memories & Architectural Lessons',
      'The following guidelines and lessons were recorded from previous tasks in this codebase:',
    ];

    for (const mem of entries) {
      lines.push(`- [${mem.type.toUpperCase()}] ${mem.title}: ${mem.content}`);
    }

    return lines.join('\n');
  }

  /**
   * Exports project memories to a local markdown file (.intershader/session-memory.md)
   */
  static exportToMarkdown(cwd: string, projectId: string): string {
    const targetDir = path.join(cwd, '.intershader');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const filePath = path.join(targetDir, 'session-memory.md');
    const content = this.formatMemoriesForContext(projectId);
    fs.writeFileSync(filePath, content || '# No memories recorded yet.\n', 'utf-8');

    return filePath;
  }
}
