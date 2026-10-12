import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { getDatabase } from '../../state/Database.js';

export interface MemoryEntry {
  id: string;
  sessionId?: string;
  projectId: string;
  type: 'decision' | 'lesson' | 'architecture' | 'bug_pattern' | 'skill';
  title: string;
  content: string;
  createdAt: number;
}

export interface FtsSearchResult extends MemoryEntry {
  rank: number;
  snippet: string;
}

export interface FtsSearchOptions {
  projectId?: string;
  type?: string;
  limit?: number;
}

export class FtsMemoryService {
  /**
   * Save a durable memory record to SQLite WAL database and FTS5 virtual table
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
   * Sanitize search term for SQLite FTS5 syntax
   */
  private static sanitizeFtsQuery(query: string): string {
    const cleaned = query
      .replace(/['"“”‘’]/g, ' ')
      .replace(/[*+\-^:()]/g, ' ')
      .trim();

    const tokens = cleaned
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .map((t) => `"${t}"*`);

    return tokens.length > 0 ? tokens.join(' OR ') : '""';
  }

  /**
   * High-speed full-text search with BM25 ranking and snippet generation
   */
  static searchMemories(query: string, options: FtsSearchOptions = {}): FtsSearchResult[] {
    const db = getDatabase();
    const limit = options.limit || 10;
    const sanitized = this.sanitizeFtsQuery(query);

    if (sanitized === '""') {
      return [];
    }

    try {
      let sql = `
        SELECT m.id, m.session_id as sessionId, m.project_id as projectId, m.type, m.title, m.content, m.created_at as createdAt,
               bm25(memories_fts) as rank,
               snippet(memories_fts, 5, '**', '**', '...', 32) as snippet
        FROM memories_fts f
        JOIN memories m ON m.id = f.id
        WHERE memories_fts MATCH ?
      `;

      const params: any[] = [sanitized];

      if (options.projectId) {
        sql += ` AND m.project_id = ?`;
        params.push(options.projectId);
      }

      if (options.type) {
        sql += ` AND m.type = ?`;
        params.push(options.type);
      }

      sql += ` ORDER BY rank ASC LIMIT ?`;
      params.push(limit);

      const stmt = db.prepare(sql);
      const rows = stmt.all(...params) as any[];

      return rows.map((r) => ({
        id: r.id,
        sessionId: r.sessionId,
        projectId: r.projectId,
        type: r.type,
        title: r.title,
        content: r.content,
        createdAt: r.createdAt,
        rank: Number(r.rank),
        snippet: r.snippet,
      }));
    } catch {
      // Fallback to LIKE if FTS expression encounters an unexpected token
      let fallbackSql = `
        SELECT id, session_id as sessionId, project_id as projectId, type, title, content, created_at as createdAt,
               0 as rank,
               substr(content, 1, 100) as snippet
        FROM memories
        WHERE (title LIKE ? OR content LIKE ?)
      `;
      const fallbackParams: any[] = [`%${query}%`, `%${query}%`];

      if (options.projectId) {
        fallbackSql += ` AND project_id = ?`;
        fallbackParams.push(options.projectId);
      }

      fallbackSql += ` ORDER BY created_at DESC LIMIT ?`;
      fallbackParams.push(limit);

      const stmt = db.prepare(fallbackSql);
      return stmt.all(...fallbackParams) as FtsSearchResult[];
    }
  }

  /**
   * Retrieve all memories for a specific project
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
   * Format relevant memories into markdown for LLM prompt context injection
   */
  static formatMemoriesForContext(projectId: string, currentGoal?: string): string {
    let entries: MemoryEntry[] = [];

    if (currentGoal) {
      const ftsResults = this.searchMemories(currentGoal, { projectId, limit: 5 });
      if (ftsResults.length > 0) {
        entries = ftsResults;
      }
    }

    if (entries.length === 0) {
      entries = this.getMemoriesForProject(projectId);
    }

    if (entries.length === 0) {
      return '';
    }

    const lines: string[] = ['# Project Durable Memories & Architectural Lessons'];
    for (const mem of entries) {
      lines.push(`- [${mem.type.toUpperCase()}] **${mem.title}**: ${mem.content}`);
    }

    return lines.join('\n');
  }

  /**
   * Export memories to `.intershader/session-memory.md`
   */
  static exportToMarkdown(workspaceDir: string, projectId: string): string {
    const targetDir = path.join(workspaceDir, '.intershader');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const targetFile = path.join(targetDir, 'session-memory.md');
    const content = this.formatMemoriesForContext(projectId);
    fs.writeFileSync(targetFile, content, 'utf-8');

    return targetFile;
  }
}
